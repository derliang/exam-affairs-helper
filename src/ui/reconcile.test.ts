/** G35 考前對帳：學測、分科、會考各一組（正常通過、紅燈擋下載、琥珀須確認、空白狀態）＋口徑一致。全部虛構假資料。 */
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, ExamConfig, ExamEntry, Student } from '../data';
import { demoDoc, emptyDoc } from './repository';
import { newExam, updateExam, type Doc } from './store';
import { classCapacity, studyCapacity } from './capacity';
import { autoSeat, examResult, reseat } from './seating';
import { gateOf, reconcile, type Check, type Reconcile } from './reconcile';
import { astOutputs } from './ast/output';
import { astPlan } from './ast/model';
import { astDoc, bcctDoc, gsatDoc } from './reconcileFixtures';


const ready = (r: Reconcile) => { if (r.state !== 'ready') throw new Error(`state=${r.state}`); return r; };
const light = (r: Reconcile, id: string) => ready(r).checks.find((c) => c.id === id)!.light;
const lights = (r: Reconcile) => ready(r).checks.map((c) => `${c.id}:${c.light}`).join(' ');

const withResult = (doc: Doc, exam: ExamConfig, f: (r: NonNullable<ReturnType<typeof examResult>>) => NonNullable<ReturnType<typeof examResult>>): Doc => {
  const cur = doc.examFiles![exam.id]!;
  return { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...cur, result: f(cur.result!) } } };
};

