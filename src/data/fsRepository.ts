/**
 * 瀏覽器端 Repository：資料夾授權（D1）＋拖拉資料夾（UI-03）＋存檔。
 * 介面符合 src/ui/repository.ts 的 Repository；資料夾 handle 存在 IndexedDB，重開頁面免重選
 * （瀏覽器可能要求重新授權，restore() 會處理）。這個檔案只含瀏覽器 API 膠水，邏輯都在 folder.ts。
 */
import type { Repository } from '../ui/repository';
import type { Doc } from '../ui/store';
import { createHandleFS, isNotFound, type DirFS } from './dirfs';
import type { ExamFiles } from './folder';
import { createIncrementalSaver, loadDoc, loadExamFile, saveExamFile } from './folder';
import { createSaveQueue, SwitchBlockedError, type SaveQueue, type SaveStatus } from './saveQueue';

const DB = 'mock-exam-helper';
const STORE = 'handles';
const KEY = 'root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type PermHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

async function ensurePermission(h: PermHandle): Promise<boolean> {
  const opt = { mode: 'readwrite' } as const;
  if ((await h.queryPermission?.(opt)) === 'granted') return true;
  return (await h.requestPermission?.(opt)) === 'granted';
}

export interface FsRepository extends Repository {
  /** 重開頁面時嘗試還原上次選的資料夾；需要使用者手勢才能重新授權 */
  restore(): Promise<boolean>;
  /** 最近一次 load 的警告（例如主檔損壞、已改用備份） */
  lastWarning(): string | undefined;
  /** 啟動還原失敗的原因（G16）：上次的資料夾已經不存在 */
  restoreProblem(): { kind: 'missing'; name: string } | undefined;
  /** 目前資料夾還在嗎（G16）：偵測到不見了會把存檔狀態改成 missing；沒有資料夾回 true */
  checkFolder(): Promise<boolean>;
  /** 尚未存進資料夾的修改次數、最近一次存妥的時間 */
  pendingCount(): number;
  lastSavedAt(): Date | undefined;
  /** 放棄找不到的資料夾（G16）：丟掉未存妥的修改、不再指向它，回到「尚未選資料夾」；之後可重新連結或選別的 */
  release(): void;
  /** 開選擇視窗並檢查所選資料夾（G24）；不切換。使用者沒授權讀寫回 null，取消視窗丟 AbortError */
  pickFolder(): Promise<FolderPick | null>;
  /** 改用選到的資料夾（更換／重新連結）。pending='carry'＝把未存妥的快照帶過去繼續存；'discard'＝放棄 */
  adoptPick(pick: FolderPick, opts: { pending: 'carry' | 'discard' }): Promise<{ carried: boolean }>;
  /** 搬到新位置（G24）：只接受空資料夾；整份複製、逐檔核對成功後才改用；失敗清掉已複製的檔案並丟錯，不切換；舊資料夾不動 */
  moveTo(pick: FolderPick, onProgress?: (done: number, total: number, phase: 'copy' | 'verify') => void, signal?: { aborted: boolean }): Promise<{ files: number }>;
}

/** 選到的資料夾的檢查結果（G24） */
export interface FolderPick {
  name: string;
  /** empty＝空資料夾；app＝像本 App 的資料夾（有 settings.json 與 exams/）；other＝其他內容 */
  kind: 'empty' | 'app' | 'other';
  exams: number;
  rosters: number;
  /** 像本 App 但讀不了（版本較新或檔案損壞）時的說明；有值就不能使用 */
  problem?: string;
  handle: PermHandle;
}

export class MoveError extends Error {
  constructor(message: string) { super(message); this.name = 'MoveError'; }
}

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** 瀏覽器 API 的注入點（測試用）；預設用真實的 showDirectoryPicker／IndexedDB／檔案系統 */
export interface FsRepositoryDeps {
  pick?: () => Promise<PermHandle>;
  permission?: (h: PermHandle) => Promise<boolean>;
  makeFs?: (h: PermHandle) => DirFS;
  remember?: (h: PermHandle) => Promise<void>;
}

