/** #623 #624 #628 #629 #637 #638：補考 ② 匯入（多工作表、欄位對應、造字區、略過原因、新檔標題）與設定頁不露代號 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { mapMakeupColumns, parseMakeupWorkbook, resolveMakeup } from '../../core/makeup';
import { MkStep1 } from './pages/MkStep1';
import { MkStep2, DupModal } from './pages/MkStep2';
import { identicalSheets, parseWithMapping, pickSheets, replaceImport, skipProblemsOfKind } from './importOps';
import { fakeSession, NOW } from './testKit';

const HEAD = ['學號', '班級名稱', '座號', '姓名', '科目名稱'];
const sheet = (name: string, ids: number[]) => ({ name, rows: [HEAD, ...ids.map((i) => [String(900000 + i), '高一溫', String(i), `測試${i}`, '數學'])] });

describe('#623 多工作表', () => {
  const sheets = [sheet('A', [1, 2, 3]), sheet('B', [1, 2, 3]), sheet('C', [2, 3, 4])];
  it('內容完全相同的工作表被偵測出來（只匯入一份）', () => {
    expect(identicalSheets(sheets)).toEqual([1]);
  });
  it('預設整本解析：跨表同學號同科會變成「重複」問題列', () => {
    const { picks, main } = pickSheets(sheets);
    const r = parseWithMapping(sheets, picks[main]!, picks[main]!.columns, picks[main]!.header);
    expect(r.problems.filter((p) => p.kind === 'dup').length).toBeGreaterThan(0);
  });
  it('使用者明確選一張工作表：只匯入那一張，沒有重複', () => {
    const { picks } = pickSheets(sheets);
    const r = parseWithMapping(sheets, picks[2]!, picks[2]!.columns, picks[2]!.header, true);
    expect(r.rawCount).toBe(3);
    expect(r.problems).toHaveLength(0);
  });
  it('「全部略過重複列」一次處理所有 dup，原因記「重複列」，對帳歸零', () => {
    const parse = parseMakeupWorkbook(sheets);
    const dups = parse.problems.filter((p) => p.kind === 'dup').length;
    expect(dups).toBeGreaterThan(1);
    const s0 = replaceImport(fakeSession(), parse, 'x.xlsx', NOW);
    const s1 = skipProblemsOfKind(s0, parse, 'dup', 'duplicate');
    const roster = resolveMakeup(parse, s1.resolutions);
    expect(roster.unresolved).toHaveLength(0);
    expect(roster.skipped).toHaveLength(dups);
    expect(roster.skipped.every((x) => x.reason === 'duplicate')).toBe(true);
  });
});

describe('#624 欄位對應', () => {
  it('「班級名稱」認成舊班；有明確「舊班」時優先用舊班', () => {
    expect(mapMakeupColumns(HEAD).oldClass).toBe(1);
    expect(mapMakeupColumns(['學號', '班級名稱', '舊班', '座號', '姓名', '科目名稱']).oldClass).toBe(2);
  });
});

describe('#628 造字區姓名警示', () => {
  it('名單含造字區字元時 ② 顯示警示與碼位', () => {
    const s = fakeSession();
    const parse = { ...s.parse!, rows: s.parse!.rows.map((r, i) => (i === 0 ? { ...r, name: `王\uE391明` } : r)) };
    const html = renderToString(<MkStep2 s={{ ...s, parse }} onChange={() => undefined} />);
    expect(html).toContain('姓名含造字區字元');
    expect(html).toContain('U+E391');
  });
  it('沒有造字區字元就不警示', () => {
    expect(renderToString(<MkStep2 s={fakeSession()} onChange={() => undefined} />)).not.toContain('造字區');
  });
});

describe('#629 不露內部代號', () => {
  it('① 與 ② 的畫面沒有暫定、U-n、O-n、C-12、106-1', () => {
    const s = fakeSession();
    for (const h of [renderToString(<MkStep1 s={s} onChange={() => undefined} />), renderToString(<MkStep2 s={s} onChange={() => undefined} />)]) {
      expect(h).not.toMatch(/暫定|\bU-\d|\bO-\d|C-12|C-1\b|F-12|106-1|D114/);
    }
  });
});

describe('#638 新檔標題', () => {
  const modal = (same: number, updated: number) => renderToString(<DupModal d={{ parse: { rawCount: 6 } as never, fileName: 'n.xlsx', diff: { hasCurrent: true, same, updated, added: 6, removed: 0, removedScheduled: 0 } as never }} onApply={() => {}} onClose={() => {}} />);
  it('與目前名單 0 列重複：不說「已經匯入過」', () => {
    expect(modal(0, 0)).not.toContain('已經匯入過');
  });
  it('有重複列：仍說已匯入過', () => {
    expect(modal(3, 0)).toContain('已經匯入過');
  });
});
