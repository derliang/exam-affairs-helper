/**
 * 對帳鐵則（使用者 2026-11-18）：每個時段，學生人數＝考試人數＋自習人數，每個人都要有去處。
 * 「未參加」（名冊有、考試名單沒有）就是自習：學測、分科都要排座位、不印標籤、座位表上列班級座號姓名（D137 起直接進排座引擎）。
 * 取代對帳原本「名單範圍＝考試＋自習＋未參加」的第三類（D125 的後續）。全部虛構假資料。
 */
import { describe, expect, it } from 'vitest';
import type { ExamEntry, Student } from '../data';
import type { Doc } from './store';
import { reseat } from './seating';
import { gateOf, reconcile, type Reconcile } from './reconcile';
import { astOutputs } from './ast/output';
import { astPlan, astStudents, astSlots } from './ast/model';
import { astDoc, bcctDoc, gsatDoc } from './reconcileFixtures';

const ready = (r: Reconcile) => { if (r.state !== 'ready') throw new Error(`state=${r.state}`); return r; };
const light = (r: Reconcile, id: string) => ready(r).checks.find((c) => c.id === id)!.light;
const code = (c: number, s: number) => `${String(c).padStart(2, '0')}${String(s).padStart(2, '0')}`;

describe('學測：未參加＝自習，座位表上要有他的座位', () => {
  it('帳平：名冊＝考試＋自習，沒有第三類；未參加的人算進每時段的自習', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const r = ready(reconcile(doc, exam));
    expect(r.hasAbsent).toBe(false);
    expect(r.scope).toEqual({ total: 30, enrolled: 21, absent: 9 });
    for (const row of r.ledger) {
      expect(row.ok).toBe(true);
      expect(row.absent).toBe(0);
      expect(row.exam + row.study).toBe(30);
      // 9 個未參加的人每時段都在自習
      expect(row.study).toBeGreaterThanOrEqual(9);
    }
    expect(light(r, 'M-3')).toBe('pass');
    const m3 = r.checks.find((c) => c.id === 'M-3')!;
    expect(m3.summary).toContain('30 人');
    expect(r.checks.filter((c) => c.light === 'fail')).toEqual([]);
  });

  it('教室座位不夠連未參加者一起坐：排座引擎直接擋下（D137：他們在引擎裡，不是另貼的參考座位）', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    // 理組（第 1、3 班）教室縮成 9＋10＝19 座：考生 14 人＋未參加的自習生 6 人＝20 人，坐不下（舊版只算考生 14 人會放行）
    const rooms = doc.settings.classrooms.map((c) => (c.id === 'c1' ? { ...c, rows: 3, depth: 3, seatCount: 9 } : c.id === 'c3' ? { ...c, rows: 2, depth: 5, seatCount: 10 } : c));
    const small: Doc = { ...doc, settings: { ...doc.settings, classrooms: rooms } };
    expect(reseat(small, exam, '2026-11-10T04:00:00Z').ok).toBe(false);
  });

  it('紅燈：未參加的人在排座結果裡沒有座位 → M-3 不通過、總帳不平、擋下載、指出是誰', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const cur = doc.examFiles![exam.id]!;
    const res = cur.result!;
    const broken: Doc = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...cur, result: { ...res, assignments: res.assignments.filter((a) => a.code !== '0110'), detaches: res.detaches.filter((d) => d.code !== '0110') } } } };
    const r = ready(reconcile(broken, exam));
    expect(light(r, 'M-3')).toBe('fail');
    const m3 = r.checks.find((c) => c.id === 'M-3')!;
    expect(m3.d).toBeLessThan(0);
    expect(m3.issues[0]!.text).toMatch(/01 班 10 號.*沒有去處/);
    expect(r.ledger.every((x) => !x.ok)).toBe(true);
    const g = gateOf(r);
    expect(g.fails).toBeGreaterThan(0);
    expect(g.why).toMatch(/不通過.*須先修正/);
  });

  it('全科缺考（D137 預設排座）也是自習，有座位；算報名者、不算未參加', () => {
    const { doc, exam } = gsatDoc();
    const cur = doc.examFiles![exam.id]!;
    const entries: ExamEntry[] = cur.entries!.map((e) => (e.classNo === 1 && e.seatNo === 5 ? { ...e, subjectIds: [] } : e));
    const d2: Doc = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...cur, entries } } };
    const re = reseat(d2, exam, '2026-11-10T04:00:00Z');
    if (!re.ok) throw new Error(re.error);
    const r = ready(reconcile(re.doc, exam));
    expect(r.scope).toEqual({ total: 30, enrolled: 30, absent: 0 });
    expect(re.doc.examFiles![exam.id]!.result!.assignments.some((a) => a.code === '0105')).toBe(true);
    expect(r.checks.filter((c) => c.light === 'fail')).toEqual([]);
    for (const row of r.ledger) { expect(row.ok).toBe(true); expect(row.exam + row.study).toBe(30); }
  });

  it('會考沒有自習：未參加另計（WP-5：會考名冊每人都有座位，見 engineWp1.test）', () => {
    const { doc, exam } = bcctDoc();
    const r = ready(reconcile(doc, exam));
    expect(r.hasAbsent).toBe(true);
    expect(r.hasStudy).toBe(false);
  });
});

