import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { makeFixture } from './fixtures';
import { defaultOptions, planFiles, preflight, runExport, safeName } from './plan';

const fd = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fd))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fd))),
};
const chars = new Set(readFileSync(new URL('NotoSansTC-Regular-big5.chars.txt', fd), 'utf8'));
const has = (ch: string) => chars.has(ch);

describe('匯出規劃', () => {
  it('G34 全勾：座位表一個檔、標籤一個檔（預備教室併在最後）、抽離自習名單獨立（預設不勾）', () => {
    expect(defaultOptions().study).toBe(false);
    const files = planFiles(makeFixture(), { ...defaultOptions('B4'), study: true });
    expect(files.map((f) => f.key)).toEqual(['seat', 'label', 'study']);
    expect(files.map((f) => f.pages)).toEqual([4, 3, 1]); // 座位表：2 間班級教室＋1 間預備教室＋1 頁自習參考座位（G32）；標籤沒有參考座位
    expect(files[0]!.name).toBe('測試模擬考-座位表.docx');
    expect(files[1]!.name).toBe('測試模擬考-標籤（B4）.docx');
  });

  it('取消勾選就不產生；不含預備教室時兩個檔都只有班級教室', () => {
    expect(planFiles(makeFixture(), { ...defaultOptions('A3'), seat: false, label: false, study: false })).toEqual([]);
    const f = planFiles(makeFixture(), { ...defaultOptions('A3'), reserve: false });
    expect(f.map((x) => x.pages)).toEqual([2, 2]);
  });

  it('G34：預備教室頁排在最後、頁首標「預備教室」（Word 與列印頁都一樣）', async () => {
    const out = await runExport(makeFixture(), { ...defaultOptions('B4') }, { fonts });
    expect(out.map((f) => f.name.split('-')[1])).toEqual(['座位表.docx', '標籤（B4）.docx']);
    for (const f of out) {
      const z = await JSZip.loadAsync(f.data as Uint8Array);
      const doc = await z.file('word/document.xml')!.async('string');
      const at = doc.indexOf('預備教室');
      expect(at).toBeGreaterThan(0);
      expect(doc.lastIndexOf('預備教室')).toBeGreaterThan(doc.length * 0.5); // 在檔案後半
    }
    const pdf = await runExport(makeFixture(), { ...defaultOptions('B4'), format: 'pdf' }, { fonts });
    const html = pdf[0]!.data as string;
    expect(html.match(/<span class="pp-room"[^>]*>預備教室/g)!.length).toBe(3); // 座位表 2 頁（預備教室考試、自習參考座位）、標籤 1 頁
  });

  it('A3、B4 都是 7×7：標籤檔欄寬＝紙寬÷7，欄數＝教室排數', async () => {
    const a3 = await runExport(makeFixture(), { ...defaultOptions('A3'), seat: false, study: false, reserve: false }, { fonts });
    expect(a3).toHaveLength(1);
    const z = await JSZip.loadAsync(a3[0]!.data as Uint8Array);
    const doc = await z.file('word/document.xml')!.async('string');
    expect(doc).toContain('w:w="' + Math.floor(((297 - 21) / 7 * 1440) / 25.4) + '"');
    // 每頁有抬頭表（2 欄）、格子表（教室 4 排＝4 欄）、注意事項框（1 欄）；格子表 2 頁
    const grids = [...doc.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/<w:gridCol /g)].length);
    expect(grids.filter((n) => n === 4)).toHaveLength(2);
  });

  it('Word：每類一個 .docx，內含字型與頁尾版本碼', { timeout: 30000 }, async () => {
    const out = await runExport(makeFixture(), { ...defaultOptions('B4'), study: true }, { fonts });
    expect(out.map((f) => f.name.split('-')[1])).toEqual(['座位表.docx', '標籤（B4）.docx', '抽離自習名單.docx']);
    for (const f of out) {
      const z = await JSZip.loadAsync(f.data as Uint8Array);
      expect(Object.keys(z.files).filter((n) => n.startsWith('word/fonts/'))).toHaveLength(2);
      const footer = await Promise.all(Object.keys(z.files).filter((n) => /footer\d+\.xml$/.test(n)).map((n) => z.file(n)!.async('string')));
      expect(footer.join('')).toContain('A1B2C3D4');
    }
  });

  it('PDF：所有內容合併成一個列印用頁面，含各種紙張', async () => {
    const out = await runExport(makeFixture(), { ...defaultOptions('A3'), format: 'pdf' }, { fonts });
    expect(out).toHaveLength(1);
    const html = out[0]!.data as string;
    expect(out[0]!.name).toBe('測試模擬考-列印用頁面.html');
    expect(html).toContain('page:a3');
    expect(html).toContain('page:a4');
  });

  it('檔名安全', () => expect(safeName('a/b:c?')).toBe('a_b_c_'));
});

