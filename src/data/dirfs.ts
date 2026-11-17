/**
 * 資料夾存取的最小抽象：邏輯層只依賴 DirFS，
 * 測試用記憶體實作，瀏覽器用 File System Access API 實作（D1）。
 * 路徑用 "/" 分隔的相對路徑，例 "settings.json"、"exam-1/exam.json"。
 */
export interface DirFS {
  /** 檔案不存在回 null */
  readText(path: string): Promise<string | null>;
  /** 自動建立中間資料夾 */
  writeText(path: string, text: string): Promise<void>;
  /** 列出某資料夾下的子資料夾名稱（"" 為根） */
  listDirs(dir: string): Promise<string[]>;
  /** 刪除檔案；不存在不報錯 */
  remove(path: string): Promise<void>;
  /** 資料夾本身還在嗎（G16）：被刪除、改名或移走回 false；其他讀取錯誤不當成「不見了」 */
  exists(): Promise<boolean>;
  /** 列出所有檔案的相對路徑（遞迴；G24 搬到新位置用） */
  listAll(): Promise<string[]>;
}

/** 瀏覽器回報「找不到檔案或資料夾」（根資料夾被刪除、改名或移動時，寫入與列舉都會丟這個） */
export const isNotFound = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: string }).name === 'NotFoundError';

const notFound = () => new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');

/** 記憶體實作；`gone.value = true` 模擬根資料夾被刪除（之後所有操作丟 NotFoundError，與瀏覽器一致） */
export function createMemoryFS(initial: Record<string, string> = {}): DirFS & { files: Map<string, string>; gone: { value: boolean } } {
  const files = new Map(Object.entries(initial));
  const gone = { value: false };
  const chk = () => { if (gone.value) throw notFound(); };
  return {
    files,
    gone,
    exists: async () => !gone.value,
    listAll: async () => { chk(); return [...files.keys()].sort(); },
    readText: async (p) => { chk(); return files.get(p) ?? null; },
    writeText: async (p, t) => {
      chk();
      files.set(p, t);
    },
    listDirs: async (dir) => {
      chk();
      const prefix = dir ? `${dir}/` : '';
      const out = new Set<string>();
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          const i = rest.indexOf('/');
          if (i > 0) out.add(rest.slice(0, i));
        }
      }
      return [...out].sort();
    },
    remove: async (p) => {
      chk();
      files.delete(p);
    },
  };
}

type Dir = FileSystemDirectoryHandle;

/** 瀏覽器實作；寫入走 createWritable（關閉時才換檔，寫到一半中斷不會留下半個檔） */
export function createHandleFS(root: Dir): DirFS {
  const walk = async (path: string, create: boolean): Promise<{ dir: Dir; name: string } | null> => {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() ?? '';
    let dir = root;
    for (const p of parts) {
      try {
        dir = await dir.getDirectoryHandle(p, { create });
      } catch (e) {
        if (!create && e instanceof DOMException && e.name === 'NotFoundError') return null;
        throw e;
      }
    }
    return { dir, name };
  };
  const collect = async (dir: Dir, prefix: string, out: string[]): Promise<void> => {
    for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind === 'directory') await collect(h as Dir, `${prefix}${name}/`, out);
      else out.push(`${prefix}${name}`);
    }
  };
  return {
    async exists() {
      try {
        for await (const _ of root as unknown as AsyncIterable<unknown>) { void _; break; }
        return true;
      } catch (e) {
        return !isNotFound(e);
      }
    },
    async listAll() {
      const out: string[] = [];
      await collect(root, '', out);
      return out.sort();
    },
    async readText(path) {
      const loc = await walk(path, false);
      if (!loc) return null;
      try {
        const fh = await loc.dir.getFileHandle(loc.name);
        return await (await fh.getFile()).text();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return null;
        throw e;
      }
    },
    async writeText(path, text) {
      const loc = await walk(path, true);
      if (!loc) return;
      const fh = await loc.dir.getFileHandle(loc.name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    },
    async listDirs(dir) {
      const loc = dir ? await walk(`${dir}/x`, false) : { dir: root, name: '' };
      if (!loc) return [];
      const out: string[] = [];
      for await (const [name, h] of loc.dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind === 'directory') out.push(name);
      }
      return out.sort();
    },
    async remove(path) {
      const loc = await walk(path, false);
      if (!loc) return;
      try {
        await loc.dir.removeEntry(loc.name);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
    },
  };
}
