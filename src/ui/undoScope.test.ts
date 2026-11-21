import { describe, expect, it } from 'vitest';
import { commit, newHistory, canUndoIn, nextUndoLabelIn, undoIn, undoStepsIn, undoToIn, UNDO_LIMIT, type History } from './undo';
import { docScopes, sliceDoc, scopeOfPage, UNDO_SCOPES } from './undoScope';
import { emptyDoc } from './repository';
import type { Doc } from './store';
import type { Route } from './nav';

const mk = (id: string) => ({ id }) as unknown as NonNullable<Doc['makeups']>[number];
const exam = (doc: Doc, name: string): Doc => ({ ...doc, exams: [{ id: 'e1', name } as unknown as Doc['exams'][number]] });
const makeup = (doc: Doc, ...ids: string[]): Doc => ({ ...doc, makeups: ids.map(mk) });
const settings = (doc: Doc, v: number): Doc => ({ ...doc, settings: { ...doc.settings, ...({ marker: v } as object) } });
const apply = (h: History<Doc>, next: Doc, label: string): History<Doc> => commit(h, next, label, undefined, docScopes(h.present, next));
const un = (h: History<Doc>, sc: 'exam' | 'makeup' | 'settings') => undoIn(h, sc, sliceDoc, UNDO_SCOPES);

describe('#568 復原領域化', () => {
  it('docScopes：分辨模擬考、補考、共用設定；沒變回空', () => {
    const d = emptyDoc();
    expect(docScopes(d, d)).toEqual([]);
    expect(docScopes(d, exam(d, 'A'))).toEqual(['exam']);
    expect(docScopes(d, makeup(d, 'm1'))).toEqual(['makeup']);
    expect(docScopes(d, settings(d, 1))).toEqual(['settings']);
    expect(docScopes(d, settings(exam(d, 'A'), 1))).toEqual(['exam', 'settings']);
    expect(scopeOfPage('makeup')).toBe('makeup');
    expect(scopeOfPage('settings')).toBe('settings');
    expect(scopeOfPage('step')).toBe('exam');
  });

  it('補考操作後切到模擬考頁：復原鈕不顯示補考步驟，按復原不影響補考', () => {
    let h = newHistory(emptyDoc());
    h = apply(h, exam(h.present, 'A'), '修改考試');
    h = apply(h, makeup(h.present, 'm1'), '修改補考教室');
    expect(nextUndoLabelIn(h, 'exam')).toBe('修改考試');
    expect(undoStepsIn(h, 'exam').map((s) => s.label)).toEqual(['修改考試']);
    expect(nextUndoLabelIn(h, 'makeup')).toBe('修改補考教室');
    const n = un(h, 'exam');
    expect(n.present.makeups?.map((m) => m.id)).toEqual(['m1']);
    expect(n.present.exams).toEqual([]);
    expect(canUndoIn(n, 'exam')).toBe(false);
    expect(nextUndoLabelIn(n, 'makeup')).toBe('修改補考教室');
  });

  it('補考頁按復原只退補考，不動模擬考', () => {
    let h = newHistory(emptyDoc());
    h = apply(h, makeup(h.present, 'm1'), '新增補考');
    h = apply(h, exam(h.present, 'A'), '修改考試');
    const n = un(h, 'makeup');
    expect(n.present.makeups).toBeUndefined();
    expect(n.present.exams.map((e) => e.name)).toEqual(['A']);
  });

  it('抽掉中間一步後，快照式復原仍正確（交錯操作任意順序退）', () => {
    const base = emptyDoc();
    let h = newHistory(base);
    h = apply(h, exam(h.present, 'A'), 'exam1');
    h = apply(h, makeup(h.present, 'm1'), 'mk1');
    h = apply(h, exam(h.present, 'B'), 'exam2');
    h = apply(h, makeup(h.present, 'm1', 'm2'), 'mk2');
    const a = un(un(h, 'exam'), 'exam');
    expect(a.present.exams).toEqual([]);
    expect(a.present.makeups?.map((m) => m.id)).toEqual(['m1', 'm2']);
    const b = un(un(a, 'makeup'), 'makeup');
    expect(b.present).toEqual(base);
    expect(b.past).toEqual([]);
    // 先退補考再退模擬考
    const c = un(un(un(un(h, 'makeup'), 'exam'), 'makeup'), 'exam');
    expect(c.present).toEqual(base);
    // 退到一半，其餘領域維持原樣
    const d = un(h, 'makeup');
    expect(d.present.exams.map((e) => e.name)).toEqual(['B']);
    expect(d.present.makeups?.map((m) => m.id)).toEqual(['m1']);
  });

  it('回到更早的步驟：只還原該領域，標為過期的只算該領域的步驟', () => {
    let h = newHistory(emptyDoc());
    h = apply(h, exam(h.present, 'A'), 'exam1');
    h = apply(h, makeup(h.present, 'm1'), 'mk1');
    h = apply(h, exam(h.present, 'B'), 'exam2');
    const steps = undoStepsIn(h, 'exam');
    expect(steps.map((s) => s.label)).toEqual(['exam2', 'exam1']);
    const r = undoToIn(h, 'exam', steps[1]!.index, sliceDoc);
    expect(r.dropped).toEqual(['exam2', 'exam1']);
    expect(r.history.present.exams).toEqual([]);
    expect(r.history.present.makeups?.map((m) => m.id)).toEqual(['m1']);
    expect(undoStepsIn(r.history, 'makeup').map((s) => s.label)).toEqual(['mk1']);
    expect(undoToIn(h, 'exam', 1, sliceDoc).dropped).toEqual([]); // 1 是補考步驟，這個領域看不到
  });

  it('一步同時動到兩個領域：另一邊沒有更新的步驟就一起退；有就只退自己這邊', () => {
    const d0 = emptyDoc();
    let h = newHistory(d0);
    h = apply(h, settings(exam(h.present, 'A'), 1), '套用名單比對');
    const both = un(h, 'exam');
    expect(both.present).toEqual(d0);
    expect(both.past).toEqual([]);
    let g = apply(h, settings(g0(h), 2), '改設定');
    const only = un(g, 'exam');
    expect(only.present.exams).toEqual([]);
    expect((only.present.settings as unknown as { marker: number }).marker).toBe(2);
    expect(nextUndoLabelIn(only, 'settings')).toBe('改設定');
    const rest = un(un(only, 'settings'), 'settings');
    expect(rest.present).toEqual(d0);
    function g0(x: History<Doc>): Doc { return x.present; }
  });

  it('堆疊上限仍是 20 步（全領域合計）', () => {
    let h = newHistory(emptyDoc());
    for (let i = 0; i < 30; i++) h = apply(h, i % 2 ? makeup(h.present, `m${i}`) : exam(h.present, `n${i}`), `s${i}`);
    expect(h.past.length).toBe(UNDO_LIMIT);
    expect(h.past[0]!.label).toBe('s10');
  });

  it('舊式沒有領域的步驟（舊存檔或未標領域）：每個領域都看得到，按復原還原整份快照', () => {
    const d0 = emptyDoc();
    let h = newHistory(d0);
    h = commit(h, exam(d0, 'A'), '舊步驟');
    expect(nextUndoLabelIn(h, 'makeup')).toBe('舊步驟');
    const n = un(h, 'settings');
    expect(n.present).toEqual(d0);
    expect(n.past).toEqual([]);
    expect(commit(newHistory(d0), d0, 'x').past).toEqual([]); // 沒變不記一步
  });
});

