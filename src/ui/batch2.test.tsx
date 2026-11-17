/** 第 2 批「步驟流程」G3 G6 G11 G13：學測、分科、會考三種類型都測（全部假資料） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, ExamConfig, ExamKind, Student } from '../data';
import { makeFixture } from '../export/fixtures';
import { classRoomRows, defaultSeatGrid, missingClassRooms, syncClassRooms } from './classRooms';
import { StepDock } from './components';
import { flowOf, nextAction, prevStepOf } from './flow';
import { NewExam } from './pages/NewExam';
import { Step1 } from './pages/Step1';
import { autoSeat, examResult } from './seating';
import { emptyDoc } from './repository';
import { newExam, suggestExamName, type Doc } from './store';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/app.css', 'utf8');

const KINDS: ExamKind[] = ['gsat', 'ast', 'bcct'];
const NOW = new Date('2026-11-10T02:00:00Z');

/** 三個班、每班 n 人的假資料（高中部與國中部各一份） */
function docWith(kind: ExamKind, perClass: number[], extraRooms: Classroom[] = []): { doc: Doc; exam: ExamConfig } {
  const division = kind === 'bcct' ? 'junior' : 'senior';
  const names = ['甲班', '乙班', '丙班'];
  const classes: ClassInfo[] = names.map((name, i) => ({ no: i + 1, name, division, colorIndex: i + 1, ...(division === 'senior' ? { track: i < 2 ? ('science' as const) : ('liberal' as const) } : {}) }));
  const roster: Student[] = perClass.flatMap((n, i) => Array.from({ length: n }, (_, k) => ({ classNo: i + 1, seatNo: k + 1, name: `假生${i + 1}${String(k + 1).padStart(2, '0')}` })));
  const base = emptyDoc();
  const d: Doc = { ...base, settings: { ...base.settings, classes, classrooms: extraRooms }, rosters: { senior: division === 'senior' ? roster : [], junior: division === 'junior' ? roster : [] } };
  const r = newExam(d, kind, '假資料考試', NOW);
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams[0]! };
}

describe('G11 預設座位：最接近正方、單邊 ≤ 7', () => {
  it('38～42 人 → 6 排 × 7 深位；36 人 → 6×6；超過 49 人封頂 7×7；沒人數用 6×7', () => {
    for (const n of [38, 39, 40, 41, 42]) expect(defaultSeatGrid(n)).toEqual({ rows: 6, depth: 7 });
    expect(defaultSeatGrid(36)).toEqual({ rows: 6, depth: 6 });
    expect(defaultSeatGrid(30)).toEqual({ rows: 5, depth: 6 });
    expect(defaultSeatGrid(49)).toEqual({ rows: 7, depth: 7 });
    expect(defaultSeatGrid(60)).toEqual({ rows: 7, depth: 7 });
    expect(defaultSeatGrid(0)).toEqual({ rows: 6, depth: 7 });
    for (let n = 1; n <= 49; n++) { const g = defaultSeatGrid(n); expect(g.rows * g.depth).toBeGreaterThanOrEqual(n); expect(Math.max(g.rows, g.depth)).toBeLessThanOrEqual(7); }
  });
});

describe.each(KINDS)('G11 依班級帶出班級教室（%s）', (kind) => {
  it('每班一間、同班級名稱、座位依人數；寫進共用教室清單並列入本次考試', () => {
    const { doc, exam } = docWith(kind, [38, 40, 42]);
    expect(missingClassRooms(doc, exam)).toBe(3);
    const d = syncClassRooms(doc, exam);
    const e = d.exams[0]!;
    const rooms = d.settings.classrooms;
    expect(rooms.map((r) => r.name)).toEqual(['甲班', '乙班', '丙班']);
    for (const r of rooms) expect(r).toMatchObject({ kind: 'class', rows: 6, depth: 7, seatCount: 42, division: exam.division });
    expect(e.classroomIds).toEqual(rooms.map((r) => r.id));
    expect(missingClassRooms(d, e)).toBe(0);
    expect(syncClassRooms(d, e)).toBe(d); // 重複執行不產生多餘修改
    if (kind !== 'bcct') expect(rooms.map((r) => r.track)).toEqual(['science', 'science', 'liberal']);
  });
  it('共用設定已有同名教室就沿用（座位配置不動）；預備、特殊教室保留', () => {
    const own: Classroom = { id: 'x1', name: '乙班', kind: 'class', rows: 4, depth: 5, seatCount: 20, division: kind === 'bcct' ? 'junior' : 'senior' };
    const special: Classroom = { id: 'sp', name: '特殊教室', kind: 'class', rows: 2, depth: 2, seatCount: 4, division: own.division! };
    const { doc, exam } = docWith(kind, [30, 30, 30], [own, special]);
    const pre = { ...doc, exams: [{ ...exam, classroomIds: [] }] };
    const d = syncClassRooms(pre, pre.exams[0]!);
    expect(d.settings.classrooms.find((r) => r.id === 'x1')).toEqual(own);
    expect(d.settings.classrooms.filter((r) => r.name === '乙班')).toHaveLength(1);
    expect(d.exams[0]!.classroomIds).toContain('x1');
    expect(d.exams[0]!.classroomIds).not.toContain('sp'); // 特殊教室不是班級教室，不自動列入
    expect(d.settings.classrooms.find((r) => r.id === 'sp')).toEqual(special);
  });
  it('名單沒匯入：不帶出任何教室；已列入的不被動到', () => {
    const { doc, exam } = docWith(kind, [0, 0, 0]);
    expect(classRoomRows(doc, exam)).toEqual([]);
    expect(syncClassRooms(doc, exam)).toBe(doc);
  });
});

