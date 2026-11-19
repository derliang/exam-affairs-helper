import { describe, expect, it } from 'vitest';
import type { ExamConfig, ExamEntry } from '../data';
import type { Doc } from './store';
import { allocateWhole, reserveNeed, studyCapacity } from './capacity';
import { detachPreview, markRows, setMarkChoice } from './seating';
import { updateExam } from './store';
import { studyReference } from '../core/studyRef';
import { periodGroups } from '../core/detach';
import { buildLabelPages, buildSeatPages } from '../export/model';
import { makeFixture } from '../export/fixtures';

const NOW = '2026-11-08T10:00:00.000Z';

function exam(patch: Partial<ExamConfig> = {}): ExamConfig {
  return {
    id: 'e1', name: '測試考', kind: 'gsat', division: 'senior', semester: 'first', round: 3,
    subjects: [{ id: 'sci', name: '自然' }, { id: 'soc', name: '社會' }],
    markRules: [
      { track: 'science', subjectId: 'sci', mode: 'mark-extra', locked: true },
      { track: 'liberal', subjectId: 'sci', mode: 'mark-absent', locked: true },
    ],
    classroomIds: ['S', 'L', 'P1', 'P2'], labelLayout: { paper: 'B4', cols: 6, rows: 8 }, createdAt: NOW, ...patch,
  };
}

/** 理組 1 班 4 人（2 人考自然）、文組 2 班 4 人（1 人考自然）：理組標「＋」＝抽離考試 2 人；文組標「✕」＝抽離自習 3 人 */
const entries: ExamEntry[] = [
  ...[1, 2].map((n) => ({ classNo: 1, seatNo: n, name: `甲生${n}`, groupCode: '0', subjectIds: ['sci', 'soc'] })),
  ...[3, 4].map((n) => ({ classNo: 1, seatNo: n, name: `甲生${n}`, groupCode: '6', subjectIds: ['soc'] })),
  { classNo: 2, seatNo: 1, name: '乙生1', groupCode: '0', subjectIds: ['sci', 'soc'] },
  ...[2, 3, 4].map((n) => ({ classNo: 2, seatNo: n, name: `乙生${n}`, groupCode: '6', subjectIds: ['soc'] })),
];

function doc(rooms: number[], e = exam()): Doc {
  return {
    settings: {
      schoolName: '範例高中', headerText: '模擬考', defaultLabelPaper: 'B4',
      classes: [
        { no: 1, name: '溫', division: 'senior', track: 'science', colorIndex: 1 },
        { no: 2, name: '良', division: 'senior', track: 'liberal', colorIndex: 2 },
      ],
      classrooms: [
        { id: 'S', name: '溫', kind: 'class', rows: 2, depth: 4, seatCount: 8, track: 'science' },
        { id: 'L', name: '良', kind: 'class', rows: 2, depth: 4, seatCount: 8, track: 'liberal' },
        ...rooms.map((n, i) => ({ id: `P${i + 1}`, name: `預備${i + 1}`, kind: 'reserve' as const, rows: 1, depth: n, seatCount: n })),
      ],
    },
    rosters: { senior: [], junior: [] },
    exams: [e],
    examFiles: { e1: { entries } },
  };
}

describe('G29 整間分配（D27）：抽離考試與抽離自習各用整間教室', () => {
  it('兩間 4 座＝夠；一間 8 座＝考試佔整間、自習沒地方；考試超過總座位＝考試放不下', () => {
    expect(allocateWhole([4, 4], 2, 3)).toMatchObject({ ok: true, examRooms: 1, studyRooms: 1 });
    expect(allocateWhole([8], 2, 3)).toMatchObject({ ok: false, failPart: 'study', short: 3 });
    expect(allocateWhole([4, 4], 9, 0)).toMatchObject({ ok: false, failPart: 'exam', short: 1 });
    expect(allocateWhole([4, 4], 0, 0).ok).toBe(true);
  });
});

