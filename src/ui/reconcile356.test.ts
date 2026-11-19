/**
 * #356 迴歸：學測第 4 次、270 人、系統建議的「標少數」標示（理組 X數B、X社會；文組 ＋數A、＋自然）。
 * 全部虛構假資料（假生、溫良恭儉勤誠班代號），不含任何真實學生資料。
 * 根因：對帳反查「學生屬哪一組」時用了全部班級（國中＋高中）建表，國中部同班號、沒有組別的班級蓋掉高中班的組別，
 * 「＋標考的」未標者（留班自習）查不到組別，被算成考試 → 總帳不平、M-2 紅燈擋下載。
 */
import { describe, expect, it } from 'vitest';
import type { Doc } from './store';
import { effectiveMarkRules, examResult } from './seating';
import { gateOf, reconcile, type Reconcile } from './reconcile';
import { gsat270Doc as gsat270 } from './reconcileFixtures';

const ready = (r: Reconcile) => { if (r.state !== 'ready') throw new Error(`state=${r.state}`); return r; };
const row = (r: Reconcile, subject: string) => ready(r).ledger.find((x) => x.subject === subject)!;
const light = (r: Reconcile, id: string) => ready(r).checks.find((c) => c.id === id)!.light;

describe('#356 ＋標考的科目：留班自習算自習，總帳平衡', () => {
  it('有國中部同班號班級時，系統建議標示的學測對帳全綠：自然 141＋129、數A 178＋92', () => {
    const { doc, exam } = gsat270({ junior: true });
    expect(effectiveMarkRules(doc, exam).rules.map((x) => `${x.track}/${x.subjectId}/${x.mode}`).sort()).toEqual(
      ['liberal/math-a/mark-extra', 'liberal/science/mark-extra', 'science/math-b/mark-absent', 'science/social/mark-absent']);
    const r = ready(reconcile(doc, exam));
    expect([row(r, '自然').exam, row(r, '自然').study, row(r, '自然').scope]).toEqual([141, 129, 270]);
    expect([row(r, '數學A').exam, row(r, '數學A').study, row(r, '數學A').scope]).toEqual([178, 92, 270]);
    for (const x of r.ledger) expect(x, x.subject).toMatchObject({ ok: true });
    expect(r.checks.map((c) => `${c.id}:${c.light}`).filter((x) => !x.endsWith(':pass') && !x.endsWith(':warn'))).toEqual([]);
    expect(light(r, 'M-2')).toBe('pass');
    expect(gateOf(r).fails).toBe(0);
  });

  it('沒有國中班時結果相同（修正不依賴班級排列順序）', () => {
    const j = gsat270({ junior: true });
    const a = ready(reconcile(j.doc, j.exam));
    const { doc, exam } = gsat270();
    const b = ready(reconcile(doc, exam));
    expect(b.ledger.map((x) => [x.subject, x.exam, x.study, x.ok])).toEqual(a.ledger.map((x) => [x.subject, x.exam, x.study, x.ok]));
  });

  it('某組全不考的科目（文組全不考數B，無標示）：留班的人算自習，帳平', () => {
    const { doc, exam } = gsat270({ junior: true, libMathB: 'none' });
    expect(effectiveMarkRules(doc, exam).rules.some((x) => x.track === 'liberal' && x.subjectId === 'math-b')).toBe(false);
    const r = ready(reconcile(doc, exam));
    expect([row(r, '數學B').exam, row(r, '數學B').study]).toEqual([128, 142]);
    for (const x of r.ledger) expect(x, x.subject).toMatchObject({ ok: true });
    expect(light(r, 'M-2')).toBe('pass');
  });

  it('真正不平仍要紅：＋自然 考的人被漏標（排座結果少一筆標示與抽離）→ 自然列不平、M-2 不通過', () => {
    const { doc, exam } = gsat270({ junior: true });
    const res = examResult(doc, exam)!;
    const lost = res.marks.find((m) => m.subjectId === 'science' && m.mode === 'extra')!;
    const bad: Doc = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...doc.examFiles![exam.id]!, result: {
      ...res, marks: res.marks.filter((m) => m !== lost), detaches: res.detaches.filter((d) => !(d.code === lost.code && d.subjectId === 'science')),
    } } } };
    const r = ready(reconcile(bad, exam));
    expect(row(r, '自然').ok).toBe(false);
    expect(light(r, 'M-2')).toBe('fail');
    expect(gateOf(r).fails).toBeGreaterThan(0);
  });

  it('真正不平仍要紅：X數B 的人被漏標（留在原班卻沒標）→ 數學B列不平、M-2 不通過', () => {
    const { doc, exam } = gsat270({ junior: true });
    const res = examResult(doc, exam)!;
    const lost = res.marks.find((m) => m.subjectId === 'math-b' && m.mode === 'absent')!;
    const bad: Doc = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...doc.examFiles![exam.id]!, result: {
      ...res, marks: res.marks.filter((m) => m !== lost), detaches: res.detaches.filter((d) => !(d.code === lost.code && d.subjectId === 'math-b')),
    } } } };
    const r = ready(reconcile(bad, exam));
    expect(row(r, '數學B').ok).toBe(false);
    expect(light(r, 'M-2')).toBe('fail');
  });
});