describe('分科：未參加也是自習，一樣排自習座位（使用者：「分科也是這樣」）', () => {
  const withNotJoined = (n: number) => {
    const { doc, exam } = astDoc();
    const more: Student[] = Array.from({ length: n }, (_, k) => ({ classNo: 1 + (k % 6), seatNo: 40 + k, name: `外加${k}` }));
    const d2: Doc = { ...doc, rosters: { ...doc.rosters, senior: [...doc.rosters.senior, ...more] } };
    return { doc: d2, exam, more };
  };

  it('未參加的人進規劃：每節都有自習去處，帳平，M-3 通過', () => {
    const { doc, exam, more } = withNotJoined(6);
    const plan = astPlan(doc, exam)!;
    for (const m of more) expect(plan.out.study.some((s) => s.code === code(m.classNo, m.seatNo))).toBe(true);
    const r = ready(reconcile(doc, exam, astOutputs(doc, exam, plan, 'B4', true)));
    expect(r.hasAbsent).toBe(false);
    expect(r.scope).toEqual({ total: 78, enrolled: 72, absent: 6 });
    expect(r.checks.filter((c) => c.light === 'fail')).toEqual([]);
    expect(light(r, 'M-3')).toBe('pass');
    for (const row of r.ledger) { expect(row.ok).toBe(true); expect(row.absent).toBe(0); expect(row.exam + row.study).toBe(78); }
  });

  it('自習座位表上列出他們的班級、座號、姓名，沒有標籤', () => {
    const { doc, exam, more } = withNotJoined(6);
    const plan = astPlan(doc, exam)!;
    const outs = astOutputs(doc, exam, plan, 'B4', true);
    // 座位頁的格子是 Map，不能用 JSON.stringify 找；逐格看班級、座號（code）與姓名
    const cells = outs.seat.flatMap((p) => [...(p.cells instanceof Map ? p.cells.values() : p.cells)]);
    for (const m of more) {
      const c = cells.find((x) => x.code === code(m.classNo, m.seatNo));
      expect(c, `${m.name} 在自習座位表上`).toBeTruthy();
      expect(c!.name).toBe(m.name);
      expect(c!.classLabel).toBeTruthy();
      expect(c!.corners?.some((k) => k.text === '自習')).toBe(true);
    }
    // 不印標籤：標籤頁上沒有他們
    const labelCells = outs.label.flatMap((p) => [...(p.cells instanceof Map ? p.cells.values() : p.cells)]);
    for (const m of more) expect(labelCells.some((x) => x.code === code(m.classNo, m.seatNo))).toBe(false);
  });

  it('沒有未參加的人時，規劃名單與舊版相同（只有考試名單的人）；還沒匯入考試名單就沒有規劃名單', () => {
    const { doc, exam } = astDoc();
    const slots = astSlots(doc, exam);
    expect(astStudents(doc, exam, slots).length).toBe(72);
    const cur = doc.examFiles![exam.id]!;
    const none: Doc = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...cur, entries: [] } } };
    expect(astStudents(none, exam, astSlots(none, exam)).length).toBe(0);
  });
});