describe('單一自習容量：第 3、4、5 步口徑一致（學測）', () => {
  it('一間 8 座：總座位夠但考試與自習要分開排 → 不夠；與第 4 步實際分配（detachPreview）結論相同', () => {
    const d = doc([8, 0].filter((n) => n > 0));
    const sc = studyCapacity(d, d.exams[0]!);
    expect(sc.applicable).toBe(true);
    expect(sc.groups[0]).toMatchObject({ examCount: 2, studyCount: 3, stay: 2 });
    expect(sc.ok).toBe(false);
    expect(detachPreview(d, d.exams[0]!).ok).toBe(false);
    expect(sc.worst?.failPart).toBe('study');
    // 第 3 步格子（reserveNeed）與第 5 步用同一組數字
    const n = reserveNeed(d, d.exams[0]!);
    expect(n).toMatchObject({ need: 5, exam: 2, study: 3, avail: 8 });
  });
  it('兩間 4 座＝夠；再有一間備用教室時，不夠的情況提示「再列入 N 間」並給教室 id', () => {
    const ok = doc([4, 4]);
    expect(studyCapacity(ok, ok.exams[0]!).ok).toBe(true);
    expect(detachPreview(ok, ok.exams[0]!).ok).toBe(true);
    const e = exam({ classroomIds: ['S', 'L', 'P1'] });
    const lack = doc([8, 4], e); // 只列入 P1（8 座）；P2 還沒列入
    const sc = studyCapacity(lack, e);
    expect(sc.ok).toBe(false);
    expect(sc.addRooms).toBe(1);
    expect(sc.addRoomIds).toEqual(['P2']);
    const fixed = doc([8, 4], exam({ classroomIds: ['S', 'L', 'P1', 'P2'] }));
    expect(studyCapacity(fixed, fixed.exams[0]!).ok).toBe(true);
    expect(detachPreview(fixed, fixed.exams[0]!).ok).toBe(true);
  });
  it('不考的人要算進去：留在原班教室自習的人數與班級（標考的那邊，不考的是多數）', () => {
    const e = exam({ markRules: [{ track: 'science', subjectId: 'sci', mode: 'mark-extra', locked: true }, { track: 'liberal', subjectId: 'sci', mode: 'mark-extra', locked: true }] });
    const d = doc([4, 4], e);
    const g = studyCapacity(d, e).groups[0]!;
    expect(g).toMatchObject({ examCount: 3, studyCount: 0, stay: 5 });
    expect(g.stayByClass).toEqual([{ classNo: 1, count: 2 }, { classNo: 2, count: 3 }]);
  });
  it('G27：每一列都能改標示（改選、鎖定、改回系統建議）', () => {
    const d = doc([4, 4], exam({ markRules: [] }));
    const e0 = d.exams[0]!;
    const before = markRows(d, e0).find((r) => r.track === 'liberal')!;
    expect(before.state).toBe('auto');
    const flip = before.mode === 'mark-absent' ? 'mark-extra' : 'mark-absent';
    const r1 = updateExam(d, 'e1', { markRules: setMarkChoice(e0, 'liberal', 'sci', flip) });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const row = markRows(r1.doc, r1.doc.exams[0]!).find((r) => r.track === 'liberal')!;
    expect(row).toMatchObject({ state: 'locked', mode: flip });
    // 改標示後，自習容量與抽離人數即時跟著變
    const g = studyCapacity(r1.doc, r1.doc.exams[0]!).groups[0]!;
    expect(g.examCount + g.studyCount).toBeGreaterThan(0);
    const r2 = updateExam(r1.doc, 'e1', { markRules: setMarkChoice(r1.doc.exams[0]!, 'liberal', 'sci', undefined) });
    if (r2.ok) expect(markRows(r2.doc, r2.doc.exams[0]!).find((r) => r.track === 'liberal')!.state).toBe('auto');
    const none = updateExam(d, 'e1', { markRules: setMarkChoice(e0, 'liberal', 'sci', 'none') });
    if (none.ok) expect(markRows(none.doc, none.doc.exams[0]!).find((r) => r.track === 'liberal')).toMatchObject({ state: 'locked', mode: 'none' });
  });
});

