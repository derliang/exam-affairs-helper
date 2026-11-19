/**
 * #400 WP-1／WP-5／WP-4（D137）：未參加者、全科缺考者直接進排座引擎；會考名冊每人都排座；容量數字各處一致。
 * 驗證不靠引擎自己的計數：身份由名冊＋考試名單算，去處從排座結果（班級座位、抽離紀錄）讀。全部假資料。
 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { studentCode, type ExamConfig } from '../data';
import { periodGroups } from '../core/detach';
import { examSubjectPeriods } from '../core/periods';
import { buildLabelPages, buildSeatPages } from '../export/model';
import { astDoc, bcctDoc, gsat270Doc } from './reconcileFixtures';
import { astCapacity, astPlan, astSlots, astStudents } from './ast/model';
import { classCapacity, studyCapacity } from './capacity';
import { flowOf } from './flow';
import { gateOf, reconcile, reconcileStandard } from './reconcile';
import { examEntries, examResult, reseat, seatableEntries } from './seating';
import { prepareExport } from './exportInput';
import { rosterFor } from './rosterYears';
import { updateExam, type Doc } from './store';
import { Step2 } from './pages/Step2';
import { Step3 } from './pages/Step3';
import { Step5 } from './pages/Step5';

const noop = () => undefined;

/** 每個時段、名冊每個人的去處（獨立從排座結果讀）：教室與身份（有考這時段任一科＝考生，否則自習生） */
function placesOf(doc: Doc, exam: ExamConfig) {
  const result = examResult(doc, exam)!;
  const roster = rosterFor(doc, exam)[exam.division] ?? [];
  const takes = new Map(examEntries(doc, exam).map((e) => [studentCode(e.classNo, e.seatNo), new Set(e.subjectIds)]));
  const groups = periodGroups(exam.subjects, examSubjectPeriods(exam, doc.settings));
  return groups.map((g) => {
    const rows = roster.map((s) => {
      const code = studentCode(s.classNo, s.seatNo);
      const kind = g.subjectIds.some((id) => takes.get(code)?.has(id)) ? 'exam' : 'study';
      const det = [...new Set(result.detaches.filter((d) => d.code === code && g.subjectIds.includes(d.subjectId)).map((d) => `${d.roomId}|${d.purpose}`))];
      const homes = result.assignments.filter((a) => a.code === code).map((a) => a.classroomId);
      const rooms = det.length ? det.map((x) => x.split('|')[0]!) : homes;
      return { code, kind, rooms, detPurpose: det.map((x) => x.split('|')[1]) };
    });
    const byRoom = new Map<string, Set<string>>();
    for (const r of rows) for (const id of r.rooms) byRoom.set(id, (byRoom.get(id) ?? new Set()).add(r.kind));
    return { key: g.subjectIds.join('+'), rows, mixed: [...byRoom].filter(([, k]) => k.size > 1).map(([id]) => id) };
  });
}

const expectEveryoneSeated = (doc: Doc, exam: ExamConfig, n: number) => {
  for (const g of placesOf(doc, exam)) {
    expect(g.rows.length, g.key).toBe(n);
    expect(g.rows.filter((r) => r.rooms.length !== 1).map((r) => r.code), `${g.key} 每人恰一個去處`).toEqual([]);
    // 抽離紀錄的用途與身份一致（考試的去考試、自習的去自習）
    expect(g.rows.filter((r) => r.detPurpose.some((p) => p !== r.kind)).map((r) => r.code), `${g.key} 身份錯位`).toEqual([]);
    expect(g.mixed, `${g.key} 同一間教室有人考試、有人自習`).toEqual([]);
  }
};

const noFail = (doc: Doc, exam: ExamConfig) => {
  const r = reconcile(doc, exam);
  if (r.state !== 'ready') throw new Error(r.state);
  expect(r.checks.filter((c) => c.light === 'fail').map((c) => `${c.id} ${c.summary} ${c.issues.map((i) => i.text).join('；')}`)).toEqual([]);
  return r;
};

