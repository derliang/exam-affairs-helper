import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { makeFixture } from './fixtures';
import {
  buildDetachList,
  buildLabelPages,
  labelGrid,
  buildSeatPages,
  findMissingChars,
  footerText,
  labelCellMm,
  LABEL_PAGE_FIXED_MM,
  labelFit,
  defaultLabelLayout,
  wideLabelLayout,
  roomTooBigForLabel,
  mmToTwip,
  renderDocx,
  renderPrintHtml,
  FONT,
  FONT_BOLD,
} from './index';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const charset = new Set(readFileSync(new URL('NotoSansTC-Regular-big5.chars.txt', fontDir), 'utf8'));
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };

async function unzip(buf: Uint8Array) {
  const z = await JSZip.loadAsync(buf);
  const text = async (n: string) => z.file(n)!.async('string');
  return { z, text };
}

describe('頁尾（D66）', () => {
  it('台北時間＋資料版本碼', () => {
    expect(footerText('2026-11-08T08:30:00Z', 'A1B2C3D4')).toBe('產生時間：2026-11-08 16:30（台北）　資料版本碼：A1B2C3D4');
  });
});

describe('版面模型', () => {
  it('座位表：每間班級教室一頁，預備教室一間一頁（時段版，稿 v2.28）', () => {
    const pages = buildSeatPages(makeFixture());
    // G32：預備教室考試頁（時段版）之後多一頁抽離自習「參考座位」
    expect(pages.map((p) => !!p.slotMode)).toEqual([false, false, true, false]);
    expect(pages[3]!.title).toContain("自習座位");
    expect(pages[0]!.cells.get('1-1')!.code).toBe('0101');
    expect(pages[2]!.title).toContain('座位表（時段版）');
    expect(pages[2]!.cells.size).toBe(2);
    // 格內每行一個時段（科目＋班座號），只含抽離考試
    const lines = [...pages[2]!.cells.values()].flatMap((c) => c.periodLines ?? []);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.text.includes('英文'))).toBe(true);
  });

  it('統計依該教室計算（D40）', () => {
    const [p1, p2] = buildSeatPages(makeFixture());
    expect(p1!.stats.total).toBe(18);
    expect(p1!.stats.perClass).toEqual([
      { className: '溫', count: 10 },
      { className: '良', count: 8 },
    ]);
    // 使用核心 roomStats：英文有 2 人抽離到預備教室，本教室實際考 16 人
    expect(p1!.stats.perSubject.map((s) => s.count)).toEqual([18, 16, 18]);
    expect(p2!.stats.total).toBe(12);
  });

  it('空位只在最後（D72）：可用座位集合是連續前段', () => {
    const p = buildSeatPages(makeFixture())[0]!;
    expect(p.usable.size).toBe(18);
    expect(p.usable.has('4-3')).toBe(true);
    expect(p.usable.has('4-4')).toBe(false);
  });

  it('個別標示帶文字（D39）', () => {
    const p = buildSeatPages(makeFixture())[0]!;
    expect(p.cells.get('1-2')!.tags[0]).toEqual({ kind: 'absent', text: 'X 不考英文' });
    expect(p.cells.get('1-3')!.tags[0]).toEqual({ kind: 'extra', text: '＋ 加考數學' });
  });

  it('標籤格大小（D113）：每格＝紙寬÷7、紙高÷7，B4 約 32.7×50.4、A3 約 39.4×60.0；滿 7 列要讓出標題頁尾', () => {
    const b4 = labelCellMm({ paper: 'B4', cols: 7, rows: 7 }, 5);
    expect(b4.w).toBeCloseTo((250 - 21) / 7, 5); // D136：左右頁面邊界各 10.5mm（含框線補償 0.5）
    expect(b4.h).toBeCloseTo(353 / 7, 5);
    const a3 = labelCellMm({ paper: 'A3', cols: 7, rows: 7 }, 5);
    expect(a3.w).toBeCloseTo((297 - 21) / 7, 5);
    expect(a3.h).toBeCloseTo(420 / 7, 5);
    expect(labelCellMm({ paper: 'A3', cols: 7, rows: 7 }, 7).h).toBeCloseTo((420 - LABEL_PAGE_FIXED_MM) / 7, 5);
    const pages = buildLabelPages(makeFixture(), 'class');
    expect(pages).toHaveLength(2);
    expect(pages[0]!.grid).toEqual({ cols: 4, rows: 5 }); // 甲教室 4 排×5 深位，格子排列同座位表
    expect(pages[0]!.cells.slice(0, 3).map((c) => c.coord)).toEqual(['1-1', '1-2', '1-3']);
    expect(pages[0]!.cells).toHaveLength(18);
  });

  it('標籤位置與座位表相同（D14、D38）：欄＝排，列＝深位，深位 1 在最下面，0101 在左下角，沒座位的位置不印格子', () => {
    const pages = buildLabelPages(makeFixture(), 'class');
    const g = labelGrid(pages[0]!); // 甲教室：4 排×5 深位，18 個座位（排 1～3 滿 5 個，排 4 只有 3 個）
    expect(g).toHaveLength(20);
    const at = (col: number, rowFromTop: number) => g[rowFromTop * 4 + col];
    expect(at(0, 4)?.code).toBe('0101'); // 最下列、最左欄
    expect(at(0, 0)?.code).toBe('0105'); // 排 1 深位 5：最上列
    expect(at(1, 4)?.coord).toBe('2-1'); // 第 2 排從左邊第 2 欄開始
    expect(at(3, 1)).toBeUndefined(); // 排 4 只有深位 1～3
    expect(at(3, 2)?.coord).toBe('4-3');
    expect(g.filter(Boolean)).toHaveLength(18);
  });

  it('標籤預設（D113）：B4、A3 都是 7×7；整合標籤 2 格寬（3 張×7 列）', () => {
    expect(defaultLabelLayout('A3')).toEqual({ paper: 'A3', cols: 7, rows: 7 });
    expect(defaultLabelLayout('B4')).toEqual({ paper: 'B4', cols: 7, rows: 7 });
    expect(wideLabelLayout('B4')).toEqual({ paper: 'B4', cols: 6, rows: 7, wide: true });
  });

  it('標籤：沒人坐的位置不印格子（空位不印）；橫排或深位超過 8 的教室停用標籤輸出（D113、D154）', () => {
    const f = makeFixture();
    const pages = buildLabelPages(f, 'class');
    expect(pages.map((p) => p.cells.length)).toEqual([18, 12]); // 只印有考生的座位
    f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 9, depth: 5, seatCount: 45 };
    const after = buildLabelPages(f, 'class');
    expect(after.map((p) => p.roomName)).toEqual(['乙教室']); // 甲教室 9 排，超過 8，不輸出
    expect(roomTooBigForLabel({ rows: 7, depth: 7 })).toBe(false);
    expect(roomTooBigForLabel({ rows: 3, depth: 8 })).toBe(false);
    expect(roomTooBigForLabel({ rows: 3, depth: 9 })).toBe(true);
  });

  it('抽離名單：抽離考試／自習／單人特例都列', () => {
    const l = buildDetachList(makeFixture());
    expect(l.rows).toHaveLength(4);
    expect(l.rows.map((r) => r.purpose).sort()).toEqual(['單人考試', '抽離自習', '抽離考試', '抽離考試'].sort());
    expect(l.rows.find((r) => r.code === '0105')!.place).toBe('預備教室 1-1');
  });

  it('字集外罕用字：回報班級＋座號＋字元，不含姓名', () => {
    const f = makeFixture();
    f.students[0]!.name = '甲\u{2A6A5}';
    const miss = findMissingChars(f, (ch) => charset.has(ch));
    expect(miss).toEqual([{ classNo: 1, seatNo: 1, ch: '\u{2A6A5}' }]);
  });
});