describe('#583 scopeOfPage：每個補考頁面都對到 makeup，其餘不受影響', () => {
  const MAKEUP_PAGES = ['makeup', 'makeupNew', 'makeupStep'] satisfies Route['page'][];
  const OTHER_PAGES = ['init', 'exams', 'new', 'wizard', 'copyright', 'privacy', 'lookup', 'step', 'reconcile', 'override', 'reserve'] satisfies Route['page'][];
  it('補考列表、新增場次、場次工作區都是 makeup', () => {
    for (const p of MAKEUP_PAGES) expect(scopeOfPage(p)).toBe('makeup');
  });
  it('窮舉：Route 的每個 page 不是在補考清單就是在其他清單（新增補考頁面時這裡會提醒）', () => {
    const all: Route['page'][] = ['settings', ...MAKEUP_PAGES, ...OTHER_PAGES];
    const probe: Record<Route['page'], true> = { init: true, exams: true, new: true, wizard: true, copyright: true, privacy: true, lookup: true, settings: true, step: true, reconcile: true, override: true, reserve: true, makeup: true, makeupNew: true, makeupStep: true };
    expect(new Set(all)).toEqual(new Set(Object.keys(probe)));
  });
  it('反向：模擬考各頁是 exam、共用設定是 settings（模擬考頁看不到補考步驟）', () => {
    for (const p of OTHER_PAGES) expect(scopeOfPage(p)).toBe('exam');
    expect(scopeOfPage('settings')).toBe('settings');
    let h = newHistory(emptyDoc());
    h = apply(h, makeup(h.present, 'm1'), '修改補考教室');
    h = apply(h, exam(h.present, 'A'), '改模擬考');
    expect(nextUndoLabelIn(h, scopeOfPage('makeupStep'))).toBe('修改補考教室');
    expect(nextUndoLabelIn(h, scopeOfPage('step'))).toBe('改模擬考');
    expect(un(h, scopeOfPage('makeupStep')).present.exams).toEqual(h.present.exams);
  });
});
