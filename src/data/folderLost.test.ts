import { describe, expect, it } from 'vitest';
import { createMemoryFS, isNotFound, type DirFS } from './dirfs';
import { saveDoc } from './folder';
import { createFsRepository, MoveError, type PermHandle } from './fsRepository';
import { SwitchBlockedError } from './saveQueue';
import { emptyDoc } from '../ui/repository';
import type { Doc } from '../ui/store';

const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));
const mk = (n: number): Doc => ({ ...emptyDoc(), settings: { ...emptyDoc().settings, schoolName: `範例學校${n}` } });
const exam = (id: string) => ({ id, name: `考試${id}`, kind: 'gsat', division: 'senior', semester: 'first', participation: 'all', subjects: [{ id: 'chi', name: '國文' }], markRules: [], classroomIds: [], labelLayout: { paper: 'B4', cols: 7, rows: 7 }, createdAt: '2026-01-01' }) as unknown as Doc['exams'][number];

/** 一組假資料夾：名稱 → 記憶體檔案系統；handle 只是 { name } */
function world(setup: Record<string, Record<string, string>> = {}) {
  const fss = new Map<string, ReturnType<typeof createMemoryFS>>();
  const get = (name: string) => { let f = fss.get(name); if (!f) { f = createMemoryFS(setup[name] ?? {}); fss.set(name, f); } return f; };
  let next: string | null = null;
  const wrap = new Map<string, (f: DirFS) => DirFS>();
  const repo = createFsRepository({
    pick: async () => ({ name: next! }) as unknown as PermHandle,
    permission: async () => true,
    makeFs: (h) => { const f = get(h.name); const w = wrap.get(h.name); return w ? w(f) : f; },
    remember: async () => undefined,
  });
  return { repo, get, choose: (n: string) => { next = n; }, wrap };
}

async function seed(name: string, doc: Doc) {
  const w = world();
  const f = w.get(name);
  await saveDoc(f, doc);
  return f.files;
}

describe('G16 資料夾不見後的存檔與更換', () => {
  it('根資料夾被移除：存檔失敗標成 missing，重試不會成功，但更換資料夾不再被擋下', async () => {
    const w = world();
    w.choose('舊資料夾');
    expect(await w.repo.chooseFolder()).toBe(true);
    w.repo.save(mk(1));
    await tick();
    expect(w.repo.saveStatus!().state).toBe('idle');

    w.get('舊資料夾').gone.value = true; // 資料夾被刪除
    await w.repo.save(mk(2));
    await tick(20);
    const st = w.repo.saveStatus!();
    expect(st).toMatchObject({ state: 'error', missing: true });
    expect(w.repo.pendingCount()).toBeGreaterThan(0);
    expect(await w.repo.retrySave!()).toBe(false);
    expect(await w.repo.checkFolder()).toBe(false);

    // 舊的 chooseFolder 仍會擋（保留既有行為）；新流程 pickFolder＋adoptPick 不擋
    w.choose('新資料夾');
    await expect(w.repo.chooseFolder()).rejects.toBeInstanceOf(SwitchBlockedError);
    const pick = (await w.repo.pickFolder())!;
    expect(pick.kind).toBe('empty');
    const r = await w.repo.adoptPick(pick, { pending: 'discard' });
    expect(r.carried).toBe(false);
    expect(w.repo.folderName!()).toBe('新資料夾');
    expect(w.repo.saveStatus!()).toEqual({ state: 'idle' });
    expect(w.repo.pendingCount()).toBe(0);
    // 放棄後狀態乾淨：之後的存檔正常寫進新資料夾，沒有舊快照混進來
    await w.repo.save(mk(3));
    await tick(20);
    expect(w.get('新資料夾').files.get('settings.json')).toContain('範例學校3');
  });

  it('更換到空資料夾可選「把暫存修改存進新資料夾」（carry）', async () => {
    const w = world();
    w.choose('A');
    await w.repo.chooseFolder();
    w.get('A').gone.value = true;
    await w.repo.save(mk(7));
    await tick(20);
    w.choose('B');
    const pick = (await w.repo.pickFolder())!;
    const r = await w.repo.adoptPick(pick, { pending: 'carry' });
    expect(r.carried).toBe(true);
    await w.repo.retrySave!();
    await tick(20);
    expect(w.get('B').files.get('settings.json')).toContain('範例學校7');
    expect(w.repo.saveStatus!().state).toBe('idle');
  });

  it('pickFolder 辨識空資料夾、本 App 資料夾、其他內容，並數出模擬考與名單', async () => {
    const files = await seed('X', { ...mk(1), exams: [exam('e1'), exam('e2')], rosters: { senior: [{ classNo: 1, seatNo: 1, name: '測試甲' }], junior: [{ classNo: 1, seatNo: 1, name: '測試乙' }] } });
    const w = world({ X: Object.fromEntries(files), 雜: { 'a.txt': 'hi' } });
    w.choose('X');
    expect(await w.repo.pickFolder()).toMatchObject({ kind: 'app', exams: 2, rosters: 2 });
    w.choose('雜');
    expect(await w.repo.pickFolder()).toMatchObject({ kind: 'other' });
    w.choose('空');
    expect(await w.repo.pickFolder()).toMatchObject({ kind: 'empty' });
  });

  it('版本較新的資料夾：kind=app 但帶 problem，不可使用', async () => {
    const newer = JSON.stringify({ schemaVersion: 999, checksum: 'x', data: {} });
    const w = world({ N: { 'settings.json': newer, 'exams/e1/exam.json': newer } });
    w.choose('N');
    const p = (await w.repo.pickFolder())!;
    expect(p.kind).toBe('app');
    expect(p.problem).toBeTruthy();
  });
});

