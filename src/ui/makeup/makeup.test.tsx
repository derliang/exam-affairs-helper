/**
 * 補考 K2：場次存取、新增與延續（F-6）、匯入與問題列、教室容量、計畫調整、步驟畫面。
 * 全部假資料（K1 的 fakeSheet），不含真實學生。
 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createMemoryFS } from '../../data/dirfs';
import { createIncrementalSaver, loadDoc, saveDoc } from '../../data/folder';
import { fakeSheet, HEADER, room } from '../../core/makeup/fixtures';
import { GRADE_TEXT, parseMakeupSheet, runMakeupChecks, type MakeupParseResult } from '../../core/makeup';
import { describeChange } from '../describeChange';
import { Exams } from '../pages/Exams';
import { NewExam } from '../pages/NewExam';
import { demoDoc } from '../repository';
import type { Doc } from '../store';
import {
  addDay, addGroup, applyImport, checkMakeupName, dateLabel, deleteMakeup, derive, diffImport, makeupFlow, makeupProgress, mergeParse, moveSlot, newMakeup,
  patchGroup, placeSubject, removeGroup, roomsPatch, rosterOf, setClassTrackLabel, setEarly, setGradeGroup, setPin, setResolution, settingsIssues, stampMakeups,
  suggestMakeupName, toggleSplitSubject, updateMakeup, withRoomShape, type MakeupSession,
} from './model';
import { MakeupWorkspace } from './MakeupWorkspace';

const NOW = new Date('2026-11-18T02:00:00Z');
const noop = () => undefined;

const sheet = () => fakeSheet({ seed: 7, classes: [{ oldClass: '101', students: 30 }, { oldClass: '102', students: 28 }, { oldClass: '201', students: 25 }, { oldClass: '701', students: 20 }], maxSubjects: 4, notifyOnlyPerClass: 1 });
const parseOf = (rows = sheet()): MakeupParseResult => parseMakeupSheet(rows);

/** 一份有名單、有足夠教室的補考場次 */
function fixture(): { doc: Doc; id: string } {
  const r = newMakeup(demoDoc(), '115 學年第一學期補考', NOW, { schoolYear: 115, semester: 'first' });
  if (!r.ok) throw new Error(r.error);
  const id = r.doc.makeups![0]!.id;
  let doc = updateMakeup(r.doc, id, (m) => applyImport(m, '假名單.xlsx', parseOf(), NOW));
  doc = updateMakeup(doc, id, (m) => roomsPatch(m, [room(60, 'class', '甲教室'), room(60, 'class', '乙教室'), room(60, 'class', '丙教室'), room(40, 'mixed', '混班'), room(20, 'special', '特別')]));
  return { doc, id };
}
const get = (doc: Doc, id: string): MakeupSession => doc.makeups!.find((m) => m.id === id)!;

