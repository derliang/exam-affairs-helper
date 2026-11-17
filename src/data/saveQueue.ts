/**
 * 單一持久化佇列（#58）：同一資料夾的存檔一次只跑一個，連續操作只保留最新快照（合併），
 * 保證最後一次 enqueue 的快照最後寫入；寫入失敗不丟棄，保留到重試或被更新的快照取代。
 */
export type SaveStatus = { state: 'idle' | 'saving' } | { state: 'error'; message: string; /** 根資料夾不見了（被刪除、改名或移動；G16）：重試不會成功，要重新連結或更換資料夾 */ missing?: boolean };

/** 換資料夾時舊資料夾還有未存妥的變更 */
export class SwitchBlockedError extends Error {
  constructor() {
    super('目前資料夾還有未存妥的變更，已先不切換，仍使用原資料夾。請先按「重試存檔」。');
    this.name = 'SwitchBlockedError';
  }
}

export interface SaveQueue<T> {
  enqueue(snapshot: T): void;
  /** 等到佇列清空；回 true＝全部存妥，false＝有失敗的快照尚未存妥 */
  flush(): Promise<boolean>;
  /** 重寫失敗的快照；回傳是否存妥 */
  retry(): Promise<boolean>;
  isIdle(): boolean;
  status(): SaveStatus;
  /** 尚未存妥的最新快照（G16：換資料夾時帶到新資料夾，或交給使用者下載備份）；沒有回 undefined */
  peek(): T | undefined;
  /** 自上次成功存檔以來累計的修改次數（只算排進佇列的次數） */
  pendingCount(): number;
  /** 最近一次存妥的時間 */
  lastSavedAt(): Date | undefined;
}

export function createSaveQueue<T>(write: (snapshot: T) => Promise<void>, onStatus: (s: SaveStatus) => void = () => {}): SaveQueue<T> {
  let pending: { v: T } | null = null;
  let running: Promise<void> | null = null;
  let current: SaveStatus = { state: 'idle' };
  let dirty = 0;
  let savedAt: Date | undefined;
  const set = (s: SaveStatus) => { current = s; onStatus(s); };

  const loop = async () => {
    let failure: unknown;
    while (pending) {
      const job = pending;
      pending = null;
      set({ state: 'saving' });
      try {
        await write(job.v);
        failure = undefined;
      } catch (e) {
        failure = e;
        if (!pending) pending = job; // 沒有更新的快照：保留這份等重試
        else continue; // 有更新的快照：直接改寫新的
        break;
      }
    }
    running = null; // 與上面的 while 之間沒有 await，enqueue 不會插進來而漏掉
    if (failure !== undefined) set({ state: 'error', message: failure instanceof Error ? failure.message : String(failure) });
    else { dirty = 0; savedAt = new Date(); set({ state: 'idle' }); }
  };
  const start = () => {
    if (!running) running = loop();
  };
  const flush = async () => {
    while (running) await running;
    return pending === null;
  };
  return {
    enqueue(snapshot) { pending = { v: snapshot }; dirty++; start(); },
    flush,
    async retry() { if (pending) start(); return flush(); },
    isIdle: () => !running && pending === null,
    status: () => current,
    peek: () => pending?.v,
    pendingCount: () => dirty,
    lastSavedAt: () => savedAt,
  };
}