describe('G24 重新連結', () => {
  it('資料夾被改名：選回改名後的資料夾，資料原封不動、暫存修改接著存進去', async () => {
    const orig = await seed('原名', { ...mk(1), exams: [exam('e1')] });
    const w = world({ 新名: Object.fromEntries(orig) });
    w.choose('原名');
    await w.repo.chooseFolder();
    w.get('原名').gone.value = true;
    await w.repo.save({ ...mk(1), exams: [exam('e1')], settings: { ...mk(1).settings, schoolName: '範例學校1（改）' } });
    await tick(20);
    expect(w.repo.saveStatus!()).toMatchObject({ missing: true });
    w.choose('新名');
    const pick = (await w.repo.pickFolder())!;
    expect(pick).toMatchObject({ kind: 'app', exams: 1 });
    const r = await w.repo.adoptPick(pick, { pending: 'carry' });
    expect(r.carried).toBe(true);
    await w.repo.retrySave!();
    await tick(20);
    expect(w.get('新名').files.get('exams/e1/exam.json')).toBeTruthy(); // 原有檔案還在
    expect(w.get('新名').files.get('settings.json')).toContain('範例學校1（改）');
    expect(w.repo.folderName!()).toBe('新名');
  });
});

describe('G24 搬到新位置', () => {
  const doc = () => ({ ...mk(1), exams: [exam('e1'), exam('e2')] });
  it('複製到空資料夾、逐檔核對後改用新資料夾；舊資料夾原封不動', async () => {
    const w = world();
    w.choose('舊');
    await w.repo.chooseFolder();
    await w.repo.save(doc());
    await w.repo.retrySave!();
    await tick(20);
    const before = new Map(w.get('舊').files);
    expect(before.size).toBeGreaterThan(3);
    w.choose('新');
    const pick = (await w.repo.pickFolder())!;
    const seen: string[] = [];
    const res = await w.repo.moveTo(pick, (d, t, ph) => seen.push(`${ph}:${d}/${t}`));
    expect(res.files).toBe(before.size);
    expect(seen[0]).toMatch(/^copy:1\//);
    expect(seen.some((s) => s.startsWith('verify:'))).toBe(true);
    expect(w.repo.folderName!()).toBe('新');
    for (const [k, v] of before) expect(w.get('新').files.get(k)).toBe(v);
    expect(w.get('舊').files).toEqual(before); // 舊資料夾沒被動
  });
  it('只接受空資料夾：本 App 資料夾與其他內容都被拒，且不切換', async () => {
    const files = await seed('已有', mk(2));
    const w = world({ 已有: Object.fromEntries(files), 雜: { 'a.txt': 'x' } });
    w.choose('舊');
    await w.repo.chooseFolder();
    await w.repo.save(doc());
    await tick(20);
    for (const n of ['已有', '雜']) {
      w.choose(n);
      const pick = (await w.repo.pickFolder())!;
      await expect(w.repo.moveTo(pick)).rejects.toBeInstanceOf(MoveError);
      expect(w.repo.folderName!()).toBe('舊');
    }
  });
  it('複製中途失敗：清掉已複製的檔案、不切換、舊資料夾不動', async () => {
    const w = world();
    w.choose('舊');
    await w.repo.chooseFolder();
    await w.repo.save(doc());
    await tick(20);
    const before = new Map(w.get('舊').files);
    let n = 0;
    w.wrap.set('新', (f) => ({ ...f, writeText: async (p, t) => { if (++n === 3) throw new Error('磁碟已滿'); return f.writeText(p, t); } }));
    w.choose('新');
    const pick = (await w.repo.pickFolder())!;
    await expect(w.repo.moveTo(pick)).rejects.toBeInstanceOf(MoveError);
    expect(w.repo.folderName!()).toBe('舊');
    expect(w.get('新').files.size).toBe(0);
    expect(w.get('舊').files).toEqual(before);
  });
  it('核對不一致（新資料夾寫進去的內容被改）：失敗、回復、不切換', async () => {
    const w = world();
    w.choose('舊');
    await w.repo.chooseFolder();
    await w.repo.save(doc());
    await tick(20);
    w.wrap.set('新', (f) => ({ ...f, writeText: async (p, t) => f.writeText(p, p === 'settings.json' ? t + ' ' : t) }));
    w.choose('新');
    const pick = (await w.repo.pickFolder())!;
    await expect(w.repo.moveTo(pick)).rejects.toThrow(/不一致/);
    expect(w.repo.folderName!()).toBe('舊');
    expect(w.get('新').files.size).toBe(0);
  });
  it('目前資料夾找不到時不能搬', async () => {
    const w = world();
    w.choose('舊');
    await w.repo.chooseFolder();
    w.get('舊').gone.value = true;
    w.choose('新');
    const pick = (await w.repo.pickFolder())!;
    await expect(w.repo.moveTo(pick)).rejects.toThrow(/找不到/);
  });
});

describe('dirfs 輔助', () => {
  it('記憶體資料夾被移除後所有操作丟 NotFoundError，exists 為 false', async () => {
    const f = createMemoryFS({ 'a.json': '1' });
    f.gone.value = true;
    expect(await f.exists()).toBe(false);
    await expect(f.writeText('b', '2')).rejects.toSatisfy(isNotFound);
  });
});