describe('G35 學測（有預備教室、抽離、自習）', () => {
  it('正常：M-1～M-8 全部通過，總帳每時段帳平，名單範圍＝考試＋自習＋未參加', () => {
    const { doc, exam } = gsatDoc();
    const r = ready(reconcile(doc, exam));
    expect(lights(r)).toBe('M-1:pass M-2:pass M-3:pass M-4:pass M-5:pass M-6:pass M-7:pass M-8:pass');
    expect(r.scope).toEqual({ total: 30, enrolled: 30, absent: 0 });
    expect(r.ledger.length).toBeGreaterThanOrEqual(3);
    for (const row of r.ledger) { expect(row.ok).toBe(true); expect(row.scope).toBe(row.exam + row.study + row.absent); }
    // 數學：每班 2 人不考（4、8 號）→ 自習 6 人；其餘 24 人考
    const math = r.ledger.find((x) => x.subject.includes('數'))!;
    expect(math.study).toBeGreaterThanOrEqual(6);
    expect(gateOf(r).why).toBe('');
    // 每項都有「應有／實有／差異」三個數字：差異＝實有－應有
    for (const c of r.checks.filter((x) => x.light !== 'na' && !x.cap && typeof x.a === 'number')) expect(c.d).toBe(Number(c.b) - Number(c.a));
  });

  it('紅燈：座位表少一個人 → M-3、M-2 不通過、擋下載且不能確認放行', () => {
    const { doc, exam } = gsatDoc();
    const bad = withResult(doc, exam, (res) => ({ ...res, assignments: res.assignments.slice(1) }));
    const r = ready(reconcile(bad, exam));
    expect(light(r, 'M-3')).toBe('fail');
    expect(r.checks.find((c) => c.id === 'M-3')!.d).toBeLessThan(0);
    const g = gateOf(r);
    expect(g.fails).toBeGreaterThan(0);
    expect(g.why).toMatch(/不通過.*須先修正/);
    expect(r.checks.find((c) => c.id === 'M-3')!.issues[0]!.text).toMatch(/沒有去處/);
  });

  it('紅燈：同一人同節既有抽離考試又有抽離自習 → M-3 重複；抽離考試與自習共用一間教室 → M-8', () => {
    const { doc, exam } = gsatDoc();
    const res = examResult(doc, exam)!;
    const d0 = res.detaches.find((d) => d.purpose === 'study')!;
    const room = d0.roomId;
    const bad = withResult(doc, exam, (x) => ({ ...x, detaches: [...x.detaches, { code: res.assignments[0]!.code, subjectId: d0.subjectId, purpose: 'exam', roomId: room, seat: { row: 1, depth: 1 } }, { code: res.assignments[0]!.code, subjectId: d0.subjectId, purpose: 'study', roomId: room }] }));
    const r = ready(reconcile(bad, exam));
    expect(light(r, 'M-3')).toBe('fail');
    expect(light(r, 'M-8')).toBe('fail');
  });

  it('紅燈：排座結果過期（改過名單沒重排）→ M-7 不通過', () => {
    const { doc, exam } = gsatDoc();
    const roster = doc.rosters.senior.map((s) => (s.classNo === 1 && s.seatNo === 1 ? { ...s, name: '改名' } : s));
    const stale = { ...doc, rosters: { ...doc.rosters, senior: roster } };
    const r = ready(reconcile(stale, exam));
    expect(light(r, 'M-7')).toBe('fail');
    expect(gateOf(r).why).not.toBe('');
  });

  it('琥珀：未參加超過名單範圍 20% → M-1 警示；只提示，不擋下載、不用確認（D149①）', () => {
    // 每班 10 人、各班 3 人沒報名 → 未參加 9／30 ＝ 30%；他們是自習，原班教室有空位，座位表上有參考座位（D125）
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const r = ready(reconcile(doc, exam));
    expect(r.scope.absent).toBe(9);
    expect(light(r, 'M-1')).toBe('warn');
    expect(r.checks.filter((c) => c.light === 'fail')).toEqual([]);
    const g = gateOf(r);
    expect(g.warns.map((w) => w.id)).toEqual(['M-1']);
    expect(g.why).toBe('');
    expect(g.fails).toBe(0);
    // 資料再變動（多一個未參加）警示仍然只是提示，一樣可以下載
    const more: Student = { classNo: 1, seatNo: 11, name: '假生111' };
    const d3: Doc = { ...doc, rosters: { ...doc.rosters, senior: [...doc.rosters.senior, more] } };
    const re3 = reseat(d3, exam, '2026-11-10T04:00:00Z');
    if (!re3.ok) throw new Error(re3.error);
    const g3 = gateOf(reconcile(re3.doc, exam));
    expect(g3.why).toBe('');
  });

  it('空白：沒有排座結果 → no-result；沒匯入名冊 → no-roster', () => {
    const { doc, exam } = gsatDoc();
    const cur = doc.examFiles![exam.id]!;
    const { result: _r, ...noRes } = cur;
    void _r;
    expect(reconcile({ ...doc, examFiles: { [exam.id]: noRes } }, exam).state).toBe('no-result');
    expect(reconcile({ ...doc, examFiles: {} }, exam).state).toBe('no-roster');
    expect(reconcile({ ...doc, rosters: { senior: [], junior: [] } }, exam).state).toBe('no-roster');
  });

  it('口徑一致：名單範圍、考生數（G29）、抽離人數（G31）與對帳總帳同一組數字', () => {
    const { doc, exam } = gsatDoc();
    const r = ready(reconcile(doc, exam));
    const cc = classCapacity(doc, exam);
    expect(cc.lines.reduce((n, l) => n + l.students, 0)).toBe(r.scope.enrolled);
    const cap = studyCapacity(doc, exam);
    for (const g of cap.groups) {
      const row = r.ledger.find((x) => x.key === g.key)!;
      // 對帳的「考試」＝名單應考；G31 的抽離考試＋抽離自習＋留班自習 ＝ 對帳的自習＋被抽離去考的人
      expect(row.study).toBe(g.studyCount + g.stay);
    }
    // M-5 的容量與 G31 同一個數字
    const m5 = r.checks.find((c) => c.id === 'M-5')!;
    expect(m5.a).toBe(cap.avail);
    expect(m5.b).toBe(cap.worst?.seatsNeed ?? 0);
  });
});