describe('匯出前檢查', () => {
  const ok = { stale: false, unresolvedDiffs: 0 };
  it('通過時沒有問題', () => expect(preflight(makeFixture(), defaultOptions(), ok, has)).toEqual([]));

  it('過期與未處理差異會擋下', () => {
    const i = preflight(makeFixture(), defaultOptions(), { stale: true, unresolvedDiffs: 3 }, has);
    expect(i.filter((x) => x.level === 'block')).toHaveLength(2);
    expect(i[1]!.text).toContain('3 筆');
  });

  it('#242：差異選好但還沒按「套用」要擋下並說要先套用；套用後（0 筆）與無差異可下載', () => {
    const pending = preflight(makeFixture(), defaultOptions(), { stale: false, unresolvedDiffs: 0, unappliedDiffs: 134 }, has);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.level).toBe('block');
    expect(pending[0]!.text).toContain('套用 134 筆核對結果');
    expect(pending[0]!.text).toContain('② ');
    expect(preflight(makeFixture(), defaultOptions(), { stale: false, unresolvedDiffs: 0, unappliedDiffs: 0 }, has)).toEqual([]);
    expect(preflight(makeFixture(), defaultOptions(), ok, has)).toEqual([]);
    // 還有沒選的：只顯示沒選的那句，不疊兩句
    const mixed = preflight(makeFixture(), defaultOptions(), { stale: false, unresolvedDiffs: 2, unappliedDiffs: 5 }, has);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.text).toContain('2 筆');
  });

  it('什麼都沒勾會擋下', () => {
    const i = preflight(makeFixture(), { ...defaultOptions(), seat: false, label: false, study: false, reserve: false }, ok, has);
    expect(i[0]!.text).toContain('至少勾選');
  });

  it.skip('（#210 已改自動分張，不再擋）標籤格數不夠會擋下並說明', () => {
    const f = makeFixture();
    f.settings.classrooms[0]!.rows = 8; // 不影響；改用結果塞滿
    for (let i = 0; i < 60; i++) f.result.assignments.push({ classroomId: 'r1', row: 9 + Math.floor(i / 5), depth: (i % 5) + 1, code: '0101' });
    const issues = preflight(f, defaultOptions('A3'), ok, has);
    expect(issues.some((x) => x.level === 'block' && x.text.includes('超過標籤'))).toBe(true);
  });

  it('字集外罕用字只警告（Word），訊息有編號、沒有姓名', () => {
    const f = makeFixture();
    f.students[0]!.name = '甲\u{2A6A5}';
    const i = preflight(f, defaultOptions(), ok, has);
    expect(i).toHaveLength(1);
    expect(i[0]!.level).toBe('warn');
    expect(i[0]!.text).toContain('0101');
    expect(i[0]!.text).not.toContain('甲');
    expect(preflight(f, { ...defaultOptions(), format: 'pdf' }, ok, has)).toEqual([]);
  });
});

describe('字型警示：造字區字元改寫碼位（#298）', () => {
  it('警示寫碼位與班級座號，引號內不放造字區字元', () => {
    const f = makeFixture();
    f.students[0]!.name = '甲';
    const i = preflight(f, defaultOptions(), { stale: false, unresolvedDiffs: 0 }, (ch) => !/[-]/.test(ch));
    expect(i[0]!.text).toContain('0101 的造字區碼位 U+E391');
    expect(i[0]!.text).not.toContain('');
  });
});