describe('新增補考場次與延續上一次設定（F-6）', () => {
  it('名稱建議與重名檢查（含模擬考名稱）', () => {
    const d = demoDoc();
    expect(suggestMakeupName(d, 115, 'first')).toBe('115 學年第一學期補考');
    expect(checkMakeupName(d, '').ok).toBe(false);
    expect(checkMakeupName(d, 'x'.repeat(31)).ok).toBe(false);
    const r = newMakeup(d, '115 學年第一學期補考', NOW, { schoolYear: 115, semester: 'first' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(suggestMakeupName(r.doc, 115, 'first')).toBe('115 學年第一學期補考（2）');
    expect(checkMakeupName(r.doc, '115 學年第一學期補考').ok).toBe(false);
    expect(newMakeup(r.doc, '115 學年第一學期補考', NOW, { schoolYear: 115, semester: 'first' }).ok).toBe(false);
  });

  it('預設：一個考日、高中與初中各一群組（50／45 分、休息 10、8:00），沒有教室、座位表預設產生、標籤不產生', () => {
    const r = newMakeup(demoDoc(), '測試補考', NOW, { schoolYear: 115, semester: 'second' });
    if (!r.ok) throw new Error();
    const m = r.doc.makeups![0]!;
    expect(m.settings.days).toHaveLength(1);
    expect(m.settings.groups.map((g) => [g.label, g.periodMin, g.breakMin, g.start])).toEqual([['高中', 50, 10, 480], ['初中', 45, 10, 480]]);
    expect(m.settings.rooms).toEqual([]);
    expect([m.seatMap, m.labels]).toEqual([true, false]);
    expect(m.source).toBeUndefined();
  });

  it('新增第二場：帶入上一場的教室、群組時長、提前開考參數；名單與計畫空白，考日名稱重填', () => {
    const { doc, id } = fixture();
    let d = updateMakeup(doc, id, (m) => patchGroup(m, m.settings.groups[0]!.id, { periodMin: 55, start: 510 }));
    d = updateMakeup(d, id, (m) => ({ ...m, settings: { ...m.settings, early: { suggestOverMin: 120, capMin: 200 } }, labels: true }));
    d = updateMakeup(d, id, (m) => setDayLabel0(m, '1/23（六）'));
    const r = newMakeup(d, '下一場補考', new Date('2026-11-19T02:00:00Z'), { schoolYear: 115, semester: 'second' });
    if (!r.ok) throw new Error();
    const n = r.doc.makeups!.find((x) => x.name === '下一場補考')!;
    expect(n.settings.rooms.map((x) => x.name)).toEqual(['甲教室', '乙教室', '丙教室', '混班', '特別']);
    expect(n.settings.groups[0]!.periodMin).toBe(55);
    expect(n.settings.groups[0]!.start).toBe(510);
    expect(n.settings.early).toEqual({ suggestOverMin: 120, capMin: 200 });
    expect(n.labels).toBe(true);
    expect(n.settings.days[0]!.label).toBe('考日一'); // 日期要重填
    expect(n.source).toBeUndefined();
    expect(n.resolutions).toEqual([]);
    expect(n.plan).toBeUndefined();
    // 兩場的教室是各自一份，改一邊不影響另一邊
    expect(n.settings.rooms).not.toBe(get(r.doc, id).settings.rooms);
  });
});
const setDayLabel0 = (m: MakeupSession, label: string): MakeupSession => ({ ...m, settings: { ...m.settings, days: m.settings.days.map((d, i) => (i === 0 ? { ...d, label } : d)) } });

describe('存檔：makeups/<id>/makeup.json', () => {
  it('saveDoc → loadDoc 往返相同；沒有補考的舊資料夾照常載入', async () => {
    const { doc } = fixture();
    const fs = createMemoryFS();
    await saveDoc(fs, doc);
    expect([...fs.files.keys()].some((k) => /^makeups\/makeup-20261118-1\/makeup\.json$/.test(k))).toBe(true);
    const back = (await loadDoc(fs)).data;
    expect(back.makeups).toEqual(doc.makeups);
    const fs2 = createMemoryFS();
    await saveDoc(fs2, demoDoc());
    expect((await loadDoc(fs2)).data.makeups).toBeUndefined();
  });

  it('刪除場次：主檔與備份都移除；增量存檔與完整存檔結果一致、沒變不重寫', async () => {
    const { doc, id } = fixture();
    const fs = createMemoryFS();
    const save = createIncrementalSaver(fs);
    await save(doc);
    const changed = updateMakeup(doc, id, (m) => ({ ...m, name: '改名了' }));
    await save(changed);
    await save(changed); // 沒變
    expect((await loadDoc(fs)).data.makeups![0]!.name).toBe('改名了');
    const gone = deleteMakeup(changed, id);
    await save(gone);
    expect([...fs.files.keys()].filter((k) => k.startsWith('makeups/'))).toEqual([]);
    const full = createMemoryFS();
    await saveDoc(full, gone);
    expect([...fs.files.keys()].filter((k) => !k.endsWith('.bak')).sort()).toEqual([...full.files.keys()].filter((k) => !k.endsWith('.bak')).sort());
  });

  it('主檔損壞時改讀 .bak（沿用資料夾的備份機制）', async () => {
    const { doc, id } = fixture();
    const fs = createMemoryFS();
    await saveDoc(fs, doc);
    await saveDoc(fs, updateMakeup(doc, id, (m) => ({ ...m, name: '第二版' })));
    fs.files.set(`makeups/${id}/makeup.json`, '{壞掉');
    const r = await loadDoc(fs);
    expect(r.data.makeups![0]!.name).toBe('115 學年第一學期補考');
    expect(r.warning).toContain('已損壞');
  });
});

describe('② 匯入與問題列', () => {
  it('匯入對帳（C-1）：匯入列數 ＝ 納入＋另行通知＋略過＋未處理', () => {
    const { doc, id } = fixture();
    const r = rosterOf(get(doc, id))!;
    expect(r.included.length + r.notified.length + r.skipped.length + r.unresolved.length).toBe(r.rawCount);
    expect(r.unresolved).toEqual([]);
    expect(r.notified.length).toBeGreaterThan(0);
  });

  it('有問題列：未處理前 ② 紅燈擋下；略過要有原因並留紀錄；補上後歸零；全部處理完 ② 完成', () => {
    const rows = sheet();
    rows.push(['', '101', '77', '101', '77', '無學號生', 'X1', '數學', '2', '0', '1', '30']); // 沒學號
    rows.push(['9ZZZ01', '101', '78', '101', '78', '', 'X1', '數學', '2', '0', '1', '30']); // 沒姓名
    const r0 = newMakeup(demoDoc(), '問題列測試', NOW, { schoolYear: 115, semester: 'first' });
    if (!r0.ok) throw new Error();
    const id = r0.doc.makeups![0]!.id;
    let m = applyImport(get(r0.doc, id), 'x.xlsx', parseOf(rows), NOW);
    let ro = rosterOf(m)!;
    expect(ro.unresolved.map((u) => u.kind).sort()).toEqual(['no-id', 'no-name']);
    expect(makeupFlow(m).states[2]).toBe('todo');
    expect(makeupFlow(m).issues.some((i) => i.step === 2 && i.text.includes('2 筆問題列'))).toBe(true);
    // 略過：留紀錄與原因
    const noId = ro.unresolved.find((u) => u.kind === 'no-id')!;
    m = setResolution(m, { rowId: noId.rowId, action: 'skip', reason: 'transferred' }, noId.rowId);
    ro = rosterOf(m)!;
    expect(ro.skipped).toHaveLength(1);
    expect(ro.skipped[0]!.reason).toBe('transferred');
    // 補上姓名
    const noName = ro.unresolved[0]!;
    m = setResolution(m, { rowId: noName.rowId, action: 'fix', row: { ...noName.draft, name: '補名生' } }, noName.rowId);
    ro = rosterOf(m)!;
    expect(ro.unresolved).toEqual([]);
    expect(ro.included.length + ro.notified.length + ro.skipped.length).toBe(ro.rawCount);
    // 取消略過會回到未處理（沒有東西被默默丟掉）
    m = setResolution(m, null, noId.rowId);
    expect(rosterOf(m)!.unresolved).toHaveLength(1);
  });

  it('重複匯入差異（F-11）：新增／更新／移除／沒變；合併保留舊列', () => {
    const base = parseOf();
    const rows = sheet().map((r) => [...r]);
    const first = rows.findIndex((r, i) => i > 0 && r[9] === '0');
    rows[first]![11] = '99'; // 同鍵、分數不同 → 更新
    rows.splice(first + 1, 1); // 少一列 → 移除
    rows.push(['9NEW01', '101', '60', '101', '60', '新來生', 'N1', '數學', '2', '0', '1', '30']); // 新增
    const next = parseOf(rows);
    const d = diffImport(base, next);
    expect(d.added).toBe(1);
    expect(d.updated).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.unchanged).toBe(base.rows.length - 2);
    const merged = mergeParse(base, next);
    expect(merged.rows.length).toBe(base.rows.length + 1); // 合併：舊的不移除、新的加入
    expect(diffImport(undefined, base).added).toBe(base.rows.length);
  });

  it('重新匯入：名單變了，使用者調整過的計畫作廢（回到系統建議）', () => {
    const { doc, id } = fixture();
    const m0 = get(doc, id);
    const d0 = derive(m0);
    const g = d0.plan.groups[0]!;
    const m1: MakeupSession = { ...m0, plan: setEarly(d0.plan, g.groupId, 'x', true) };
    expect(m1.plan).toBeTruthy();
    expect(applyImport(m1, 'again.xlsx', parseOf(), NOW).plan).toBeUndefined();
  });
});

describe('① 設定與步驟狀態', () => {
  it('日期標籤：yyyy-mm-dd → 「1/23（六）」', () => {
    expect(dateLabel('2027-01-23')).toBe('1/23（六）');
    expect(dateLabel('壞')).toBeNull();
  });

  it('新增／刪除考日與群組；年級只能在一個群組；名單裡有年級沒群組＝問題', () => {
    const { doc, id } = fixture();
    let m = get(doc, id);
    expect(settingsIssues(m, derive(m).grades)).toEqual([]);
    m = addDay(m);
    expect(m.settings.days).toHaveLength(2);
    m = addGroup(m);
    const g3 = m.settings.groups[2]!;
    m = patchGroup(m, g3.id, { dayId: m.settings.days[1]!.id });
    m = setGradeGroup(m, 'S3', g3.id);
    expect(m.settings.groups.find((g) => g.id === g3.id)!.grades).toEqual(['S3']);
    expect(m.settings.groups.filter((g) => g.grades.includes('S3'))).toHaveLength(1);
    m = removeGroup(m, g3.id);
    const issues = settingsIssues(m, derive(m).grades);
    expect(issues.some((i) => i.text.includes(GRADE_TEXT.S3))).toBe(false); // 名單沒有高三
    m = setGradeGroup(m, 'S2', null);
    expect(settingsIssues(m, derive(m).grades).some((i) => i.text.includes('高二') && i.text.includes('沒有任何群組'))).toBe(true);
    expect(makeupFlow(m).states[1]).toBe('todo');
  });

  it('教室夠：①～⑤ 都完成、沒有待處理；教室不夠：③ 待處理並寫出缺多少座位', () => {
    const { doc, id } = fixture();
    const f = makeupFlow(get(doc, id));
    expect(f.issues.filter((i) => i.level === 'block')).toEqual([]);
    expect(Object.values(f.states)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(makeupProgress(get(doc, id)).headline).toBe('①～⑤ 都完成');
    const tiny = updateMakeup(doc, id, (m) => roomsPatch(m, [room(10, 'class', '小教室')]));
    const f2 = makeupFlow(get(tiny, id));
    expect(f2.states[3]).toBe('todo');
    expect(f2.issues.some((i) => i.step === 3 && i.text.includes('缺'))).toBe(true);
    expect(f2.states[5]).toBe('todo');
  });

  it('教室座位數＝橫排×深位−空位', () => {
    const r = room(30);
    const x = withRoomShape(r, 5, 7, 3);
    expect(x.seatCount).toBe(32);
    expect(withRoomShape(r, 1, 1, 9).seatCount).toBe(1);
  });
});

describe('⑤ 計畫調整（F-21）', () => {
  it('系統建議全綠；每筆人次恰好一個考場一個時段（零遺漏）', () => {
    const { doc, id } = fixture();
    const d = derive(get(doc, id));
    expect(d.schedule.unplaced).toEqual([]);
    const key = (s: string, sub: string) => `${s}|${sub}`;
    const seen = new Map<string, number>();
    for (const x of d.schedule.sittings) for (const sub of x.subjects) seen.set(key(x.studentId, sub), (seen.get(key(x.studentId, sub)) ?? 0) + 1);
    for (const e of d.entries) expect(seen.get(key(e.studentId, e.subject)), `${e.studentId} ${e.subject}`).toBe(1);
    const reds = d.checks.filter((c) => ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10'].includes(c.id) && c.status !== 'green');
    expect(reds).toEqual([]);
  });

  it('把某科改成綜合節／新增獨立節；順序調換；調整後仍零遺漏', () => {
    const { doc, id } = fixture();
    const m0 = get(doc, id);
    const d0 = derive(m0);
    const gp = d0.plan.groups.find((g) => g.slots.length >= 2)!;
    expect(gp).toBeTruthy();
    const first = gp.slots[0]![0]!;
    let plan = placeSubject(d0.plan, gp.groupId, first, { kind: 'combined' });
    let g = plan.groups.find((x) => x.groupId === gp.groupId)!;
    expect(g.combined).toContain(first);
    expect(g.slots.flat()).not.toContain(first);
    plan = placeSubject(plan, gp.groupId, first, { kind: 'new' });
    g = plan.groups.find((x) => x.groupId === gp.groupId)!;
    expect(g.slots.flat()).toContain(first);
    expect(g.combined).not.toContain(first);
    const before = g.slots.map((x) => x.join('+'));
    plan = moveSlot(plan, gp.groupId, 0, 1);
    const after = plan.groups.find((x) => x.groupId === gp.groupId)!.slots.map((x) => x.join('+'));
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    const d1 = derive({ ...m0, plan });
    expect(d1.schedule.unplaced).toEqual([]);
    expect(d1.checks.find((c) => c.id === 'C-3')!.status).toBe('green');
  });

  it('指定提前開考／取消；指定某班某節的教室並可取消', () => {
    const { doc, id } = fixture();
    const m0 = get(doc, id);
    const d0 = derive(m0);
    const g = d0.plan.groups[0]!;
    const multi = [...new Set(d0.entries.filter((e) => derive(m0).entries.filter((x) => x.studentId === e.studentId).length >= 2).map((e) => e.studentId))].find((sid) => !g.early.includes(sid) && d0.entries.some((e) => e.studentId === sid && m0.settings.groups.find((x) => x.id === g.groupId)!.grades.includes(e.grade)))!;
    const p1 = setEarly(d0.plan, g.groupId, multi, true);
    expect(p1.groups[0]!.early).toContain(multi);
    const d1 = derive({ ...m0, plan: p1 });
    expect(d1.schedule.early.some((e) => e.studentId === multi)).toBe(true);
    expect(d1.checks.find((c) => c.id === 'C-11')!.status).not.toBe('red'); // 離場時間有印出，不是紅燈
    expect(setEarly(p1, g.groupId, multi, false).groups[0]!.early).not.toContain(multi);
    const p2 = setPin(d0.plan, g.groupId, 0, '101', m0.settings.rooms[1]!.id);
    expect(p2.pins).toHaveLength(1);
    expect(setPin(p2, g.groupId, 0, '101', null).pins).toEqual([]);
    expect(derive({ ...m0, plan: p2 }).schedule.unplaced).toEqual([]);
  });

  it('刪掉群組：計畫只留還存在的群組；新增群組缺的部分補系統建議', () => {
    const { doc, id } = fixture();
    const m0 = get(doc, id);
    const d0 = derive(m0);
    const m1: MakeupSession = { ...m0, plan: d0.plan };
    const m2 = removeGroup(m1, m1.settings.groups[1]!.id);
    expect(m2.plan).toBeUndefined(); // 結構變了，計畫作廢
    expect(derive(m2).plan.groups.map((g) => g.groupId)).toEqual([m1.settings.groups[0]!.id]);
  });
});

describe('④ 選組拆分', () => {
  it('勾選科目並指定班別文理組，科目鍵改成「科目〔組〕」，計畫作廢', () => {
    const { doc, id } = fixture();
    let m = get(doc, id);
    m = toggleSplitSubject(m, '歷史', true);
    m = setClassTrackLabel(m, '101', '文組');
    m = setClassTrackLabel(m, '102', '理組');
    const subs = new Set(derive(m).entries.map((e) => e.subject));
    expect([...subs].some((s) => s === '歷史〔文組〕' || s === '歷史〔理組〕')).toBe(true);
    expect(m.plan).toBeUndefined();
    m = toggleSplitSubject(m, '歷史', false);
    m = setClassTrackLabel(m, '101', null);
    m = setClassTrackLabel(m, '102', null);
    expect([...new Set(derive(m).entries.map((e) => e.subject))].some((s) => s.includes('〔'))).toBe(false);
  });
});

describe('畫面', () => {
  const html = (step: 1 | 2 | 3 | 4 | 5, d?: Doc, id?: string) => {
    const fx = d && id ? { doc: d, id } : fixture();
    return renderToString(<MakeupWorkspace doc={fx.doc} makeupId={fx.id} step={step} onChange={noop} onStep={noop} onExams={noop} />);
  };

  it('工作區：五步驟、摘要列、上一步／下一步；⑥⑦ 之後開放的說明', () => {
    const h = html(5);
    for (const t of ['補考設定', '匯入名單', '教室設定', '人數統計', '考程編排']) expect(h).toContain(t);
    expect(h).toContain('應補考人次');
    expect(h).toContain('‹ 上一步');
    expect(h).toContain('之後的版本開放');
    expect(html(1)).not.toContain('‹ 上一步');
  });

  it('① 考日、群組、年級、時長與提前開考參數都在畫面上', () => {
    const h = html(1);
    for (const t of ['考日（可設多日）', '考程群組', '高一', '初三', '建議提前開考門檻', '總作答上限', '獨立節最少人數', '產生座位表']) expect(h).toContain(t);
  });

  it('② 有名單：匯入對帳等式；沒名單：空狀態', () => {
    const h = html(2);
    expect(h).toContain('匯入對帳（C-1）');
    expect(h).toContain('對得起來');
    const r = newMakeup(demoDoc(), '空的', NOW, { schoolYear: 115, semester: 'first' });
    if (!r.ok) throw new Error();
    const h2 = html(2, r.doc, r.doc.makeups![0]!.id);
    expect(h2).toContain('還沒有匯入名單');
    expect(h2).toContain('先匯入名單');
  });

  it('② 問題列顯示種類、原因選單與略過按鈕', () => {
    const rows = sheet();
    rows.push(['', '101', '77', '101', '77', '無學號生', 'X1', '數學', '2', '0', '1', '30']);
    const r0 = newMakeup(demoDoc(), '問題', NOW, { schoolYear: 115, semester: 'first' });
    if (!r0.ok) throw new Error();
    const id = r0.doc.makeups![0]!.id;
    const d = updateMakeup(r0.doc, id, (m) => applyImport(m, 'x.xlsx', parseOf(rows), NOW));
    const h = html(2, d, id);
    expect(h).toContain('問題列（1）');
    expect(h).toContain('略過這一筆');
    for (const t of ['已轉學', '重複列', '非補考對象', '其他']) expect(h).toContain(t);
    expect(h).toContain('還有 1 筆問題列沒處理');
  });

  it('③ 教室清單、用途選單與容量檢核', () => {
    const h = html(3);
    for (const t of ['容量檢核（F-15）', '混班教室', '特別教室（提前開考）', '同時在考', '可用座位']) expect(h).toContain(t);
    expect(h).toContain('甲教室');
  });

  it('④ 矩陣、合計對帳、另行通知、科數分布', () => {
    const h = html(4);
    for (const t of ['高中部：班級 × 科目', '初中部：班級 × 科目', '另行通知科目', '多科生科數分布', '選組科目拆開']) expect(h).toContain(t);
    expect(h).toContain('納入排程的名單列數');
  });

  it('⑤ 各群組科目安排、總覽表、提前開考與離場時間', () => {
    const h = html(5);
    for (const t of ['時間 × 教室總覽（F-23）', '即時檢核', '指定某班某節的教室', '提前開考與離場時間', '獨立節', '綜合節']) expect(h).toContain(t);
  });

  it('列表（S-1）：補考場次區與進度；沒給 onOpenMakeup 就不顯示', () => {
    const { doc } = fixture();
    const h = renderToString(<Exams doc={doc} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} onOpenMakeup={noop} onDeleteMakeup={noop} />);
    expect(h).toContain('補考場次');
    expect(h).toContain('115 學年第一學期補考');
    expect(h).toContain('①～⑤ 都完成');
    expect(renderToString(<Exams doc={doc} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />)).not.toContain('補考場次');
  });

  it('新增頁：選補考時對象寫「高中部、國中部」、不要求環境確認、說明帶入上一次補考', () => {
    const { doc } = fixture();
    const draft = { kind: 'gsat' as const, name: '下一場', edited: true, semester: 'second' as const, semEdited: true, yearText: '115', round: 1, roundEdited: false, makeup: true };
    const h = renderToString(<NewExam doc={doc} draft={draft} onCancel={noop} onCreate={noop} onCreateMakeup={noop} now={() => NOW} />);
    expect(h).toContain('高中部、國中部');
    expect(h).toContain('會帶入「115 學年第一學期補考」的設定');
    expect(h).not.toContain('本次使用的環境');
    expect(h).not.toContain('次別（第幾次）');
  });
});

describe('復原標籤與修改時間', () => {
  it('describeChange 說得出補考做了什麼', () => {
    const { doc, id } = fixture();
    const before = newMakeup(demoDoc(), 'A', NOW, { schoolYear: 115, semester: 'first' });
    if (!before.ok) throw new Error();
    expect(describeChange(demoDoc(), before.doc)).toBe('新增補考');
    expect(describeChange(before.doc, demoDoc())).toBe('刪除補考');
    expect(describeChange(doc, updateMakeup(doc, id, (m) => roomsPatch(m, [])))).toBe('修改補考教室');
    expect(describeChange(doc, updateMakeup(doc, id, (m) => setResolution(m, null, 'x')))).toBeDefined();
  });

  it('stampMakeups 只在內容真的變了才蓋修改時間', () => {
    const { doc, id } = fixture();
    const same = stampMakeups(doc, doc, NOW);
    expect(same).toBe(doc);
    const edited = updateMakeup(doc, id, (m) => ({ ...m, name: '改' }));
    const stamped = stampMakeups(doc, edited, new Date('2026-11-20T00:00:00Z'));
    expect(stamped.makeups![0]!.updatedAt).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('檢核引擎照用（K1 不改語意）', () => {
  it('derive 的檢核結果與直接呼叫 runMakeupChecks 一致', () => {
    const { doc, id } = fixture();
    const m = get(doc, id);
    const d = derive(m);
    const direct = runMakeupChecks({ roster: d.roster!, settings: m.settings, plan: d.plan, outputs: d.outputs, currentVersion: d.version });
    expect(direct.map((c) => [c.id, c.status])).toEqual(d.checks.map((c) => [c.id, c.status]));
  });
  it('表頭欄名沿用教務匯出檔（K1 fixtures）', () => { expect(HEADER).toContain('學號'); });
});
