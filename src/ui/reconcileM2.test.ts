/** #381、#382（D149④、D153）：M-2 座位表與各教室加總＝名冊總人數（每人每時段一個去處），標籤＝應考人數（自習者不印標籤）。全部匿名假資料。 */
import { describe, expect, it } from 'vitest';
import { reconcile, ledgerWant, type Reconcile } from './reconcile';
import { astDoc, bcctDoc, gsatDoc } from './reconcileFixtures';
import { astPlan } from './ast/model';
import { astOutputs } from './ast/output';

const ready = (r: Reconcile) => {
  if (r.state !== 'ready') throw new Error(r.state);
  return r;
};

describe('M-2 以名冊總人數為準（學測）', () => {
  it('每個時段：座位表＝各教室加總＝名冊總人數；標籤＝應考人數；M-2 通過', () => {
    const { doc, exam } = gsatDoc();
    const r = ready(reconcile(doc, exam));
    expect(r.checks.find((c) => c.id === 'M-2')!.light).toBe('pass');
    for (const row of r.ledger) {
      expect(row.all).toBe(true);
      expect(row.seat).toBe(row.scope);
      expect(row.room).toBe(row.scope);
      expect(row.label).toBe(row.exam);
      expect(ledgerWant(row)).toEqual({ seat: row.scope, label: row.exam, room: row.scope });
      expect(row.ok).toBe(true);
    }
    // 有人不考的時段（數學每班 2 人不考）：標籤比座位表少，這是設計（自習者不印標籤），不是差異
    const math = r.ledger.find((x) => x.subject.includes('數'))!;
    expect(math.label).toBeLessThan(math.seat);
  });

  it('座位表少一個人 → M-2 不通過（差異看總人數，不是應考人數）', () => {
    const { doc, exam } = gsatDoc();
    const f = doc.examFiles![exam.id]!;
    const res = f.result!;
    const bad = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...f, result: { ...res, assignments: res.assignments.slice(1) } } } };
    const r = ready(reconcile(bad, exam));
    expect(r.checks.find((c) => c.id === 'M-2')!.light).toBe('fail');
    expect(r.checks.find((c) => c.id === 'M-2')!.issues[0]!.text).toMatch(/名冊 \d+ 人（其中應考 \d+）/);
  });
});

describe('M-2 以名冊總人數為準（會考）', () => {
  it('每個時段座位表與各教室加總＝名冊總人數', () => {
    const { doc, exam } = bcctDoc();
    const r = ready(reconcile(doc, exam));
    expect(r.checks.find((c) => c.id === 'M-2')!.light).toBe('pass');
    for (const row of r.ledger) { expect(row.seat).toBe(row.scope); expect(row.room).toBe(row.scope); }
  });
});

describe('M-2 以名冊總人數為準（分科，D158③、D159）', () => {
  const build = (extra = 0) => {
    const { doc, exam } = astDoc();
    // extra＞0：名冊多出沒報名的人（不參加者，每節自習）
    const more = Array.from({ length: extra }, (_, k) => ({ classNo: 1 + (k % 6), seatNo: 40 + k, name: `外加${k}` }));
    const d2 = { ...doc, rosters: { ...doc.rosters, senior: [...doc.rosters.senior, ...more] } };
    const plan = astPlan(d2, exam)!;
    return { doc: d2, exam, outs: astOutputs(d2, exam, plan, 'B4') };
  };

  it('每個時段：座位表＝各教室加總＝名冊總人數；標籤＝應考人數；M-2、M-6 通過', () => {
    const { doc, exam, outs } = build();
    const r = ready(reconcile(doc, exam, outs));
    expect(r.checks.find((c) => c.id === 'M-2')!.light).toBe('pass');
    expect(r.checks.find((c) => c.id === 'M-6')!.light).toBe('pass');
    for (const row of r.ledger) {
      expect(row.all).toBe(true);
      expect(row.seat).toBe(row.scope);
      expect(row.room).toBe(row.scope);
      expect(row.label).toBe(row.exam);
      expect(row.ok).toBe(true);
    }
    expect(r.ledger.some((x) => x.study > 0 && x.label < x.seat)).toBe(true);
  });

  it('名冊含不參加者：總人數是名冊全部，他們的自習座位也算進座位表與教室加總', () => {
    const { doc, exam, outs } = build(6);
    const r = ready(reconcile(doc, exam, outs));
    expect(r.scope.absent).toBe(6);
    expect(r.checks.find((c) => c.id === 'M-2')!.light).toBe('pass');
    for (const row of r.ledger) { expect(row.scope).toBe(78); expect(row.seat).toBe(78); expect(row.room).toBe(78); }
  });

  it('標籤檔少一張 → M-2、M-6 不通過；差異看標籤對應考人數', () => {
    const { doc, exam, outs } = build();
    const broken = { ...outs, label: outs.label.map((p, i) => (i === 0 ? { ...p, cells: p.cells.slice(1) } : p)) };
    const r = ready(reconcile(doc, exam, broken));
    const m2 = r.checks.find((c) => c.id === 'M-2')!;
    expect(m2.light).toBe('fail');
    expect(m2.issues[0]!.text).toMatch(/名冊 \d+ 人（其中應考 \d+）/);
    expect(r.checks.find((c) => c.id === 'M-6')!.light).toBe('fail');
  });
});
