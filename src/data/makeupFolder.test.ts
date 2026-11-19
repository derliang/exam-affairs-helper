import { describe, expect, it } from 'vitest';
import { createMemoryFS } from './dirfs';
import { createIncrementalSaver, loadDoc, saveDoc } from './folder';
import { demoDoc } from '../ui/repository';
import { addMakeup, deleteMakeup } from '../ui/makeup/session';
import { baseOf } from '../ui/makeup/pipeline';
import { fakeSession } from '../ui/makeup/testKit';

describe('補考場次存檔：makeup/<id>/session.json（D2：一場一個資料夾）', () => {
  it('存了讀得回來：名單、教室、設定一樣，問題列草稿的 NaN 還原', async () => {
    const fs = createMemoryFS();
    const s0 = fakeSession({ id: 'mk-a' });
    const bad = { ...s0.parse!.rows[0]!, rowId: '900', srcRow: 900, oldSeat: Number.NaN, name: '' };
    const s = { ...s0, parse: { ...s0.parse!, problems: [{ rowId: '900', srcRow: 900, kind: 'no-name' as const, message: 'm', cells: [], draft: bad }] }, resolutions: [{ rowId: '900', action: 'fix' as const, row: { ...bad, oldSeat: Number.NaN } }] };
    await saveDoc(fs, addMakeup(demoDoc(), s));
    expect([...fs.files.keys()].some((k) => k === 'makeup/mk-a/session.json')).toBe(true);
    const back = (await loadDoc(fs)).data;
    expect(back.makeups).toHaveLength(1);
    const m = back.makeups![0]!;
    expect(m.id).toBe('mk-a');
    expect(m.rooms).toEqual(s.rooms);
    expect(m.days).toEqual(s.days);
    expect(m.parse!.rows).toEqual(s.parse!.rows);
    expect(Number.isNaN(m.parse!.problems[0]!.draft.oldSeat)).toBe(true);
    expect(Number.isNaN((m.resolutions[0] as { row: { oldSeat: number } }).row.oldSeat)).toBe(true);
    // 讀回來再算，結果與原本一樣（版本碼不因存檔而變）
    expect(baseOf(m).roster.included.length).toBe(baseOf(s).roster.included.length);
  });
  it('沒有補考的舊資料夾照常載入，doc.makeups 沒有欄位', async () => {
    const fs = createMemoryFS();
    await saveDoc(fs, demoDoc());
    expect((await loadDoc(fs)).data.makeups).toBeUndefined();
  });
  it('刪除場次：檔案與備份都移除（完整存檔與增量存檔都一樣）', async () => {
    const fs = createMemoryFS();
    const d = addMakeup(addMakeup(demoDoc(), fakeSession({ id: 'mk-a' })), fakeSession({ id: 'mk-b' }));
    await saveDoc(fs, d);
    await saveDoc(fs, deleteMakeup(d, 'mk-a'));
    expect([...fs.files.keys()].filter((k) => k.startsWith('makeup/'))).toEqual(['makeup/mk-b/session.json']);

    const fs2 = createMemoryFS();
    const save = createIncrementalSaver(fs2);
    await save(d);
    expect(fs2.files.has('makeup/mk-a/session.json')).toBe(true);
    const d2 = deleteMakeup(d, 'mk-a');
    await save(d2);
    expect([...fs2.files.keys()].filter((k) => k.startsWith('makeup/') && !k.endsWith('.bak'))).toEqual(['makeup/mk-b/session.json']);
    // 復原回來要重寫
    await save(d);
    expect(fs2.files.has('makeup/mk-a/session.json')).toBe(true);
  });
  it('增量存檔：場次沒變就不重寫', async () => {
    const fs = createMemoryFS();
    const writes: string[] = [];
    const orig = fs.writeText.bind(fs);
    fs.writeText = async (p: string, t: string) => { writes.push(p); return orig(p, t); };
    const save = createIncrementalSaver(fs);
    const d = addMakeup(demoDoc(), fakeSession({ id: 'mk-a' }));
    await save(d);
    const n = writes.filter((w) => w.startsWith('makeup/')).length;
    await save({ ...d });
    expect(writes.filter((w) => w.startsWith('makeup/')).length).toBe(n);
  });
});
