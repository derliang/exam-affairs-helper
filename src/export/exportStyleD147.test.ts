/** 匯出樣式包（D147、DESIGN §10.33；Issue #390～#393、#395、#396、#408、#409）：七題裁示的文字與版面。全部匿名假資料。 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildLabelPages, buildSeatPages, cornerLayout, renderDocx, renderPrintHtml, statLayout } from './index';
import { dayRangeText, dayTag } from './dayLabel';
import { makeFixture } from './fixtures';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-19T08:30:00Z', dataVersion: 'A1B2C3D4' };
/** 與 batchA.test 同一招：把 fixture 的科目代碼換成節次表認得的 chinese／english／math，才有第幾天、時段 */
const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;

describe('④ 日期寫法（D147④）：不含年、沒有日期只寫第幾天', () => {
  it('dayTag／dayRangeText', () => {
    expect(dayTag(0)).toBe('第 1 天');
    expect(dayTag(0, '2026-11-17')).toBe('第 1 天 11/17（二）');
    expect(dayTag(1, '2026-11-18')).toBe('第 2 天 11/18（三）');
    expect(dayRangeText([0, 1], ['2026-11-17', '2026-11-18'])).toBe('第 1 天 11/17（二）～第 2 天 11/18（三）');
    expect(dayRangeText([1, 0, 1])).toBe('第 1 天～第 2 天');
    expect(dayRangeText([0])).toBe('第 1 天');
    expect(dayRangeText([])).toBe('');
    expect(dayTag(0, '')).not.toContain('（'); // 沒填日期不出現空括號
  });

  it('座位表與標籤標題都帶日期範圍（沒填日期＝第 1 天～第 2 天），Word 與列印頁都有', async () => {
    const f = real();
    const seat = buildSeatPages(f, 'class');
    const label = buildLabelPages(f, 'class');
    expect(seat[0]!.dateText).toBe('第 1 天～第 2 天');
    expect(label[0]!.dateText).toBe('第 1 天～第 2 天');
    expect(renderPrintHtml({ seat, label }, meta)).toContain('第 1 天～第 2 天');
    const x = await (await JSZip.loadAsync(await renderDocx({ seat }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(x).toContain('第 1 天～第 2 天');
  });
});

describe('①②③ 三種標示與頁首小標籤（D147①②③、#390 #393 #409）', () => {
  /** fixture 加兩筆：0105 英文加考且有抽離（到別處考）；0103 數學加考沒有抽離（原教室考） */
  const withAway = () => {
    const f = makeFixture();
    f.result.marks = [...f.result.marks, { code: '0105', subjectId: 'en', mode: 'extra' }];
    return f;
  };

  it('不考每一科都帶 X：多科寫「X 數　X 英」，不是只有一個 X', () => {
    const f = makeFixture();
    f.result.marks = [...f.result.marks, { code: '0102', subjectId: 'ma', mode: 'absent' }];
    const c = buildSeatPages(f, 'class')[0]!.cells.get('1-2')!;
    expect(c.corners).toEqual([{ kind: 'x', text: 'X 英　X 數' }]);
  });

  it('加考在原教室考＝「＋ 數」；到別處考＝「抽離 英文 考試」，兩種小牌不同、頁首小標籤分開算', () => {
    const p = buildSeatPages(withAway(), 'class')[0]!;
    expect(p.cells.get('1-3')!.corners).toEqual([{ kind: 'add', text: '＋ 數' }]);
    expect(p.cells.get('1-5')!.corners).toEqual([{ kind: 'detach', text: '抽離 英文 考試' }]);
    expect(p.chips.some((c) => c.startsWith('加考') && c.includes('數'))).toBe(true);
    expect(p.chips.some((c) => c.startsWith('抽離') && c.includes('英文') && c.includes('1 人'))).toBe(true);
    // 加考的人數不含抽離者
    expect(p.chips.filter((c) => c.startsWith('加考')).every((c) => !c.includes('英文'))).toBe(true);
  });

  it('標籤與列印頁同一份文字；字太多時抽離小牌分兩行（cornerLayout）', () => {
    const f = withAway();
    const lp = buildLabelPages(f, 'class')[0]!;
    expect(lp.cells.find((c) => c.code === '0105')!.corners).toEqual([{ kind: 'detach', text: '抽離 英文 考試' }]);
    const html = renderPrintHtml({ seat: buildSeatPages(f, 'class') }, meta);
    expect(html).toContain('抽離 英文 考試');
    const tag = { kind: 'detach' as const, text: '抽離 自然、數A 考試' };
    expect(cornerLayout([tag], 80, 8)).toEqual([[tag]]); // 寬格放得下：一行
    const two = cornerLayout([tag], 14, 8);
    expect(two).toHaveLength(2);
    expect(two[1]![0]!.text).toBe('考試');
    expect(two[0]![0]!.text).toBe('抽離 自然、數A');
  });
});

describe('⑤ 統計表（D147⑤、#391）：每個「天＋時段＋科目」一列，不合併', () => {
  it('列照天、時段、科目排，前導欄表頭與每列對得上，Word 也有逐列', async () => {
    const p = buildSeatPages(real(), 'class')[0]!;
    const t = p.stats.table;
    expect(t.leadHeads).toEqual(['第幾天', '時段', '科目']);
    const lead = t.rows.slice(1).map((r) => r.lead!);
    expect(lead.length).toBe(4); // 學測國文有兩個時段（國綜、國寫），各自一列；英文、數學各一列
    for (const l of lead) expect(l).toHaveLength(3);
    expect(lead.map((l) => l[0])).toEqual(expect.arrayContaining(['第 1 天']));
    expect(lead.map((l) => l[2])).toEqual(expect.arrayContaining(['國文', '英文', '數學']));
    const keys = lead.map((l) => `${l[0]}|${l[1]}`);
    expect([...keys].sort()).toEqual(keys); // 依天、時段排
    const x = await (await JSZip.loadAsync(await renderDocx({ seat: [p] }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    for (const l of lead) expect(x).toContain(`>${l[2]}<`);
    expect(x).toContain('總計');
    // 版面高度計入每一列
    expect(statLayout(p).rowH).toHaveLength(t.rows.length + 1);
    expect(statLayout(p).cols).toHaveLength(3 + t.classes.length + 1);
  });
});

describe('⑥ 預備教室標題：幾科各幾人（D147⑥、#395）', () => {
  it('小標籤逐「天＋時段＋科目」列人數，不再只寫「N 個時段」', () => {
    const f = real();
    const p = buildSeatPages(f, 'reserve').find((q) => q.slotMode)!;
    expect(p.chips[0]).toMatch(/^共 \d+ 人$/);
    expect(p.chips.some((c) => /個時段/.test(c))).toBe(false);
    const subj = p.chips.filter((c) => /^第 \d 天 時段.　.+ \d+ 人$/.test(c));
    expect(subj.length).toBeGreaterThan(0);
    expect(p.chips).toContain('抽離考試');
  });
});

describe('⑦ 自習座位（D147⑦、#396）：標題、小標籤、整份同一稱呼', () => {
  it('頁面標題、色塊、小標籤都寫「自習座位」，不再出現「參考座位」', async () => {
    const seat = buildSeatPages(real(), 'reserve');
    const p = seat.find((q) => q.roomName.includes('自習座位'))!;
    expect(p.title).toContain('自習座位');
    expect(p.chips[0]).toBe('自習座位，非考試座位');
    expect(p.dateText).toMatch(/^第 \d 天/);
    const html = renderPrintHtml({ seat }, meta);
    expect(html).toContain('自習座位，非考試座位');
    expect(html).not.toContain('參考座位');
    const x = await (await JSZip.loadAsync(await renderDocx({ seat }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(x).toContain('自習座位，非考試座位');
    expect(x).not.toContain('參考座位');
  });
});
