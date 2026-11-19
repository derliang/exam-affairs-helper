/**
 * D146（使用者 2026-11-19）：「未參加」「全科缺考」一律叫「不參加」、合併成一個人數；名單比對不再有另一張卡；
 * 原班座位表的不參加者只標一個「X 不參加」。全部假資料。
 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { buildSeatPages } from '../export/model';
import { gsat270Doc } from './reconcileFixtures';
import { prepareExport } from './exportInput';
import { Step2 } from './pages/Step2';
import { chartModel, examResult, examRooms } from './seating';

const noop = () => undefined;

describe('D146 不參加', () => {
  const { doc, exam } = gsat270Doc({ fullyAbsent: 2, notJoined: 2, reserve2: true });

  it('② 只顯示一個「不參加」人數，不再出現「全科缺考」「未參加」', () => {
    const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
    expect(html).not.toMatch(/全科缺考|未參加/);
    const m = /考生 (\d+) 人，不參加 (\d+) 人/.exec(html);
    expect(m).not.toBeNull();
    expect(Number(m![1]) + Number(m![2])).toBe(270);
    expect(html).toContain(`不參加 ${m![2]} 人：每節都是自習生`);
  });

  it('原班座位表：一科都沒報的人只有一個「X 不參加」角標，頁首有「不參加 N 人」', () => {
    const p = prepareExport(doc, exam);
    if (!p.ok) throw new Error(p.errors.join());
    const noSub = new Set(p.input.entries.filter((e) => e.subjectIds.length === 0).map((e) => `${String(e.classNo).padStart(2, '0')}${String(e.seatNo).padStart(2, '0')}`));
    expect(noSub.size).toBeGreaterThan(0);
    let seen = 0;
    for (const pg of buildSeatPages(p.input, 'class')) {
      const here = [...pg.cells.values()].filter((c) => noSub.has(c.code));
      for (const c of here) {
        expect(c.corners).toEqual([{ kind: 'x', text: 'X 不參加' }]);
        expect(c.tags.map((t) => t.text)).toEqual(['X 不參加']);
        seen++;
      }
      if (here.length) expect(pg.chips).toContain(`不參加 ${here.length} 人`);
    }
    expect(seen).toBe(noSub.size);
  });

  it('⑤ 預覽：不參加的人標「X 不參加」', () => {
    const result = examResult(doc, exam)!;
    const marks = examRooms(doc, exam).flatMap((r) => chartModel(doc, exam, result, r).lines.flat()).filter((c) => c.kind === 'student' && c.marks.includes('X 不參加'));
    expect(marks.length).toBeGreaterThan(0);
  });
});