describe('Word 輸出（D44/D45）', () => {
  it('內嵌字型、A4 座位表、頁尾版本碼', async () => {
    const f = makeFixture();
    const buf = await renderDocx({ seat: buildSeatPages(f) }, { fonts, ...meta });
    const { z, text } = await unzip(buf);
    expect(Object.keys(z.files).filter((n) => n.startsWith('word/fonts/'))).toHaveLength(2);
    expect(await text('word/settings.xml')).toContain('embedTrueTypeFonts');
    const ft = await text('word/fontTable.xml');
    expect(ft).toContain(`w:name="${FONT}"`);
    expect(ft).toContain('<w:embedBold ');
    expect(ft).not.toContain(FONT_BOLD);
    const doc = await text('word/document.xml');
    expect([...doc.matchAll(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/g)].map((m) => [m[1], m[2]])).toEqual(
      Array(4).fill([String(mmToTwip(210)), String(mmToTwip(297))]),
    );
    expect(doc).toContain('第4排');
    expect(doc).toContain('0101');
    expect(doc).toContain('本教室考生人數');
    expect(doc).toContain('<w:b/>');
    const footers = await Promise.all(Object.keys(z.files).filter((n) => /word\/footer\d+\.xml/.test(n)).map((n) => text(n)));
    expect(footers.length).toBeGreaterThan(0);
    for (const x of footers) expect(x).toContain('資料版本碼：A1B2C3D4');
  });

  it('字型位元組還原後與原檔相同（混淆正確）', async () => {
    const buf = await renderDocx({ seat: buildSeatPages(makeFixture()) }, { fonts, ...meta });
    const { z, text } = await unzip(buf);
    const keys = [...(await text('word/fontTable.xml')).matchAll(/fontKey="\{([^}]+)\}"/g)].map((m) => m[1]!);
    const d = Buffer.from(await z.file('word/fonts/font1.odttf')!.async('nodebuffer'));
    const k = Buffer.from(keys[0]!.replace(/-/g, ''), 'hex').reverse();
    for (let j = 0; j < 32; j++) d[j]! ^= k[j % 16]!;
    expect(d.equals(Buffer.from(fonts.regular))).toBe(true);
  });

  it('標籤：B4／A3 紙張、欄寬＝紙寬÷7、欄數＝排數、列數＝深位數（D113）', async () => {
    for (const paper of ['B4', 'A3'] as const) {
      const f = makeFixture({ paper });
      const W = paper === 'B4' ? 250 : 297;
      const H = paper === 'B4' ? 353 : 420;
      const buf = await renderDocx({ label: buildLabelPages(f, 'class') }, { fonts, ...meta });
      const doc = await (await unzip(buf)).text('word/document.xml');
      const pg = [...doc.matchAll(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(pg).toEqual(Array(2).fill([mmToTwip(W), mmToTwip(H)]));
      // 格子表欄數＝教室排數 4（每頁一個）
      const grids = [...doc.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/w:w="(\d+)"/g)].map((x) => Number(x[1]))).filter((w) => w.length === 4);
      expect(grids).toHaveLength(2);
      expect(new Set(grids[0]!).size).toBe(1);
      expect(grids[0]![0]!).toBe(Math.floor(((W - 21) / 7 * 1440) / 25.4));
      const heights = [...doc.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1]));
      expect(heights).toHaveLength(5 * 2); // 5 個深位 × 2 間教室
      expect(new Set(heights)).toEqual(new Set([mmToTwip(H / 7)]));
    }
  });

  it('A3 滿 7 排×7 深位：欄寬＝紙寬÷7，列高扣掉標題頁尾仍整頁放得下（D113）', async () => {
    const f = makeFixture({ paper: 'A3' });
    f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth: 7, seatCount: 49 };
    const doc = await (await unzip(await renderDocx({ label: buildLabelPages(f, 'class') }, { fonts, ...meta }))).text('word/document.xml');
    const widths = [...doc.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/w:w="(\d+)"/g)].map((x) => Number(x[1]))).find((w) => w.length === 7)!;
    expect(widths).toEqual(Array(7).fill(Math.floor(((297 - 21) / 7 * 1440) / 25.4)));
    const heights = [...doc.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1]));
    expect(heights.slice(0, 7)).toEqual(Array(7).fill(mmToTwip(labelFit({ paper: 'A3', cols: 7, rows: 7 }, 7, 3).h)));
  });

  it('備案 separate-family：Bold 是獨立家族，粗體字用該家族', async () => {
    const buf = await renderDocx({ seat: buildSeatPages(makeFixture()) }, { fonts, ...meta, boldMode: 'separate-family' });
    const { text } = await unzip(buf);
    const ft = await text('word/fontTable.xml');
    expect(ft).toContain(`w:name="${FONT_BOLD}"`);
    expect(ft).not.toContain('<w:embedBold ');
    expect(await text('word/document.xml')).toContain(`w:ascii="${FONT_BOLD}"`);
  });

  it('抽離名單合併成一個檔，表頭重複', async () => {
    const buf = await renderDocx({ list: buildDetachList(makeFixture()) }, { fonts, ...meta });
    const doc = await (await unzip(buf)).text('word/document.xml');
    expect(doc).toContain('<w:tblHeader');
    expect(doc).toContain('教務處');
  });

  it('沒有頁面時丟錯', async () => {
    await expect(renderDocx({}, { fonts, ...meta })).rejects.toThrow();
  });
});