describe('WP-1 學測：未參加者、全科缺考者直接進排座引擎（D137）', () => {
  it('第 1、4 班各 4 人未參加：270 人每時段都有一個座位，未參加者是自習生、與考生不同室；對帳不擋', () => {
    const { doc, exam } = gsat270Doc({ notJoined: 4, reserve2: true });
    expect(examEntries(doc, exam)).toHaveLength(262);
    expect(seatableEntries(doc, exam)).toHaveLength(270);
    expectEveryoneSeated(doc, exam, 270);
    const unlisted = ['0143', '0144', '0145', '0146', '0441', '0442', '0443', '0444'];
    for (const g of placesOf(doc, exam)) for (const c of unlisted) expect(g.rows.find((r) => r.code === c)!.kind).toBe('study');
    const r = noFail(doc, exam);
    if (r.state !== 'ready') return;
    for (const l of r.ledger) { expect(l.scope).toBe(270); expect(l.exam + l.study).toBe(270); expect(l.absent).toBe(0); expect(l.ok, l.subject).toBe(true); }
    expect(r.scope).toEqual({ total: 270, enrolled: 262, absent: 8 });
  });

  it('同樣情境只有一間預備教室：排座擋下「預備教室座位不足」，容量計算也算到未參加者（社會不考 46＋未參加 4＝50 人＞49 座）', () => {
    const { doc, exam } = gsat270Doc({ notJoined: 4, noSeat: true });
    const r = reseat(doc, exam, '2026-11-18T03:00:00Z');
    expect(r.ok).toBe(false);
    const sc = studyCapacity(doc, exam);
    expect(sc.ok).toBe(false);
    const soc = sc.groups.find((g) => g.key.includes('social'))!;
    expect([soc.studyCount, soc.ok]).toEqual([50, false]);
  });

  it('全科缺考者預設排座（第 2、5 班各 2 人）：有座位、每節自習、與考生不同室；座位表列出、不印標籤', () => {
    const { doc, exam } = gsat270Doc({ fullyAbsent: 2, reserve2: true });
    expectEveryoneSeated(doc, exam, 270);
    noFail(doc, exam);
    const p = prepareExport(doc, exam);
    if (!p.ok) throw new Error(p.errors.join());
    const absent = ['0201', '0202', '0501', '0502'];
    const seatCodes = new Set(buildSeatPages(p.input, 'class').flatMap((pg) => [...pg.cells.values()].map((c) => c.code)));
    const labelCodes = new Set(buildLabelPages(p.input, 'class').flatMap((pg) => pg.cells.map((c) => c.code)));
    for (const c of absent) { expect(seatCodes.has(c), c).toBe(true); expect(labelCodes.has(c), c).toBe(false); }
    expect(labelCodes.has('0203')).toBe(true);
  });

  it('D146：學測原班座位表，不參加的人（名單外與一科都沒報）格內小牌「X 不參加」、頁首有人數；考生沒有；預備教室頁沒有', () => {
    const { doc, exam } = gsat270Doc({ notJoined: 2, fullyAbsent: 2, reserve2: true });
    const p = prepareExport(doc, exam);
    if (!p.ok) throw new Error(p.errors.join());
    const flagged = new Set<string>();
    let chips = 0;
    for (const pg of buildSeatPages(p.input, 'class')) {
      for (const c of pg.cells.values()) if ((c.corners ?? []).some((k) => k.text === 'X 不參加')) flagged.add(c.code);
      if (pg.chips.some((x) => x.startsWith('不參加 '))) chips++;
    }
    const none = new Set(p.input.entries.filter((e) => e.subjectIds.length === 0).map((e) => studentCode(e.classNo, e.seatNo)));
    expect(none.size).toBe(flagged.size);
    expect([...none].every((c) => flagged.has(c))).toBe(true);
    expect(flagged.size).toBeGreaterThanOrEqual(4);
    expect(chips).toBeGreaterThan(0);
  });

  it('D142：拿掉「不排座」選項；舊存檔帶 seatFullyAbsent: false 也照樣排座，對帳無紅燈', () => {
    const f = gsat270Doc({ fullyAbsent: 2, reserve2: true, noSeat: true });
    const u = updateExam(f.doc, f.exam.id, ({ seatFullyAbsent: false } as Partial<ExamConfig>));
    if (!u.ok) throw new Error(u.error);
    const exam = u.doc.exams[0]!;
    const s = reseat(u.doc, exam, '2026-11-18T03:00:00Z');
    if (!s.ok) throw new Error(s.error);
    expect(seatableEntries(s.doc, exam)).toHaveLength(270);
    const r = reconcileStandard(s.doc, exam);
    if (r.state !== 'ready') throw new Error(r.state);
    expect(r.checks.find((c) => c.id === 'M-3')!.light).not.toBe('fail');
    expect(gateOf(r, '').fails).toBe(0);
  });
});