describe('三種考試類型', () => {
  it('分科（D99 自有容量）與會考沒有抽離：不走這套計算，不報錯', () => {
    const a = exam({ kind: 'ast' });
    expect(studyCapacity(doc([4], a), a).applicable).toBe(false);
    const b = exam({ kind: 'bcct', division: 'junior' });
    expect(studyCapacity(doc([4], b), b)).toMatchObject({ applicable: false, ok: true });
    expect(reserveNeed(doc([4], b), b).need).toBe(0);
  });
});

describe('G32 自習參考座位', () => {
  const d = doc([4, 4]);
  const e = d.exams[0]!;
  const prev = detachPreview(d, e);
  it('分配結果不變：自習的人只在預備教室出名單，Detach 沒有座位', () => {
    expect(prev.ok).toBe(true);
    if (!prev.ok) return;
    expect(prev.detaches.filter((x) => x.purpose === 'study').every((x) => !x.seat)).toBe(true);
  });
  it('參考座位排進分到的預備教室、每人一格不重複、座位都是可用座位', () => {
    if (!prev.ok) throw new Error('prev');
    const rooms = d.settings.classrooms.filter((r) => r.kind === 'reserve');
    const refs = studyReference(periodGroups(e.subjects), prev.detaches, rooms);
    expect(refs).toHaveLength(1);
    const r = refs[0]!;
    expect(r.seats.size).toBe(3);
    expect(r.unseated).toEqual([]);
    const keys = [...r.seats.values()].map((s) => `${s.row}-${s.depth}`);
    expect(new Set(keys).size).toBe(3);
  });
  it('同一人有考試座位又在同一間自習時，沿用同一個座位', () => {
    const room = { id: 'R', name: '備', kind: 'reserve' as const, rows: 1, depth: 5, seatCount: 5 };
    const refs = studyReference([{ periods: [1], subjectIds: ['a'] }], [
      { code: '0103', subjectId: 'b', purpose: 'exam', roomId: 'R', seat: { row: 1, depth: 4 } },
      { code: '0103', subjectId: 'a', purpose: 'study', roomId: 'R' },
      { code: '0101', subjectId: 'a', purpose: 'study', roomId: 'R' },
    ], [room]);
    expect(refs[0]!.seats.get('0103')).toEqual({ row: 1, depth: 4 });
    expect(refs[0]!.seats.get('0101')).toBeDefined();
    expect(refs[0]!.seats.get('0101')).not.toEqual({ row: 1, depth: 4 });
  });
  it('座位表檔案多出「參考座位」頁（標題寫非考試座位、在預備教室頁之後），標籤沒有', () => {
    const input = makeFixture();
    input.result.detaches = input.result.detaches.filter((d) => d.purpose !== "study");
    input.result.detaches.push(
      { code: '0101', subjectId: 'ma', purpose: 'study', roomId: 'rv' },
      { code: '0102', subjectId: 'ma', purpose: 'study', roomId: 'rv' },
      { code: '0201', subjectId: 'ma', purpose: 'study', roomId: 'rv' },
    );
    const pages = buildSeatPages(input);
    const ref = pages.filter((p) => p.title.includes('參考座位'));
    expect(ref).toHaveLength(1);
    expect(ref[0]!.title).toContain('非考試座位');
    expect(ref[0]!.tag).toBe('預備教室');
    expect(ref[0]!.cells.size).toBe(3);
    expect(pages.indexOf(ref[0]!)).toBe(pages.length - 1);
    expect(buildSeatPages(input, 'class').some((p) => p.title.includes('參考座位'))).toBe(false);
    expect(buildLabelPages(input).some((p) => p.title.includes('參考座位') || p.roomName.includes('參考座位'))).toBe(false);
  });
});
