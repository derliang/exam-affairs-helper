/** #381、#382（D149④、D153）：M-2 座位表與各教室加總＝名冊總人數（每人每時段一個去處），標籤＝應考人數（自習者不印標籤）。全部匿名假資料。 */
import { describe, expect, it } from 'vitest';
import { reconcile, ledgerWant, type Reconcile } from './reconcile';
import { bcctDoc, gsatDoc } from './reconcileFixtures';

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