export function createFsRepository(deps: FsRepositoryDeps = {}): FsRepository {
  let fs: DirFS | null = null;
  let queue: SaveQueue<Doc> | null = null;
  let warning: string | undefined;
  let folder = '';
  let status: SaveStatus = { state: 'idle' };
  const listeners = new Set<(s: SaveStatus) => void>();
  let restoreFail: { kind: 'missing'; name: string } | undefined;
  const emit = (s: SaveStatus) => { status = s; listeners.forEach((f) => f(s)); };

  const permission = deps.permission ?? ensurePermission;
  const makeFs = deps.makeFs ?? createHandleFS;
  const remember = deps.remember ?? ((h: PermHandle) => idb('readwrite', (s) => s.put(h, KEY)).then(() => undefined));

  // 授權成功才換資料夾；換之前先等舊資料夾的存檔佇列清空（#58、#69），失敗就不切換
  const adopt = async (h: PermHandle, verify = false): Promise<boolean> => {
    if (!(await permission(h))) return false;
    while (queue && !queue.isIdle()) if (!(await queue.flush())) throw new SwitchBlockedError();
    if (queue && queue.status().state === 'error') throw new SwitchBlockedError();
    const nextFs = makeFs(h);
    if (verify) await loadDoc(nextFs); // 新資料夾讀不了就丟錯、不切換（#69：B 讀檔失敗時仍使用 A）
    await install(h, nextFs);
    return true;
  };
  // 換上新資料夾：記住控制代碼、建立新的存檔佇列（舊佇列直接丟掉，它的狀態通知不再轉發）
  const install = async (h: PermHandle, nextFs: DirFS): Promise<void> => {
    await remember(h);
    fs = nextFs;
    const saveInc = createIncrementalSaver(nextFs); // #72：每個資料夾一個，只寫有變的檔案
    const q: SaveQueue<Doc> = createSaveQueue((d: Doc) => saveInc(d), (s) => {
      if (q !== queue) return;
      if (s.state !== 'error') { emit(s); return; }
      // 寫入失敗：再確認根資料夾還在不在，不在就標成 missing（重試不會成功，畫面要給出路）
      void nextFs.exists().then((ok) => ok, () => true).then((ok) => { if (q === queue) emit(ok ? s : { ...s, missing: true }); });
    });
    queue = q;
    emit({ state: 'idle' });
    folder = h.name;
    restoreFail = undefined;
  };
  const inspect = async (h: PermHandle): Promise<FolderPick> => {
    const f = makeFs(h);
    const files = await f.listAll();
    if (files.length === 0) return { name: h.name, kind: 'empty', exams: 0, rosters: 0, handle: h };
    const hasExams = (await f.listDirs('')).includes('exams');
    if (!files.includes('settings.json') || !hasExams) return { name: h.name, kind: 'other', exams: 0, rosters: 0, handle: h };
    try {
      const d = (await loadDoc(f)).data;
      return { name: h.name, kind: 'app', exams: d.exams.length, rosters: [d.rosters.senior, d.rosters.junior].filter((r) => r.length > 0).length, handle: h };
    } catch (e) {
      return { name: h.name, kind: 'app', exams: 0, rosters: 0, problem: e instanceof Error ? e.message : '讀不了這個資料夾的內容', handle: h };
    }
  };
  const need = (): DirFS => {
    if (!fs) throw new Error('尚未選擇資料夾');
    return fs;
  };

  return {
    hasFolder: () => fs !== null,
    folderName: () => folder,
    lastWarning: () => warning,
    async chooseFolder() {
      const pick = deps.pick ?? (() => (window as unknown as { showDirectoryPicker: (o: object) => Promise<PermHandle> }).showDirectoryPicker.call(window, { mode: 'readwrite' }));
      return adopt(await pick(), true);
    },
    saveStatus: () => status,
    onSaveStatus(f) { listeners.add(f); return () => { listeners.delete(f); }; },
    async retrySave() { return queue ? queue.retry() : true; },
    async adoptDropped(items) {
      for (const item of Array.from(items)) {
        const get = (item as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
          .getAsFileSystemHandle;
        if (!get) continue;
        const h = await get.call(item);
        if (h?.kind === 'directory') return adopt(h as PermHandle, true);
      }
      return false;
    },
    restoreProblem: () => restoreFail,
    async restore() {
      let name = '';
      try {
        const h = await idb<PermHandle | undefined>('readonly', (s) => s.get(KEY));
        if (!h) return false;
        name = h.name;
        // 上次的資料夾已經不在了（被刪除、改名或移動）：留下原因，初始化頁用白話說明
        if (!(await makeFs(h).exists())) { restoreFail = { kind: 'missing', name }; return false; }
        return await adopt(h);
      } catch (e) {
        if (isNotFound(e) && name) restoreFail = { kind: 'missing', name };
        return false;
      }
    },
    async checkFolder() {
      if (!fs || !queue) return true;
      const ok = await fs.exists().catch(() => true);
      if (!ok && !(status.state === 'error' && status.missing)) emit({ state: 'error', message: '找不到資料夾', missing: true });
      return ok;
    },
    pendingCount: () => queue?.pendingCount() ?? 0,
    lastSavedAt: () => queue?.lastSavedAt(),
    release() {
      if (folder) restoreFail = { kind: 'missing', name: folder };
      fs = null; queue = null; folder = '';
      emit({ state: 'idle' });
    },
    async pickFolder() {
      const pick = deps.pick ?? (() => (window as unknown as { showDirectoryPicker: (o: object) => Promise<PermHandle> }).showDirectoryPicker.call(window, { mode: 'readwrite' }));
      const h = await pick();
      if (!(await permission(h))) return null;
      return inspect(h);
    },
    async adoptPick(pickRes, opts) {
      const carry = opts.pending === 'carry' ? queue?.peek() : undefined;
      await install(pickRes.handle, makeFs(pickRes.handle));
      if (carry) queue!.enqueue(carry);
      return { carried: !!carry };
    },
    async moveTo(pickRes, onProgress, signal) {
      if (pickRes.kind !== 'empty') throw new MoveError('只能搬到空的資料夾。');
      if (!fs || !queue) throw new MoveError('目前沒有資料夾可以搬。');
      if (!(await fs.exists().catch(() => false))) throw new MoveError('目前的資料夾找不到，沒有東西可以複製。請先重新連結。');
      if (!(await queue.flush()) || queue.status().state === 'error') throw new MoveError('目前還有修改沒存進資料夾，請先處理好再搬。');
      const src = fs;
      const dst = makeFs(pickRes.handle);
      const files = await src.listAll();
      const written: string[] = [];
      const undo = async () => { for (const f of written) { try { await dst.remove(f); } catch { /* 清不掉就留著，由使用者處理 */ } } };
      try {
        for (let i = 0; i < files.length; i++) {
          if (signal?.aborted) throw new MoveError('已取消，沒有切換。');
          const text = await src.readText(files[i]!);
          if (text === null) throw new MoveError(`讀不到「${files[i]}」，已停止。`);
          await dst.writeText(files[i]!, text);
          written.push(files[i]!);
          onProgress?.(i + 1, files.length, 'copy');
        }
        for (let i = 0; i < files.length; i++) {
          if (signal?.aborted) throw new MoveError('已取消，沒有切換。');
          const [a, b] = await Promise.all([src.readText(files[i]!), dst.readText(files[i]!)]);
          if (a === null || a !== b) throw new MoveError(`核對「${files[i]}」時發現新舊內容不一致，已停止。`);
          onProgress?.(i + 1, files.length, 'verify');
        }
        await loadDoc(dst); // 新資料夾要讀得回來才算數
      } catch (e) {
        await undo();
        throw e instanceof MoveError ? e : new MoveError(`複製失敗，沒有切換，原資料夾沒有動。（${e instanceof Error ? e.message : String(e)}）`);
      }
      await install(pickRes.handle, dst);
      return { files: files.length };
    },
    async load(): Promise<Doc> {
      const r = await loadDoc(need());
      warning = r.warning;
      return r.data;
    },
    async save(doc) {
      need();
      queue!.enqueue(doc); // 排進佇列即返回；失敗由 onSaveStatus 通知畫面
    },
    async loadExamFile<K extends keyof ExamFiles>(examId: string, key: K): Promise<ExamFiles[K] | null> {
      const r = await loadExamFile(need(), examId, key);
      if (r?.warning) warning = r.warning;
      return r ? r.data : null;
    },
    async saveExamFile<K extends keyof ExamFiles>(examId: string, key: K, data: ExamFiles[K]): Promise<void> {
      await saveExamFile(need(), examId, key, data);
    },
  };
}
