import { describe, expect, it } from 'vitest';
import { createMemoryFS } from './dirfs';
import { saveDoc } from './folder';
import { createFsRepository, type PermHandle } from './fsRepository';
import { emptyDoc } from '../ui/repository';

/** #464：重開網頁還原上次資料夾。授權視窗必須在點擊後第一個動作開，失敗要留下真正原因 */
async function setup(opts: { stored?: boolean; allow?: boolean; granted?: boolean; exists?: boolean; fail?: Error } = {}) {
  const log: string[] = [];
  const fs = createMemoryFS();
  await saveDoc(fs, emptyDoc());
  if (opts.exists === false) fs.gone.value = true;
  const h = { name: '模擬考資料' } as unknown as PermHandle;
  const repo = createFsRepository({
    recall: async () => { log.push('recall'); if (opts.fail) throw opts.fail; return opts.stored === false ? undefined : h; },
    granted: async () => { log.push('query'); return !!opts.granted; },
    permission: async () => { log.push('request'); return opts.allow !== false; },
    makeFs: () => { const e = fs.exists; return { ...fs, exists: async () => { log.push('exists'); return e(); } }; },
    remember: async () => undefined,
  });
  return { repo, log };
}

describe('還原上次資料夾（#464）', () => {
  it('啟動：還沒授權就停下，原因是 needPermission，而且不呼叫授權視窗', async () => {
    const { repo, log } = await setup({ granted: false });
    expect(await repo.restore({ gesture: false })).toBe(false);
    expect(repo.restoreProblem()).toEqual({ kind: 'needPermission', name: '模擬考資料' });
    expect(log).not.toContain('request');
  });

  it('啟動：已經授權（Chrome 記住了）就直接接回', async () => {
    const { repo } = await setup({ granted: true });
    expect(await repo.restore({ gesture: false })).toBe(true);
    expect(repo.hasFolder()).toBe(true);
    expect(repo.restoreProblem()).toBeUndefined();
  });

  it('按鈕：有啟動時讀好的控制代碼，授權是點擊後的第一個動作（先於 IndexedDB 與讀資料夾）', async () => {
    const { repo, log } = await setup({ granted: false });
    await repo.restore({ gesture: false });
    log.length = 0;
    expect(await repo.restore({ gesture: true })).toBe(true);
    expect(log[0]).toBe('request');
    expect(log).not.toContain('recall');
    expect(repo.restoreProblem()).toBeUndefined();
  });

  it('按鈕：使用者按「不允許」→ denied', async () => {
    const { repo } = await setup({ granted: false, allow: false });
    await repo.restore({ gesture: false });
    expect(await repo.restore({ gesture: true })).toBe(false);
    expect(repo.restoreProblem()).toEqual({ kind: 'denied', name: '模擬考資料' });
    expect(repo.hasFolder()).toBe(false);
  });

  it('瀏覽器沒有記住任何資料夾 → noHandle', async () => {
    const { repo } = await setup({ stored: false });
    expect(await repo.restore({ gesture: false })).toBe(false);
    expect(repo.restoreProblem()).toEqual({ kind: 'noHandle', name: '' });
  });

  it('資料夾被刪除或移走 → missing', async () => {
    const { repo } = await setup({ exists: false, granted: true });
    expect(await repo.restore({ gesture: false })).toBe(false);
    expect(repo.restoreProblem()?.kind).toBe('missing');
  });

  it('其他錯誤不再被吞掉：留下 error 與瀏覽器訊息', async () => {
    const e = new DOMException('boom', 'SecurityError');
    const { repo } = await setup({ fail: e });
    expect(await repo.restore({ gesture: true })).toBe(false);
    const p = repo.restoreProblem();
    expect(p?.kind).toBe('error');
    expect(p && 'detail' in p ? p.detail : '').toContain('boom');
  });
});
