import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { RosterIO } from './pages/RosterIO';
import { FileResults, ConflictList } from './pages/FileResults';
import { demoDoc } from './repository';

describe('#506 多檔匯入畫面', () => {
  it('學生名單匯入的檔案選取框支援多選', () => {
    const html = renderToString(<RosterIO doc={demoDoc()} division="senior" onChange={() => {}} />);
    expect(html).toMatch(/type="file"[^>]*multiple/);
  });
  it('各檔讀取結果：壞檔明講檔名與原因、其他檔照常；單檔成功時不多顯示', () => {
    const html = renderToString(<FileResults results={[{ name: 'a.xlsx', ok: true, value: 1 }, { name: 'bad.xlsx', ok: false, error: '不是 xlsx' }]} />);
    expect(html).toContain('「bad.xlsx」讀不進來');
    expect(html).toContain('不是 xlsx');
    expect(html).toContain('已讀取 1 個檔案');
    expect(renderToString(<FileResults hideSingleOk results={[{ name: 'a.xlsx', ok: true, value: 1 }]} />)).not.toContain('已讀取');
  });
  it('跨檔衝突清單：不預設任何選項，標示還沒決定', () => {
    const c = [{ key: '1-2', candidates: [{ file: 'A', item: '乙', seq: 0 }, { file: 'B', item: '乙乙', seq: 1 }] }];
    const html = renderToString(<ConflictList conflicts={c} choices={{}} onChoose={() => {}} describe={(x) => x} titleOf={(k) => k} />);
    expect(html).toContain('還沒決定');
    expect(html).toContain('保留「A」的：乙');
    expect(html).toContain('都不匯入');
    expect(html).not.toContain('aria-pressed="true"');
  });
});