describe('PDF 列印 HTML（D29）', () => {
  it('具名紙張、頁尾版本碼、脫逸', () => {
    const f = makeFixture();
    f.students[0]!.name = '<b>&';
    const html = renderPrintHtml(
      { seat: buildSeatPages(f), label: buildLabelPages(f), list: buildDetachList(f) },
      meta,
    );
    expect(html).toContain('@page a4');
    expect(html).toContain('size: 250mm 353mm');
    expect(html).toContain('page:b4');
    expect(html).toContain('資料版本碼：A1B2C3D4');
    expect(html).toContain('&lt;b&gt;&amp;');
    expect(html).not.toContain('<b>&');
  });
});

describe('PDF 列印 HTML：照稿件版面（設計系統成品頁「座位表與標籤」）', () => {
  const html = (o: Parameters<typeof makeFixture>[0] = {}, kind: 'seat' | 'label' = 'seat') => {
    const f = makeFixture(o);
    return renderPrintHtml(kind === 'seat' ? { seat: buildSeatPages(f, 'class') } : { label: buildLabelPages(f, 'class') }, meta);
  };

  it('座位表：A4 滿版頁（邊界自己留）、頁首、小標籤、講臺、統計表、頁尾', () => {
    const h = html();
    expect(h).toContain('page:a4full');
    expect(h).toContain('<div class="pp-h2">座位表</div>');
    expect(h).toContain('不考英文 1 人');
    expect(h).toContain('加考數學 1 人');
    expect(h).toContain('講臺');
    expect(h).toContain('<table class="pp-st">');
    expect(h).toContain('資料版本碼：A1B2C3D4');
  });

  it('座位表：深位 1 在最下列、沒人的位置畫斜線底、特殊考生改右下角單字角標（不再加粗框）', () => {
    const h = html();
    expect(h.indexOf('>0105<')).toBeGreaterThan(-1);
    expect(h).toContain('pp-e'); // 空位
    expect(h).not.toContain('pp-c mk'); // v2.36：拿掉整格粗框
    expect(h).toContain('class="pp-cn"');
    expect(h).toContain('<span class="pp-mk x">X 英</span>');
    expect(h).toContain('<span class="pp-mk add">＋ 數</span>');
    expect(h).not.toContain('X 英文'); // 也沒有整句小牌
  });

  it('統計表（D147⑤）：不合併科目，每個「第幾天＋時段＋科目」一列', () => {
    const f = makeFixture();
    const p = buildSeatPages(f, 'class')[0]!;
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(p.stats.table.leadHeads).toEqual(['第幾天', '時段', '科目']);
    expect(p.stats.table.rows[0]!.label).toBe('本教室考生人數');
    const subs = p.stats.table.rows.slice(1);
    expect(subs.length).toBe(3); // 國文、英文、數學各一列，即使各班人數完全相同也不合併
    for (const r of subs) expect(r.lead).toHaveLength(3);
    expect(h).toContain('<th>第幾天</th><th>時段</th><th>科目</th>');
    expect(h).toContain('<th>總計</th>');
    expect(h).not.toMatch(/<td[^>]*>考[^<]*、[^<]*<\/td>/);
  });

  it('標籤：全白底、特殊情形一律淺黃、頁面紙張與格數對、注意事項固定', () => {
    const h = html({ paper: 'A3' }, 'label');
    expect(h).toContain('page:a3');
    expect(h).toContain('background:#FFE08A');
    expect(h).toContain('background:#fff');
    expect(h).not.toMatch(/background:#FBE7C6/); // 標籤不用班級色
    expect(h).toContain(`repeat(4,${+((297 - 21) / 7).toFixed(2)}mm)`); // 4 排
    expect(h).toContain('注意事項：');
    expect(h).toContain('請使用<b>透明膠帶</b>黏貼');
  });

  it('標籤：B4 格高＝紙高÷7、頁寬等於紙張；空位不印斜線格（D113）', () => {
    const h = html({ paper: 'B4' }, 'label');
    expect(h).toContain('page:b4');
    expect(h).toContain(`height:${+(353 / 7).toFixed(2)}mm`);
    expect(h).toContain('width:250mm');
    expect(h).toContain('pp-bl'); // 沒人的位置：無框空白
    expect(h).not.toContain('pp-e"');
  });

  it('預備教室座位表（時段版）：白底、格內每人一區、格內說明、下方有時段統計表（#220）', () => {
    const f = makeFixture();
    const p = buildSeatPages(f).find((x) => x.slotMode)!;
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(h).toContain('pp-pe');
    expect(h).toContain('格內每個人一區');
    expect(h).toContain('<table class="pp-st">');
    expect(h).toContain('不重複人數');
  });
});

describe('v2.36 輸出紙面補強（B 類）', () => {
  it('#223 角標：不考＝「英」、加考＝「＋數」，Word 與列印頁都印、不再有整格粗框', async () => {
    const f = makeFixture();
    const p = buildSeatPages(f, 'class')[0]!;
    const c2 = p.cells.get('1-2')!;
    expect(c2.corners).toEqual([{ kind: 'x', text: 'X 英' }]);
    expect(p.cells.get('1-3')!.corners).toEqual([{ kind: 'add', text: '＋ 數' }]);
    const { text } = await unzip(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    const xml = await text('word/document.xml');
    expect(xml).toContain('> X 英 <');
    expect(xml).not.toContain('FFE08A'); // 座位表沒有淡黃底
  });

  it('#223 反標：某科不考超過該頁一半時改標「有考」者，頁首寫明', () => {
    const f = makeFixture();
    // 甲教室 18 人，讓 10 人不考英文（超過一半）
    f.result.marks = f.result.assignments.filter((a) => a.classroomId === 'r1').slice(0, 10).map((a) => ({ code: a.code, subjectId: 'en', mode: 'absent' as const }));
    const p = buildSeatPages(f, 'class')[0]!;
    expect(p.flipNotes).toEqual(['本頁多數不考英文，只標有考者']);
    expect(p.chips).toContain('本頁多數不考英文，只標有考者');
    const absentCell = p.cells.get('1-1')!;
    expect(absentCell.corners).toEqual([]); // 不考的人不標
    const takes = [...p.cells.values()].filter((c) => c.corners?.some((k) => k.kind === 'take' && k.text === '考英'));
    expect(takes.length).toBe(8);
    expect(renderPrintHtml({ seat: [p] }, meta)).toContain('>考英<');
  });

  it('#223 標籤同樣用單字角標，並把反標說明放在頁首', () => {
    const f = makeFixture();
    const lp = buildLabelPages(f, 'class')[0]!;
    expect(lp.cells.find((c) => c.code === '0102')!.corners).toEqual([{ kind: 'x', text: 'X 英' }]);
    expect(renderPrintHtml({ label: [lp] }, meta)).not.toContain('pp-c mk');
  });

  it('#221 #212 預備教室座位表：格內每人一區，2 人輪流各一區、有大字編號與「班級｜姓名」', () => {
    const f = makeFixture();
    const p = buildSeatPages(f).find((x) => x.slotMode)!;
    const c = p.cells.get('1-1')!;
    expect(c.persons!.map((q) => q.code)).toEqual(['0105']);
    expect(c.persons![0]).toMatchObject({ classLabel: '溫', name: '甲生105' });
    expect(c.persons![0]!.sched[0]).toMatch(/英文/);
  });

  it('#220 預備教室統計表：每個時段一列、最後一列「不重複人數」', () => {
    const f = makeFixture();
    const p = buildSeatPages(f).find((x) => x.slotMode)!;
    const t = p.stats.table;
    expect(t.headLabel).toBe('時段');
    expect(t.rows[t.rows.length - 1]!.label).toBe('不重複人數');
    expect(t.rows[t.rows.length - 1]!.total).toBe(p.stats.total);
  });

  it('#221 3 人以上輪流：格內只印座位，其餘列在座位表下一頁（Word 與列印頁都多一頁）', async () => {
    const f = makeFixture();
    f.result.detaches = ['0105', '0106', '0107'].map((code, i) => ({ code, subjectId: i === 0 ? 'zh' : 'en', purpose: 'exam' as const, roomId: 'rv', seat: { row: 1, depth: 1 } }));
    const p = buildSeatPages(f).find((x) => x.slotMode)!;
    expect(p.cells.get('1-1')!.persons).toHaveLength(3);
    expect(p.rotation!.rows.length).toBeGreaterThanOrEqual(3);
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(h).toContain('輪流座位');
    expect(h).toContain('共 3 人輪流');
    const { text } = await unzip(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    expect(await text('word/document.xml')).toContain('輪流座位');
  });

  it('#219 抽離自習名單：標題下一行「第N天　時段X　科目」，沒有日期欄', async () => {
    const f = makeFixture();
    const l = buildDetachList(f);
    const lists = (Array.isArray(l) ? l : [l]) as { title: string; subtitle?: string }[];
    expect(lists.length).toBeGreaterThan(0);
    const study = (await import('./index')).buildStudyLists(f);
    expect(study.length).toBeGreaterThan(0);
    expect(study[0]!.subtitle).toBe('國文'); // 沒有節次表就只寫科目；有節次表見 periodDetach.test
    const h = renderPrintHtml({ list: study }, meta);
    expect(h).toContain(study[0]!.subtitle!);
    expect(h).not.toContain('日期');
  });

  it('#215 橫式公告表：Word 頁面橫向、兩層表頭（跨欄）、自習格灰底', async () => {
    const t = {
      kind: 'table' as const, landscape: true, title: '公告', heads: ['座號', '姓名', '時段一 國文', '時段二 英文'],
      headGroups: [{ text: '', span: 2 }, { text: '第一天', span: 2 }], widths: [1, 1, 2, 2],
      rows: [['1', '甲', '3－2', '自習 乙教室']], cellKinds: [[undefined, undefined, 'exam' as const, 'study' as const]],
    };
    const { text } = await unzip(await renderDocx({ table: [t] }, { fonts, ...meta }));
    const xml = await text('word/document.xml');
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('w:gridSpan w:val="2"');
    expect(xml).toContain('D9D9D9');
    const h = renderPrintHtml({ table: [t] }, meta);
    expect(h).toContain('page:a4l');
    expect(h).toContain('colspan="2"');
    expect(h).toContain('k-study');
  });
});

describe('座位表頁首標籤換行與兩時段格（#247、#212）', () => {
  it('#247 標籤很多時換成多列，每列都不超過頁寬；Word 的標籤表格不只一個', async () => {
    const { chipRowCount, SEAT_PAGE } = await import('./index');
    const few = ['共 5 人', '不考英文 2 人'];
    const many = ['共 5 人', ...['國文', '英文', '數學A', '數學B', '社會', '自然', '英聽'].map((s) => `不考${s} 3 人`), '加考物理 1 人'];
    expect(chipRowCount(few)).toBe(1);
    expect(chipRowCount(many)).toBeGreaterThan(1);
    const f = makeFixture();
    const p = buildSeatPages(f, 'class')[0]!;
    p.chips = many;
    const { text } = await unzip(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    const xml = await text('word/document.xml');
    for (const c of many) expect(xml).toContain(c);
    // 標籤列表格（高度 7.2mm＝408 twips）的寬度都不超過可印寬度
    const maxW = Math.round(((SEAT_PAGE.w - 2 * SEAT_PAGE.padX) / 25.4) * 1440);
    for (const m of xml.matchAll(/<w:tblW w:w="(\d+)" w:type="dxa"\/>/g)) expect(Number(m[1])).toBeLessThanOrEqual(maxW + 2);
    // 座位格仍整張放得進一頁：第一段表格的列數不增加（版面高度有扣掉多出來的列）
    expect(renderPrintHtml({ seat: [p] }, meta)).toContain('pp-chip');
  });

  it('#212 兩人輪流的格：每人兩行（編號、班級｜姓名）再接時程，姓名字級不再縮成一行擠', async () => {
    const { personLayout } = await import('./index');
    const c = {
      coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
      persons: [
        { code: '0105', classLabel: '溫', name: '甲生105', sched: ['第一天 國綜'] },
        { code: '0206', classLabel: '良', name: '甲生206', sched: ['第一天 英文'] },
      ],
    };
    const { lines } = personLayout(c, 23.5, 32, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true }); // 預備教室座位格高度放寬到最多 32mm
    const tight = personLayout(c, 23.5, 26, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true }).lines[1]!.pt;
    expect(tight).toBeGreaterThanOrEqual(7.5); // 即使只有 26mm 高，也比原本單行擠的 6.5pt 大
    expect(lines).toHaveLength(6); // 每人：編號、班級｜姓名、時程
    const nameLine = lines[1]!;
    expect(nameLine.runs.map((r) => r.text).join('')).toBe('溫 | 甲生105');
    expect(nameLine.pt).toBeGreaterThanOrEqual(10); // 放寬高度後接近姓名上限 10.5pt
  });

  it('#216 兩倍寬 wideLayout：單人左編號姓名、右科目（放不下只列科目）；2 人左右各一人；3 人以上每人一區（D108）', async () => {
    const { wideLayout } = await import('./index');
    const person = (code: string, n: number) => ({ code, classLabel: '溫', name: '王小明', sched: ['物理', '化學', '數甲', '生物', '歷史', '地理'].slice(0, n).map((s, i) => `第一天 時段${'一二三四五六'[i]} ${s}`), schedShort: ['物理', '化學', '數甲', '生物', '歷史', '地理'].slice(0, n) });
    const cell = (ps: ReturnType<typeof person>[]) => ({ coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [], persons: ps });
    const o = { topPad: 5, codePt: 33, nameMax: 18, subjMax: 20 };
    const full = wideLayout(cell([person('0101', 4)]), 36.3, 35, o); // B4 半張 36mm：完整寫法仍有約 11pt → 照寫
    expect(full.right![0]!.runs[0]!.text).toBe('第一天 時段一 物理');
    const one = wideLayout(cell([person('0101', 4)]), 33, 35, o); // A3 半張 33mm：完整寫法不到 10.5pt → 只列科目
    expect(one.left!.map((l) => l.runs[0]!.text)).toEqual(['0101', '溫']);
    expect(one.right!.map((l) => l.runs[0]!.text)).toEqual(['物理', '化學', '數甲', '生物']); // 完整寫法放不下 → 只列科目
    expect(Math.min(...one.right!.map((l) => l.pt))).toBeGreaterThanOrEqual(10.5);
    const six = wideLayout(cell([person('0101', 6)]), 33, 35, o);
    expect(six.right!).toHaveLength(3); // ≥5 科兩科一行
    expect(six.right![0]!.runs[0]!.text).toBe('物理　化學');
    const two = wideLayout(cell([person('0101', 2), person('0202', 2)]), 36, 35, o);
    expect(two.left).toBeTruthy(); expect(two.right).toBeTruthy();
    // D108：3 人以上每人一區「班級｜姓名」加科目（只列科目、依時間順序），不寫「共N人輪流／見座位表下一頁」
    const many = wideLayout(cell([person('0101', 1), person('0202', 2), person('0303', 1), person('0404', 2), person('0505', 1)]), 36, 35, o);
    const txt = [...many.left!, ...many.right!].map((l) => l.runs.map((r) => r.text).join(''));
    expect(txt.join('')).not.toMatch(/輪流|下一頁/);
    expect(txt.filter((t) => t.includes('王小明'))).toHaveLength(5); // 5 人每人都有「班級｜姓名」
    expect(txt.join('')).toContain('物理、化學'); // 科目依時間順序併一行
    expect(Math.min(...[...many.left!, ...many.right!].map((l) => l.pt))).toBeGreaterThanOrEqual(7.5); // 5 人時字仍夠大
    expect(many.left!.length).toBeGreaterThan(0); expect(many.right!.length).toBeGreaterThan(0);
  });

  it('#216 備註：Word 輸出不含全形空白 U+3000（使用者的 Word 會顯示成方框），標題分隔改一般空白；列印頁不受影響', async () => {
    const f = makeFixture();
    const seat = buildSeatPages(f).slice(0, 1);
    const label = buildLabelPages(f, 'class').slice(0, 1);
    const t = { kind: 'table' as const, title: '分科第6次(E6)　簽到名冊', subtitle: 'A　B', heads: ['座位'], widths: [1], rows: [['1－1']] };
    const buf = await renderDocx({ seat, label, table: [t] }, { fonts, ...meta });
    const { text } = await unzip(buf);
    const xml = await text('word/document.xml');
    expect(xml).not.toContain('　');
    expect(xml).toContain('分科第6次(E6)   簽到名冊');
    expect(renderPrintHtml({ table: [t] }, meta)).toContain('　'); // 瀏覽器列印頁沒有方框問題，維持
  });

  it('#212 真實資料複驗：學測預備教室格的 persons 帶 schedShort（單人多時段才會併一行）；時段多的座位表統計表改下一頁、座位格不再被壓到 15mm', async () => {
    const { seatGeometry, personLayout } = await import('./index');
    const f = makeFixture();
    f.result.detaches = ['0105', '0106'].map((code, i) => ({ code, subjectId: i === 0 ? 'zh' : 'en', purpose: 'exam' as const, roomId: 'rv', seat: { row: 1, depth: 1 } }));
    const pg = buildSeatPages(f).find((x) => x.slotMode)!;
    for (const c of pg.cells.values()) for (const p of c.persons ?? []) expect(p.schedShort?.length).toBe(p.sched.length);
    // 12 個時段（分科 E6）的統計表很高：舊算法座位格約 15mm；改統計表下一頁後座位格 ≥ 22mm
    const rows = Array.from({ length: 13 }, (_, i) => ({ label: `第${i + 1}天 時段一　物理、化學`, per: [3, 2, 3, 2, 3, 2], total: 15 }));
    const tall = { ...pg, rows: 7, depth: 8, stats: { ...pg.stats, table: { headLabel: '時段', classes: ['溫', '良', '恭', '儉', '勤', '誠'], rows } } };
    const g = seatGeometry(tall);
    expect(g.statsNext).toBe(true);
    expect(g.ch).toBeGreaterThanOrEqual(22);
    const two = { coord: '7－1', seat: { row: 7, depth: 1 }, code: '', classLabel: '', name: '', colorBg: '', colorLine: '', colorFg: '', tags: [], marks: [], persons: ['王小明', '李大華'].map((n, i) => ({ code: `150${i}`, classLabel: '溫', name: n, sched: ['第一天 物理', '第二天 化學'], schedShort: ['物理', '化學'] })) };
    const r = personLayout(two, g.cw - 1.3, g.ch, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true });
    expect(Math.min(...r.lines.filter((l) => l.pri).map((l) => l.pt))).toBeGreaterThanOrEqual(9);
    const xml = await (async () => { const { text } = await unzip(await renderDocx({ seat: [tall] }, { fonts, ...meta })); return text('word/document.xml'); })();
    expect(xml).toContain('各班人數統計');
    expect(xml).toContain('w:pageBreakBefore');
    expect(renderPrintHtml({ seat: [tall] }, meta)).toContain('各班人數統計');
  });

  it('#212 #220 兩人格在矮格（8 深位）改精簡版：不留編號行、科目併一行，姓名不縮到 4pt、整塊放得進格高', async () => {
    const { personLayout } = await import('./index');
    const mk = (ns: number) => ({
      coord: '7－1', seat: { row: 7, depth: 1 }, code: '', classLabel: '', name: '', colorBg: '', colorLine: '', colorFg: '', tags: [], marks: [],
      persons: ['王小明', '李大華'].map((name, i) => ({ code: `150${i}`, classLabel: '三自然15班', name, sched: Array.from({ length: ns }, (_, k) => `第${'一二三'[k]}天 時段${'一二三'[k]} 公民與社會`), schedShort: Array.from({ length: ns }, () => '歷史') })),
    });
    const o = { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true };
    for (const ns of [1, 2]) {
      const r = personLayout(mk(ns), 23.5, 20.66, o);
      const texts = r.lines.map((l) => l.runs.map((x) => x.text).join(''));
      expect(texts.some((t) => /^150\d$/.test(t))).toBe(false); // 編號行拿掉
      expect(r.lines.filter((l) => l.pri).every((l) => l.pt >= 6)).toBe(true); // 姓名行不縮到 4～5pt
      expect(r.total).toBeLessThanOrEqual(20.66 - 4.5 - 1 + 0.05); // 放得進格高，最後一行不被切
      if (ns === 2) expect(texts.filter((t) => t.includes('、'))).toHaveLength(2); // 每人科目併成一行
    }
    // 格子夠高時姓名也能放大（科目字也有約 7pt），不會因為時程行太長被縮成 5pt
    const tall = personLayout(mk(1), 23.5, 32, o);
    expect(tall.lines.filter((l) => l.pri).every((l) => l.pt >= 7)).toBe(true);
    expect(Math.min(...tall.lines.filter((l) => !l.pri).map((l) => l.pt))).toBeGreaterThanOrEqual(7);
    // #212 單人考 2 個時段在矮格：科目併一行，編號與姓名不被擠到 4～5pt
    const one = { ...mk(2), persons: [mk(2).persons[0]!] };
    const r1 = personLayout(one, 23.5, 20.66, o);
    expect(r1.lines.filter((l) => l.runs[0]!.text.includes('、'))).toHaveLength(1);
    expect(Math.min(...r1.lines.map((l) => l.pt))).toBeGreaterThanOrEqual(6);
  });

  it('#220 殘留：兩人各考 3～6 科（合計超過 4 行）時科目併成一行，整塊放得進格高、最後一行不被切', async () => {
    const { personLayout } = await import('./index');
    for (const ns of [3, 4, 6]) for (const h of [24, 28, 32]) {
      const names = ['物理', '化學', '數甲', '生物', '歷史', '地理'].slice(0, ns);
      const sched = names.map((s, i) => `第二天 時段${'一二三四五六'[i]} ${s}`);
      const c = {
        coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
        persons: [
          { code: '0105', classLabel: '溫', name: '王小明', sched, schedShort: names },
          { code: '0206', classLabel: '良', name: '李大華', sched, schedShort: names },
        ],
      };
      const { lines, total } = personLayout(c, 24, h, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true });
      expect(lines.length).toBeGreaterThanOrEqual(4); // 每人：（編號）、班級｜姓名、一行科目；矮格精簡版沒有編號行（#212）
      expect(lines.filter((l) => l.runs[0]!.text === names.join('、'))).toHaveLength(2);
      expect(total).toBeLessThanOrEqual(h - 4.5 - 1 + 0.3);
    }
  });

  it('#220 兩人各兩個時段（8 行）＋長科目名：整塊（含折行）放得進格高，最後一行不會被格下緣切掉', async () => {
    const { personLayout } = await import('./index');
    const sched = ['第二天 時段一 數學A', '第三天 時段二 公民與社會'];
    const c = {
      coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
      persons: [
        { code: '0605', classLabel: '誠', name: '王小明', sched },
        { code: '0209', classLabel: '良', name: '李大華', sched },
      ],
    };
    for (const [w, h] of [[22, 30], [24, 28], [30, 26], [22, 34]] as const) {
      const { lines, total } = personLayout(c, w, h, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true });
      expect(lines.reduce((n, l) => n + (l.n ?? 1), 0)).toBeGreaterThanOrEqual(8);
      expect(total).toBeLessThanOrEqual(h - 4.5 - 1 + 0.1);
      expect(Math.min(...lines.map((l) => l.pt))).toBeGreaterThanOrEqual(4);
    }
  });

  it('#212（1.17.8 複驗仍小）：格子矮到放不下時，先縮編號與時程行，姓名字級不被一起縮；姓名永遠比編號與時程大', async () => {
    const { personLayout } = await import('./index');
    const c = {
      coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
      persons: [
        { code: '0105', classLabel: '溫', name: '王小明', sched: ['第一天 國綜'] },
        { code: '0206', classLabel: '良', name: '李大華', sched: ['第一天 英文'] },
      ],
    };
    const o = { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true };
    for (const h of [30, 26]) {
      const { lines, total } = personLayout(c, 24, h, o);
      const names = lines.filter((l) => l.pri);
      const others = lines.filter((l) => !l.pri);
      expect(names).toHaveLength(2);
      expect(Math.min(...names.map((l) => l.pt))).toBeGreaterThanOrEqual(9); // 此寬度（24mm）下姓名受寬度限制約 10pt，矮格不再被一起縮（舊版矮格會縮到 7pt 以下）
      expect(Math.min(...names.map((l) => l.pt))).toBeGreaterThan(Math.max(...others.map((l) => l.pt)));
      expect(total).toBeLessThanOrEqual(h - 4.5 + 0.5); // 仍放得進格高
    }
  });
});

describe('#223 座位格太矮時角標不被切', () => {
  it('fitSeatCell：夠高不縮、太矮時整體等比縮小到放得進格高', async () => {
    const { fitSeatCell } = await import('./index');
    const g = { topPad: 4.5, codePt: 19, markArea: 5.2, bottomPad: 0.8 };
    expect(fitSeatCell({ ...g, h: 23 }, 12).k).toBe(1);
    const k = fitSeatCell({ ...g, h: 16 }, 12).k;
    expect(k).toBeLessThan(1);
    const total = g.topPad + g.bottomPad + k * (19 * 0.3528 + 12 * 0.3528 * 1.15 + g.markArea);
    expect(total).toBeLessThanOrEqual(16 + 1e-6);
    expect(fitSeatCell({ ...g, h: 8 }, 12).k).toBe(0.5); // 再矮也不縮到看不見
  });
});