describe('WP-5 會考：名冊每個人都排座位（會考不可不參加）', () => {
  it('匯入的名單少 2 人、另有 2 人全科缺考：20 人都有座位；名單外與全科缺考算「未參加」欄（座位在、人不來）；不印他們的標籤', () => {
    const { doc, exam } = bcctDoc({ missing: 2, fullyAbsent: 2 });
    expect(examEntries(doc, exam)).toHaveLength(18);
    expect(seatableEntries(doc, exam)).toHaveLength(20);
    const res = examResult(doc, exam)!;
    expect(new Set(res.assignments.map((a) => a.code)).size).toBe(20);
    const r = noFail(doc, exam);
    if (r.state !== 'ready') return;
    for (const l of r.ledger) { expect([l.scope, l.exam, l.study, l.absent]).toEqual([20, 16, 0, 4]); expect(l.ok).toBe(true); }
    const p = prepareExport(doc, exam);
    if (!p.ok) throw new Error(p.errors.join());
    const labels = buildLabelPages(p.input, 'all').flatMap((pg) => pg.cells.map((c) => c.code));
    expect(labels).toHaveLength(16);
    expect(labels).not.toContain('0109');
    expect(labels).not.toContain('0201');
  });

  it('會考：舊存檔帶「不排座」也照排', () => {
    const f = bcctDoc({ fullyAbsent: 2 });
    const u = updateExam(f.doc, f.exam.id, ({ seatFullyAbsent: false } as Partial<ExamConfig>));
    if (!u.ok) throw new Error(u.error);
    expect(seatableEntries(u.doc, u.doc.exams[0]!)).toHaveLength(20);
  });
});

describe('WP-4 容量數字：第 2、3、5 步、流程摘要、對帳、自習容量同一個算法', () => {
  const cases: [string, () => { doc: Doc; exam: ExamConfig }, number][] = [
    ['學測 未參加＋全科缺考', () => gsat270Doc({ notJoined: 4, fullyAbsent: 2, reserve2: true }), 270],
    ['學測 沒有未參加者', () => gsat270Doc(), 270],
    ['會考 名單少人＋全科缺考', () => bcctDoc({ missing: 2, fullyAbsent: 2 }), 20],
  ];
  for (const [name, make, n] of cases) {
    it(`${name}：要排座的人數四處相等（=${n}）`, () => {
      const { doc, exam } = make();
      const seatable = seatableEntries(doc, exam).length;
      const cc = classCapacity(doc, exam).lines.reduce((m, l) => m + l.students, 0);
      const flow = flowOf(doc, exam, 3).summary.students;
      const r = reconcile(doc, exam);
      const recon = r.state === 'ready' ? r.scope.total : -1;
      expect([seatable, cc, flow, recon]).toEqual([n, n, n, n]);
      // ② 匯入統計：考生＋不參加＝名冊；③、⑤ 畫面顯示的考生人數
      const s2 = /考生 (\d+) 人，不參加 (\d+) 人/.exec(renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />));
      if (examEntries(doc, exam).length !== n || exam.kind !== 'bcct') expect(s2 && Number(s2[1]) + Number(s2[2])).toBe(n);
      const s3 = renderToString(<Step3 doc={doc} exam={exam} onChange={noop} />);
      const sum3 = [...s3.matchAll(/class="sub">考生 (\d+)</g)].reduce((m, x) => m + Number(x[1]), 0);
      expect(sum3).toBe(n);
      const s5 = renderToString(<Step5 doc={doc} exam={exam} onChange={noop} onStep={noop} />);
      expect(s5).toMatch(new RegExp(`考生</[^>]+>\\s*<[^>]+>${n}<|考生[^0-9<]*<[^>]*>${n}<`));
    });
  }

  it('自習容量（③④⑤ 共用）與排座結果、對帳同一組抽離人數', () => {
    const { doc, exam } = gsat270Doc({ notJoined: 4, fullyAbsent: 2, reserve2: true });
    const res = examResult(doc, exam)!;
    const sc = studyCapacity(doc, exam);
    expect(sc.ok).toBe(true);
    for (const g of sc.groups) {
      const ids = g.key.split('+');
      const ex = new Set(res.detaches.filter((d) => d.purpose === 'exam' && ids.includes(d.subjectId)).map((d) => d.code)).size;
      const st = new Set(res.detaches.filter((d) => d.purpose === 'study' && ids.includes(d.subjectId)).map((d) => d.code)).size;
      expect([g.examCount, g.studyCount], g.key).toEqual([ex, st]);
    }
    const r = reconcile(doc, exam);
    if (r.state !== 'ready') throw new Error(r.state);
    expect(r.checks.find((c) => c.id === 'M-5')!.issues.filter((i) => i.text.startsWith('口徑不一致'))).toEqual([]);
  });
});