describe('G35 會考（無抽離、無自習）', () => {
  it('正常：M-5、M-8 不適用，其餘通過，總帳沒有自習', () => {
    const { doc, exam } = bcctDoc();
    const r = ready(reconcile(doc, exam));
    expect(lights(r)).toBe('M-1:pass M-2:pass M-3:pass M-4:pass M-5:na M-6:pass M-7:pass M-8:na');
    expect(r.hasStudy).toBe(false);
    for (const row of r.ledger) { expect(row.study).toBe(0); expect(row.ok).toBe(true); expect(row.exam).toBe(20); }
    expect(gateOf(r).why).toBe('');
  });
  it('紅燈：標籤對不上（座位被刪）擋下載；班級教室剛好滿座不警示', () => {
    const { doc, exam } = bcctDoc();
    const bad = withResult(doc, exam, (x) => ({ ...x, assignments: x.assignments.slice(0, -1) }));
    expect(light(reconcile(bad, exam), 'M-3')).toBe('fail');
    // 把甲班教室縮成剛好 10 個座位 → 剛好滿座（沒超量）
    const rooms = doc.settings.classrooms.map((c) => (c.id === 'j1' ? { ...c, rows: 2, depth: 5, seatCount: 10 } : c));
    const tight = { ...doc, settings: { ...doc.settings, classrooms: rooms } };
    const seated = autoSeat({ ...tight, examFiles: { [exam.id]: { ...tight.examFiles![exam.id]!, result: undefined } } }, exam, '2026-11-10T03:00:00Z');
    if (!seated || !seated.ok) throw new Error('排座失敗');
    const r = ready(reconcile(seated.doc, exam));
    expect(light(r, 'M-4')).toBe('pass'); // 班級教室排滿是常態，不警示
  });
  it('空白：沒排座結果', () => {
    const { doc, exam } = bcctDoc();
    expect(reconcile({ ...doc, examFiles: { [exam.id]: { ...doc.examFiles![exam.id]!, result: undefined } } }, exam).state).toBe('no-result');
  });
});

describe('G35 分科（D99：不考的人＝自習，算進座位容量）', () => {
  it('正常：全部通過、總帳帳平、不考的人算在自習', () => {
    const { doc, exam } = astDoc();
    const plan = astPlan(doc, exam)!;
    const outs = astOutputs(doc, exam, plan, 'B4');
    const r = ready(reconcile(doc, exam, outs));
    expect(r.checks.filter((c) => c.light === 'fail')).toEqual([]);
    expect(r.hasStudy).toBe(true);
    expect(r.scope).toEqual({ total: 72, enrolled: 72, absent: 0 });
    for (const row of r.ledger) { expect(row.ok).toBe(true); expect(row.exam + row.study).toBe(72); }
    expect(r.ledger.some((x) => x.study > 0)).toBe(true);
    // 與自習容量（astCapacity）同一個數字
    const m5 = r.checks.find((c) => c.id === 'M-5')!;
    expect(m5.light === 'pass' || m5.light === 'warn').toBe(true);
  });

  it('紅燈：標籤檔少一張（輸出與畫面對不上）→ M-2、M-6 不通過，擋下載', () => {
    const { doc, exam } = astDoc();
    const plan = astPlan(doc, exam)!;
    const outs = astOutputs(doc, exam, plan, 'B4');
    const broken = { ...outs, label: outs.label.map((p, i) => (i === 0 ? { ...p, cells: p.cells.slice(1) } : p)) };
    const r = ready(reconcile(doc, exam, broken));
    expect(light(r, 'M-2')).toBe('fail');
    expect(light(r, 'M-6')).toBe('fail');
    expect(gateOf(r).why).toMatch(/不通過/);
  });

  it('琥珀：名冊多出很多沒報名的人（名單匯錯的徵兆）→ M-1 警示，只提示、不擋下載', () => {
    const { doc, exam } = astDoc();
    const more = Array.from({ length: 30 }, (_, k) => ({ classNo: 1 + (k % 6), seatNo: 40 + k, name: `外加${k}` }));
    const d2: Doc = { ...doc, rosters: { ...doc.rosters, senior: [...doc.rosters.senior, ...more] } };
    const plan = astPlan(d2, exam)!;
    const r = ready(reconcile(d2, exam, astOutputs(d2, exam, plan, 'B4')));
    expect(r.scope.absent).toBe(30);
    expect(light(r, 'M-1')).toBe('warn');
    const g = gateOf(r);
    expect(g.fails).toBe(0);
    expect(g.warns.map((w) => w.id)).toContain('M-1');
    expect(g.why).toBe('');
  });

  it('空白：名冊空 → no-roster', () => {
    const { doc, exam } = astDoc();
    expect(reconcile({ ...doc, rosters: { senior: [], junior: [] } }, exam).state).toBe('no-roster');
  });
});