describe.each(KINDS)('G3 新增頁與第 1 步（%s）', (kind) => {
  it('第 1 步只留考科與唯讀摘要＋「修改基本資料」，不再有類型、學期、次別欄位', () => {
    const { doc, exam } = docWith(kind, [10, 10, 10]);
    const html = renderToString(<Step1 doc={doc} exam={exam} onChange={() => undefined} />);
    expect(html).toContain('修改基本資料');
    expect(html).toContain('本次考科');
    expect(html).not.toContain('termcards');
    expect(html).not.toContain('建立後不可更改類型');
    expect(html).toContain(exam.division === 'senior' ? '高三' : '國三');
  });
  it('會考第 1 步預設已完成（考科固定七科）；學測、分科有考科也完成', () => {
    const { doc, exam } = docWith(kind, [10, 10, 10]);
    const f = flowOf(doc, exam, 2);
    expect(f.steps.find((s) => s.no === 1)!.state).toBe('done');
    if (kind === 'bcct') expect(exam.subjects).toHaveLength(7);
  });
});

describe('G3 新增模擬考頁', () => {
  it('學測預設就有次別（第一次…可選）；名稱可帶次別', () => {
    const html = renderToString(<NewExam doc={emptyDoc()} onCancel={() => undefined} onCreate={() => undefined} now={() => NOW} />);
    expect(html).toContain('次別');
    expect(html).toContain('第三次');
  });
  it('suggestExamName 帶次別：學測／分科第 N 次；建立時學測存次別', () => {
    const d = emptyDoc();
    expect(suggestExamName(d, 'gsat', NOW, 115, 3)).toBe('學測第三次');
    expect(suggestExamName(d, 'ast', NOW, 115, 2)).toBe('分科第二次');
    const r = newExam(d, 'gsat', '學測第三次', NOW, { round: 3, semester: 'first', year: 115 });
    expect(r.ok && r.doc.exams[0]).toMatchObject({ round: 3 });
  });
});