describe('WP-4 分科容量數字（astCapacity）：未參加者、全科缺考者都算進去，與規劃結果一致', () => {
  it('名冊多 6 人未參加、名單上 1 人全科缺考：全體人數＝名冊、每節自習生＝名冊－考生，考場需求＝獨立點的最多考生數', () => {
    const base = astDoc();
    const more = Array.from({ length: 6 }, (_, k) => ({ classNo: 1 + (k % 6), seatNo: 40 + k, name: `外加${k}` }));
    const files = base.doc.examFiles![base.exam.id]!;
    const entries = files.entries!.map((e) => (e.classNo === 2 && e.seatNo === 1 ? { ...e, subjectIds: [] } : e));
    const doc: Doc = { ...base.doc, rosters: { ...base.doc.rosters, senior: [...base.doc.rosters.senior, ...more] }, examFiles: { ...base.doc.examFiles, [base.exam.id]: { ...files, entries } } };
    const exam = base.exam;
    const roster = doc.rosters.senior.length;
    const slots = astSlots(doc, exam);
    expect(astStudents(doc, exam, slots)).toHaveLength(roster);
    const plan = astPlan(doc, exam)!;
    const cap = astCapacity(doc, exam, plan);
    expect(cap.everyone.people).toBe(roster);
    expect(cap.studyOnly).toBe(7);
    // 考場需求：每組、每時段考生數的最大值（獨立從考試名單＋班級組別算）
    const trackOf = new Map(doc.settings.classes.map((c) => [c.no, c.track]));
    for (const t of ['science', 'liberal'] as const) {
      const need = Math.max(...slots.map((sl) => entries.filter((e) => (e.track ?? trackOf.get(e.classNo)) === t && e.subjectIds.some((id) => sl.subjectIds.includes(id))).length));
      expect(cap[t].need, t).toBe(need);
    }
    // 每個時段：考試座位＋自習去處＋排不進去＝名冊人數；自習需求＝在綜合教室自習的最多人數
    const reserve = new Set(doc.settings.classrooms.filter((r) => r.kind === 'reserve').map((r) => r.id));
    let studyNeed = 0;
    for (const sl of slots) {
      const ex = new Set(plan.out.exams.filter((x) => x.slotId === sl.id).map((x) => x.code)).size;
      const st = plan.out.study.filter((x) => x.slotId === sl.id);
      const un = plan.out.unplaced?.filter((x) => x.slotId === sl.id).length ?? 0;
      expect(ex + st.length + un, sl.label).toBe(roster);
      studyNeed = Math.max(studyNeed, st.filter((x) => reserve.has(x.roomId)).length + un);
    }
    expect(cap.study.need).toBe(studyNeed);
  });
});