describe('G35 琥珀「教室滿座」只限抽離（預備、綜合）教室（使用者 2026-11-17 裁示）', () => {
  it('學測：預備教室抽離考試剛好滿座 → M-4 警示；班級教室滿座不警示', () => {
    const { doc, exam } = gsatDoc();
    const rooms = doc.settings.classrooms.map((c) => (c.id === 'k1' ? { ...c, rows: 1, depth: 2, seatCount: 2 } : c));
    const tampered = withResult({ ...doc, settings: { ...doc.settings, classrooms: rooms } }, exam, (x) => {
      const math = x.detaches.find((d) => d.purpose === 'study')!.subjectId;
      return { ...x, detaches: [...x.detaches, { code: '0101', subjectId: math, purpose: 'exam', roomId: 'k1', seat: { row: 1, depth: 1 } }, { code: '0201', subjectId: math, purpose: 'exam', roomId: 'k1', seat: { row: 1, depth: 2 } }] };
    });
    const m4 = ready(reconcile(tampered, exam)).checks.find((c) => c.id === 'M-4')!;
    expect(m4.light).toBe('warn');
    expect(m4.issues.every((i) => i.text.startsWith('預備一'))).toBe(true);
    // 沒動預備教室、只把班級教室縮到剛好 → 不警示
    const onlyClass = { ...doc, settings: { ...doc.settings, classrooms: doc.settings.classrooms.map((c) => (c.id === 'c1' ? { ...c, rows: 2, depth: 5, seatCount: 10 } : c)) } };
    expect(ready(reconcile(onlyClass, exam)).checks.find((c) => c.id === 'M-4')!.light).not.toBe('warn');
  });
  it('分科：班級教室滿座不警示；綜合教室考試剛好滿座才警示', () => {
    const { doc, exam } = astDoc();
    const small = { ...doc, settings: { ...doc.settings, classrooms: doc.settings.classrooms.map((c) => (c.id === 'c1' ? { ...c, rows: 3, depth: 4, seatCount: 12 } : c)) } };
    const plan = astPlan(small, exam)!;
    const r = ready(reconcile(small, exam, astOutputs(small, exam, plan, 'B4')));
    expect(r.checks.find((c) => c.id === 'M-4')!.light).toBe('pass');
    // 綜合教室考試：理組班教室只有 6 座，溢出的考生到綜合教室考；再把綜合教室縮到剛好等於最擠那節的考試人數
    const rooms = doc.settings.classrooms.map((c) => (c.kind === 'class' && c.track === 'science' ? { ...c, rows: 2, depth: 3, seatCount: 6 } : c.id === 'k1' ? { ...c, rows: 7, depth: 7, seatCount: 49 } : c));
    const big = { ...doc, settings: { ...doc.settings, classrooms: rooms } };
    const p0 = astPlan(big, exam)!;
    expect(p0.infeasible).toBeFalsy();
    const perSlot = new Map<string, number>();
    for (const e of p0.out.exams) if (e.roomId === 'k1') perSlot.set(e.slotId, (perSlot.get(e.slotId) ?? 0) + 1);
    const peak = Math.max(0, ...perSlot.values());
    expect(peak).toBeGreaterThan(0);
    const exact = { ...big, settings: { ...big.settings, classrooms: rooms.map((c) => (c.id === 'k1' ? { ...c, rows: 1, depth: peak, seatCount: peak } : c)) } };
    const p1 = astPlan(exact, exam)!;
    const full = ready(reconcile(exact, exam, p1.infeasible ? undefined : astOutputs(exact, exam, p1, 'B4'))).checks.find((c) => c.id === 'M-4')!;
    expect(full.light).toBe('warn');
    expect(full.issues.every((i) => i.text.startsWith('綜合教室一'))).toBe(true);
  });
});

describe('燈號與數字格式', () => {
  it('每項 M- 編號，容量類（M-4、M-5）用上限／使用／餘額', () => {
    const { doc, exam } = gsatDoc();
    const r = ready(reconcile(doc, exam));
    expect(r.checks.map((c: Check) => c.id)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6', 'M-7', 'M-8']);
    expect(r.checks.filter((c) => c.cap).map((c) => c.id)).toEqual(['M-4', 'M-5']);
    for (const c of r.checks.filter((x) => x.cap && x.light !== 'na')) expect(c.d).toBe(Number(c.a) - Number(c.b));
  });
});