describe('G13 自動排座', () => {
  function ready(): { doc: Doc; exam: ExamConfig } {
    // 學測：沿用假資料（名單、教室、考試名單齊備），拿掉既有排座結果＝從沒排過
    const f = makeFixture();
    const doc: Doc = {
      settings: { ...f.settings, classes: f.settings.classes.map((c) => ({ ...c, track: 'science' as const })), classrooms: f.settings.classrooms.map((r) => (r.kind === 'class' ? { ...r, track: 'science' as const } : r)) }, rosters: { senior: f.students, junior: [] }, exams: [f.exam],
      examFiles: { [f.exam.id]: { entries: f.entries, diffs: [], overrides: [] } },
    };
    return { doc, exam: f.exam };
  }
  it('學測：前置齊備且從沒排過 → 自動排出結果；結果穩定（同一份資料兩次相同）', () => {
    const { doc, exam } = ready();
    const a = autoSeat(doc, exam, '2026-11-10T00:00:00Z');
    const b = autoSeat(doc, exam, '2026-11-10T01:00:00Z');
    expect(a?.ok).toBe(true);
    if (!a?.ok || !b?.ok) return;
    const ra = examResult(a.doc, exam)!;
    const rb = examResult(b.doc, exam)!;
    expect(ra.assignments.length).toBe(30);
    expect(ra.assignments).toEqual(rb.assignments);
    expect(ra.dataVersion).toBe(rb.dataVersion);
  });
  it('已有結果（含過期）不自動重排，也不覆蓋手動調整', () => {
    const { doc, exam } = ready();
    const a = autoSeat(doc, exam, '2026-11-10T00:00:00Z');
    if (!a?.ok) throw new Error('應排成功');
    expect(autoSeat(a.doc, exam, '2026-11-10T02:00:00Z')).toBeUndefined();
    // 名單改了→過期；仍不自動重排
    const changed: Doc = { ...a.doc, rosters: { ...a.doc.rosters, senior: a.doc.rosters.senior.slice(0, 20) } };
    expect(autoSeat(changed, exam, '2026-11-10T03:00:00Z')).toBeUndefined();
    expect(examResult(changed, exam)).toEqual(examResult(a.doc, exam));
  });
  it('前置條件不齊（座位不足）排不出來也不存結果', () => {
    const { doc, exam } = ready();
    const small = { ...exam, classroomIds: ['r2'] };
    const r = autoSeat({ ...doc, exams: [small] }, small, '2026-11-10T00:00:00Z');
    expect(r?.ok).toBe(false); // 座位不夠：排不出來，不存任何結果（畫面顯示原因，不輸出不合規則的座位表）
  });
  it('會考：名單帶出班級教室後直接自動排座，三種班級都有座位', () => {
    const { doc, exam } = docWith('bcct', [30, 30, 30]);
    const d = syncClassRooms(doc, exam);
    const e = d.exams[0]!;
    const r = autoSeat(d, e, '2026-11-10T00:00:00Z');
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(examResult(r.doc, e)!.assignments).toHaveLength(90);
  });
});

describe('G6／G33 隨時可見的前後導覽', () => {
  const go = () => undefined;
  it('桌機右側欄頂端固定、平板手機底部固定列：樣式存在', () => {
    expect(css).toContain('.stepdock');
    expect(css).toMatch(/\.ws \.side-r \.stepdock\{position:fixed/);
  });
  it.each(KINDS)('%s：按鈕文字、上一步、待處理說明但仍可按（不停用）', (kind) => {
    const { doc, exam } = docWith(kind, [10, 10, 10]);
    const flow = flowOf(doc, exam, 3);
    const action = nextAction(flow, 3);
    const html = renderToString(<StepDock action={action} current={3} prev={prevStepOf(flow, 3)} onGo={go} onExams={go} />);
    expect(html).toContain('下一步 ›');
    expect(html).toContain('‹ 上一步');
    expect(html).not.toContain('完成此步');
    expect(html.indexOf('dock-prev')).toBeLessThan(html.indexOf('dock-next')); // 後退在左、前進在右
    expect(html).toContain('stepdock');
    expect(html).not.toContain('disabled');
    if (action.kind === 'go' && action.pending) expect(html).toContain('仍可前往下一步');
  });
  it('會考：④ 不需要，③ 的下一步是 ⑤、⑤ 的上一步是 ③', () => {
    const { doc, exam } = docWith('bcct', [10, 10, 10]);
    const flow = flowOf(doc, exam, 5);
    expect(prevStepOf(flow, 5)?.to).toBe(3);
    expect(prevStepOf(flow, 1)).toBeUndefined();
    expect(nextAction(flowOf(doc, exam, 3), 3)).toMatchObject({ kind: 'go', to: 5 });
  });
  it.each(KINDS)('%s：第 1 步沒有上一步，下一步仍在右邊、帶步驟名稱小字', (kind) => {
    const { doc, exam } = docWith(kind, [10, 10, 10]);
    const flow = flowOf(doc, exam, 1);
    const html = renderToString(<StepDock action={nextAction(flow, 1)} current={1} prev={prevStepOf(flow, 1)} onGo={go} onExams={go} />);
    expect(html).not.toContain('上一步');
    expect(html).toContain('下一步 ›');
    expect(html).toContain('dock-sub">② ');
  });
  it('最後一步（⑥）顯示「完成 ✓」與小字「回模擬考列表」', () => {
    const { doc, exam } = docWith('gsat', [10, 10, 10]);
    const flow = flowOf(doc, exam, 6);
    const html = renderToString(<StepDock action={nextAction(flow, 6)} current={6} prev={prevStepOf(flow, 6)} onGo={go} onExams={go} />);
    expect(html).toContain('完成 ✓');
    expect(html).toContain('回模擬考列表');
    expect(html).not.toContain('下一步');
    expect(html).toContain('‹ 上一步');
    expect(html).toContain('dock-sub">⑤ ');
  });
});
