import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import type { MakeupParseResult, MakeupProblem } from '../../core/makeup';
import { readXlsx, xlsxReadErrorText, XlsError } from '../../import';
import { MakeupWorkspace } from './pages/MakeupWorkspace';
import { importFileCount, mergeImport, replaceImport, rowWhere } from './importOps';
import { dashboardOf } from './dashboard';
import { fakeParse, fakeSession, NOW } from './testKit';

const noop = () => undefined;
/** 多一個「缺姓名」的問題列（學號用 id，避免與別檔重疊） */
const withProblem = (p: MakeupParseResult, id: string, srcRow: number): MakeupParseResult => {
  const base = p.rows[0]!;
  const draft = { ...base, studentId: id, name: '', srcRow, rowId: String(srcRow) };
  const prob: MakeupProblem = { rowId: draft.rowId, srcRow, kind: 'no-name', message: '缺姓名', cells: [], draft };
  return { ...p, rawCount: p.rawCount + 1, problems: [...p.problems, prob] };
};

describe('#564 .xlsx 壞檔訊息：中文白話，不外露英文原文與網址', () => {
  const bad = async (bytes: Uint8Array): Promise<unknown> => { try { await readXlsx(bytes); } catch (e) { return e; } return undefined; };
  it('不是 zip、空檔：固定中文句，沒有英文原文與網址', async () => {
    for (const bytes of [new TextEncoder().encode('這不是試算表'), new Uint8Array(0)]) {
      const e = await bad(bytes);
      expect(e).toBeDefined();
      const t = xlsxReadErrorText(e);
      expect(t).toContain('這個檔案打不開');
      expect(t).toContain('另存成 .xlsx');
      expect(t).not.toMatch(/https?:|zip|End of data|central directory/i);
    }
  });
  it('函式庫丟的英文例外一律換成中文；本來就是中文的 XlsError 照用', () => {
    expect(xlsxReadErrorText(new Error("Can't find end of central directory : see https://stuk.github.io/jszip/documentation/howto/read_zip.html"))).not.toMatch(/http|jszip/i);
    expect(xlsxReadErrorText('weird')).toContain('這個檔案打不開');
    expect(xlsxReadErrorText(new XlsError('這個檔案沒有可讀的工作表'))).toBe('這個檔案沒有可讀的工作表');
  });
});

describe('#566 補考多檔：問題列標檔名', () => {
  const a = withProblem(fakeParse(1), 'ZA001', 2);
  const b = withProblem(fakeParse(2, [{ oldClass: '高三溫', students: 4 }]), 'ZB001', 2);
  const s1 = replaceImport(fakeSession(), a, 'a檔.xlsx', NOW);
  const s2 = mergeImport(s1, b, 'b檔.xlsx', NOW);

  it('兩個檔各有「第 2 列」：問題列各自標檔名', () => {
    expect(importFileCount(s2.parse)).toBe(2);
    const html = renderToString(<MakeupWorkspace s={s2} step={2} onChange={noop} onStep={noop} onList={noop} />);
    expect(html).toContain('「a檔.xlsx」第 2 列');
    expect(html).toContain('「b檔.xlsx」第 2 列');
    const miss = dashboardOf(s2).missing.map((m) => m.text).join('\n');
    expect(miss).toContain('「a檔.xlsx」第 2 列');
    expect(miss).toContain('「b檔.xlsx」第 2 列');
  });
  it('只有一個檔、或舊存檔沒有檔名：維持「第 N 列」', () => {
    expect(importFileCount(s1.parse)).toBe(1);
    expect(rowWhere(s1.parse, { file: 'a檔.xlsx', srcRow: 2 })).toBe('第 2 列');
    const legacy = { ...s2, parse: { ...s2.parse!, rows: s2.parse!.rows.map(({ file: _f, ...r }) => r), problems: s2.parse!.problems.map((x) => ({ ...x, draft: (({ file: _g, ...r }) => r)(x.draft) })) } } as typeof s2;
    expect(importFileCount(legacy.parse)).toBe(0);
    expect(rowWhere(legacy.parse, { srcRow: 5 })).toBe('第 5 列');
    expect(renderToString(<MakeupWorkspace s={legacy} step={2} onChange={noop} onStep={noop} onList={noop} />)).not.toContain('「a檔.xlsx」');
  });
});

describe('#565 補考多檔「換檔案」文案與行為一致', () => {
  it('每個檔確認後就寫入名單（與按不按「換檔案」無關）', () => {
    const s1 = replaceImport(fakeSession(), fakeParse(1), 'a.xlsx', NOW);
    const s2 = mergeImport(s1, fakeParse(3, [{ oldClass: '高三溫', students: 3 }]), 'b.xlsx', NOW);
    expect(s2.parse!.rows.length).toBeGreaterThan(s1.parse!.rows.length);
  });
  it('多檔說明寫明只放棄尚未確認的檔、已確認的保留、可按復原；不再說「放棄整批」（模擬考 ② 是最後才一次寫入，維持「放棄整批」）', () => {
    const mk = readFileSync(new URL('./pages/MkStep2.tsx', import.meta.url), 'utf-8');
    expect(mk).toContain('按「換檔案」只放棄還沒確認的檔案，已確認的會保留');
    expect(mk).toContain('↶ 復原');
    expect(mk).not.toContain('會放棄整批');
    const ex = readFileSync(new URL('../pages/Step2.tsx', import.meta.url), 'utf-8');
    expect(ex).toContain('「取消匯入」會放棄整批');
  });
});
