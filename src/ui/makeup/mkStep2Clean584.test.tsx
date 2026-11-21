import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import type { MakeupParseResult, MakeupProblem } from '../../core/makeup';
import { MakeupWorkspace } from './pages/MakeupWorkspace';
import { replaceImport } from './importOps';
import { fakeParse, fakeSession, NOW } from './testKit';

const noop = () => undefined;
const withProblems = (p: MakeupParseResult, n: number): MakeupParseResult => {
  const base = p.rows[0]!;
  const probs: MakeupProblem[] = Array.from({ length: n }, (_, i) => {
    const draft = { ...base, studentId: `ZP00${i}`, name: '', srcRow: 2 + i, rowId: String(2 + i) };
    return { rowId: draft.rowId, srcRow: draft.srcRow, kind: 'no-name', message: '缺姓名', cells: [], draft } as MakeupProblem;
  });
  return { ...p, rawCount: p.rawCount + n, problems: [...p.problems, ...probs] };
};
const html = (p: MakeupParseResult) => renderToString(<MakeupWorkspace s={replaceImport(fakeSession(), p, 'x.xlsx', NOW)} step={2} onChange={noop} onStep={noop} onList={noop} />);

describe('#584 補考②檔案卡：有問題列就不寫「無異常」', () => {
  it('沒有警告、沒有問題列：寫「無異常」', () => {
    expect(html(fakeParse(1))).toContain('・無異常');
  });
  it('有 2 筆問題列：不寫「無異常」，改寫「2 筆問題列待處理」', () => {
    const h = html(withProblems(fakeParse(1), 2));
    expect(h).not.toContain('無異常');
    expect(h).toContain('2 筆問題列待處理');
  });
});
