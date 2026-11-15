import { describe, expect, it } from 'vitest';
import { createMemoryFS } from '../data/dirfs';
import { createIncrementalSaver, loadDoc, saveDoc } from '../data/folder';
import { demoDoc } from './repository';
import { activateForExam, classesFor, migrateRosterYear, relabelRosterYear, rosterFor, rosterYearMismatch, rosterYearOf, rosterYears, switchRosterYear, viewForYear } from './rosterYears';
import { newExam, syncDiffs, type Doc } from './store';

const today = new Date(2026, 10, 15); // 115 學年
const withExam = (year: number, name: string, d: Doc = { ...demoDoc(), exams: [] }): Doc => {
  const r = newExam(d, 'gsat', name, new Date(today.getTime() + d.exams.length * 1000), { year });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe('舊存檔遷移（#208）：不丟資料', () => {
  it('沒標學年度的舊存檔：標成最近一次考試的學年度，名單與班級原封不動', () => {
    const old = withExam(115, '學測第一次', withExam(114, '分科舊'));
    expect(old.rosterYear).toBeUndefined();
    const m = migrateRosterYear(old);
    expect(m.rosterYear).toBe(115);
    expect(m.rosters).toBe(old.rosters);
    expect(m.settings.classes).toBe(old.settings.classes);
    expect(m.otherYears).toBeUndefined();
  });
  it('沒有任何考試：用今天推算；已標示的原物件回傳（不觸發存檔）', () => {
    expect(migrateRosterYear({ ...demoDoc(), exams: [] }, today).rosterYear).toBe(115);
    const m = migrateRosterYear({ ...demoDoc(), exams: [] }, today);
    expect(migrateRosterYear(m)).toBe(m);
  });
  it('只有一份名單時，兩個學年度的考試都退回用它（行為與分年度之前相同）', () => {
    const d = migrateRosterYear(withExam(115, '學測第一次', withExam(114, '分科舊')));
    for (const e of d.exams) expect(rosterFor(d, e)).toBe(d.rosters);
  });
});

describe('切換學年度', () => {
  const base = () => migrateRosterYear(withExam(115, '學測第一次', withExam(114, '分科舊')));
  it('切到新學年度：名單空白、班級沿用；原本的收進 otherYears，切回來原樣回來', () => {
    const d = base();
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.rosterYear).toBe(114);
    expect(r.doc.rosters).toEqual({ senior: [], junior: [] });
    expect(r.doc.settings.classes).toEqual(d.settings.classes);
    expect(r.doc.otherYears?.['115']?.rosters).toBe(d.rosters);
    const back = switchRosterYear(r.doc, 115);
    if (!back.ok) throw new Error(back.error);
    expect(back.doc.rosters).toBe(d.rosters);
    expect(back.doc.otherYears).toEqual({ '114': { rosters: { senior: [], junior: [] }, classes: d.settings.classes } });
    expect(rosterYears(r.doc)).toEqual([114, 115]);
  });
  it('兩年度名單並存：各考試取自己年度的名單與班級', () => {
    const d = base();
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    const d114: Doc = { ...r.doc, rosters: { senior: [{ classNo: 1, seatNo: 1, name: '去年生' }], junior: [] } };
    const e114 = d114.exams.find((e) => e.name === '分科舊')!;
    const e115 = d114.exams.find((e) => e.name === '學測第一次')!;
    expect(rosterFor(d114, e114).senior[0]!.name).toBe('去年生');
    expect(rosterFor(d114, e115).senior.length).toBe(5);
    expect(classesFor(d114, e115)).toBe(d114.otherYears!['115']!.classes);
    expect(viewForYear(d114, 115).rosters.senior.length).toBe(5);
    expect(rosterYearMismatch(d114, e115)).toBe(true);
    expect(rosterYearMismatch(d114, e114)).toBe(false);
  });
  it('開考試時：有該學年度資料才換過去，沒有就不動（不憑空變空白）', () => {
    const d = base();
    const e114 = d.exams.find((e) => e.name === '分科舊')!;
    expect(activateForExam(d, e114)).toBe(d);
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    const e115 = r.doc.exams.find((e) => e.name === '學測第一次')!;
    const a = activateForExam(r.doc, e115);
    expect(rosterYearOf(a)).toBe(115);
    expect(a.rosters).toBe(d.rosters);
  });
  it('不同年度的名單互不影響比對：115 考試不會被 114 名單打成已過期／全是差異', () => {
    const d = base();
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    const e115 = r.doc.exams.find((e) => e.name === '學測第一次')!;
    const entries = d.rosters.senior.map((s) => ({ ...s, subjectIds: ['chinese'] }));
    const doc: Doc = { ...r.doc, examFiles: { [e115.id]: { entries, diffs: [] } } };
    expect(syncDiffs(doc)).toBe(doc); // 用 115 名單比對，沒有差異
  });
  it('改標學年度：撞到已有資料的年度會擋下；不合理年度擋下', () => {
    const d = base();
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    expect(relabelRosterYear(r.doc, 115).ok).toBe(false);
    expect(relabelRosterYear(r.doc, 113).ok).toBe(true);
    expect(switchRosterYear(d, 5).ok).toBe(false);
  });
});

describe('存檔與載入', () => {
  const twoYears = (): Doc => {
    const d = migrateRosterYear(withExam(115, '學測第一次', withExam(114, '分科舊')));
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    return { ...r.doc, rosters: { senior: [{ classNo: 1, seatNo: 1, name: '去年生' }], junior: [] } };
  };
  it('saveDoc → loadDoc 來回一致（含其他學年度）', async () => {
    const fs = createMemoryFS();
    const d = twoYears();
    await saveDoc(fs, d);
    const { data } = await loadDoc(fs);
    expect(data.rosterYear).toBe(114);
    expect(data.otherYears).toEqual(d.otherYears);
    expect(data.rosters).toEqual(d.rosters);
  });
  it('舊資料夾（沒有學年度檔）可原樣載入：不報錯、名單照舊', async () => {
    const fs = createMemoryFS();
    const old = { ...demoDoc(), exams: [] };
    await saveDoc(fs, old);
    expect([...fs.files.keys()].some((k) => k.startsWith('years/') || k === 'roster-year.json')).toBe(false);
    const { data } = await loadDoc(fs);
    expect(data.rosterYear).toBeUndefined();
    expect(data.otherYears).toBeUndefined();
    expect(data.rosters).toEqual(old.rosters);
  });
  it('增量存檔：與完整存檔落盤相同；合併掉其他學年度後舊檔被移除', async () => {
    const snap = (m: Map<string, string>) => [...m.entries()].filter(([k]) => !k.endsWith('.bak')).sort(([a], [b]) => a.localeCompare(b));
    const d = twoYears();
    const full = createMemoryFS();
    await saveDoc(full, d);
    const inc = createMemoryFS();
    const save = createIncrementalSaver(inc);
    await save(d);
    expect(snap(inc.files)).toEqual(snap(full.files));
    const back = switchRosterYear(d, 115);
    if (!back.ok) throw new Error(back.error);
    const gone: Doc = { ...back.doc, otherYears: {} };
    await save(gone);
    expect([...inc.files.keys()].filter((k) => k.startsWith('years/') && !k.endsWith('.bak'))).toEqual([]);
  });
});
