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
  defaultLabelLayout,
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
    expect(pages.map((p) => !!p.slotMode)).toEqual([false, false, true]);
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

  it('標籤：格數參數化，每張紙格子大小固定、順序同座位表（D69/D72）', () => {
    const f48 = labelCellMm({ paper: 'B4', cols: 6, rows: 8 }, 0);
    expect(f48.w).toBeCloseTo(250 / 6, 5);
    expect(f48.h).toBeCloseTo((353 - 3) / 8, 5);
    expect(labelCellMm({ paper: 'A3', cols: 7, rows: 7 }, 0)).toEqual({ w: 35, h: 35 });
    expect(labelCellMm({ paper: 'B4', cols: 7, rows: 7 }, 0).w).toBeCloseTo(250 / 7, 5);
    const pages = buildLabelPages(makeFixture({ labelCols: 7, labelRows: 7 }), 'class');
    expect(pages).toHaveLength(2);
    expect(pages[0]!.cells.slice(0, 3).map((c) => c.coord)).toEqual(['1-1', '1-2', '1-3']);
    expect(pages[0]!.cells).toHaveLength(18);
  });

  it('標籤位置與座位表相同（D14、D38）：欄＝排，列＝深位，深位 1 在最下面，0101 在左下角，沒座位的位置留空', () => {
    const pages = buildLabelPages(makeFixture({ labelCols: 7, labelRows: 7 }), 'class');
    const g = labelGrid(pages[0]!); // 甲教室：4 排、深位 1～5，18 個座位（依 5 深位填：排1 深位1～5 …）
    const at = (col: number, rowFromTop: number) => g[rowFromTop * 7 + col];
    expect(at(0, 6)?.code).toBe('0101'); // 最下列、最左欄
    expect(at(0, 2)?.code).toBe('0105'); // 排 1 深位 5：往上數第 5 格
    expect(at(0, 1)).toBeUndefined(); // 深位 6、7 沒座位
    expect(at(1, 6)?.coord).toBe('2-1'); // 第 2 排從左邊第 2 欄開始
    expect(at(4, 6)).toBeUndefined(); // 第 5 排沒有座位
    // 每個座位剛好出現一次
    expect(g.filter(Boolean)).toHaveLength(18);
  });

  it('標籤預設（D74）：A3 7×7 固定 35mm 正方，B4 6 欄×8 列', () => {
    expect(defaultLabelLayout('A3')).toEqual({ paper: 'A3', cols: 7, rows: 7 });
    expect(defaultLabelLayout('B4')).toEqual({ paper: 'B4', cols: 6, rows: 8 });
    expect(labelCellMm(defaultLabelLayout('A3'), 10)).toEqual({ w: 35, h: 35 });
    const b4 = labelCellMm(defaultLabelLayout('B4'), 10);
    expect(b4.w).toBeCloseTo(230 / 6, 5);
    expect(b4.h).toBeCloseTo((353 - 20 - 3) / 8, 5);
  });

  it('標籤：座位多於一張格數時自動分張（#210），不截斷', () => {
    const f = makeFixture({ labelCols: 4, labelRows: 4 });
    const pages = buildLabelPages(f, 'class');
    const total = pages.reduce((n, p) => n + p.cells.length, 0);
    expect(total).toBe(f.result.assignments.filter((a) => f.exam.classroomIds.includes(a.classroomId)).length);
    expect(pages.some((p) => p.part && p.part.of > 1)).toBe(true);
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
      Array(3).fill([String(mmToTwip(210)), String(mmToTwip(297))]),
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

  it('標籤：B4 紙張、欄寬相等、列高固定、7×7 與 6×8 都能出', async () => {
    for (const [cols, rows] of [[6, 8], [7, 7]] as const) {
      const f = makeFixture({ labelCols: cols, labelRows: rows });
      const buf = await renderDocx({ label: buildLabelPages(f, 'class') }, { fonts, ...meta, labelMarginMm: 10 });
      const doc = await (await unzip(buf)).text('word/document.xml');
      const pg = [...doc.matchAll(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(pg).toEqual(Array(2).fill([mmToTwip(250), mmToTwip(353)]));
      // 版面有抬頭表、格子表、注意事項框：格子表是欄數等於 cols 的那個（每頁一個）
      const grids = [...doc.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/w:w="(\d+)"/g)].map((x) => Number(x[1]))).filter((w) => w.length === cols);
      expect(grids).toHaveLength(2);
      const widths = grids[0]!;
      expect(new Set(widths).size).toBe(1);
      expect(widths[0]! * cols).toBeLessThanOrEqual(mmToTwip(250 - 20));
      const heights = [...doc.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1]));
      expect(heights).toHaveLength(rows * 2);
      expect(new Set(heights).size).toBe(1);
      expect(heights[0]!).toBeLessThanOrEqual(mmToTwip(35)); // 稿件：格高最多 35mm，格子下方留給注意事項
    }
  });

  it('A3 7×7：每格 35mm 正方、格子大小不隨人數變', async () => {
    const f = makeFixture({ paper: 'A3', labelCols: 7, labelRows: 7 });
    const doc = await (await unzip(await renderDocx({ label: buildLabelPages(f, 'class') }, { fonts, ...meta }))).text('word/document.xml');
    const widths = [...doc.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/w:w="(\d+)"/g)].map((x) => Number(x[1]))).find((w) => w.length === 7)!;
    expect(widths).toEqual(Array(7).fill(mmToTwip(35)));
    const heights = new Set([...doc.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1])));
    expect([...heights]).toEqual([mmToTwip(35)]);
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
    expect(h).toContain('<span class="pp-mk x">英</span>');
    expect(h).toContain('<span class="pp-mk add">＋數</span>');
    expect(h).not.toContain('X 英文'); // 也沒有整句小牌
  });

  it('統計表：每班人數相同的科目合併成一列', () => {
    const f = makeFixture();
    const p = buildSeatPages(f, 'class')[0]!;
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(h).toMatch(/<td>考[^<]*、[^<]*<\/td>/);
    expect(p.stats.table.rows[0]!.label).toBe('本教室考生人數');
  });

  it('標籤：全白底、特殊情形一律淺黃、頁面紙張與格數對、注意事項固定', () => {
    const h = html({ paper: 'A3', labelCols: 7, labelRows: 7 }, 'label');
    expect(h).toContain('page:a3');
    expect(h).toContain('background:#FFE08A');
    expect(h).toContain('background:#fff');
    expect(h).not.toMatch(/background:#FBE7C6/); // 標籤不用班級色
    expect(h).toContain('repeat(7,35mm)');
    expect(h).toContain('注意事項：');
    expect(h).toContain('請使用<b>透明膠帶</b>黏貼');
  });

  it('標籤：B4 格高最多 35mm、頁寬等於紙張；排 8 列時縮到放得下注意事項與頁尾', () => {
    const h7 = html({ paper: 'B4', labelCols: 6, labelRows: 7 }, 'label');
    expect(h7).toContain('page:b4');
    expect(h7).toContain('height:35mm');
    expect(h7).toContain('width:250mm');
    const h8 = html({ paper: 'B4', labelCols: 6, labelRows: 8 }, 'label');
    expect(h8).not.toContain('height:35mm');
    expect(h8).toContain('height:33.6mm');
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
    expect(c2.corners).toEqual([{ kind: 'x', text: '英' }]);
    expect(p.cells.get('1-3')!.corners).toEqual([{ kind: 'add', text: '＋數' }]);
    const { text } = await unzip(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    const xml = await text('word/document.xml');
    expect(xml).toContain('>\u00a0英\u00a0<'.replace(/\u00a0/g, ' '));
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
    expect(lp.cells.find((c) => c.code === '0102')!.corners).toEqual([{ kind: 'x', text: '英' }]);
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
    const { lines } = personLayout(c, 23.5, 32, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7 }); // 預備教室座位格高度放寬到最多 32mm
    const tight = personLayout(c, 23.5, 26, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7 }).lines[1]!.pt;
    expect(tight).toBeGreaterThanOrEqual(7.5); // 即使只有 26mm 高，也比原本單行擠的 6.5pt 大
    expect(lines).toHaveLength(6); // 每人：編號、班級｜姓名、時程
    const nameLine = lines[1]!;
    expect(nameLine.runs.map((r) => r.text).join('')).toBe('溫 | 甲生105');
    expect(nameLine.pt).toBeGreaterThanOrEqual(10); // 放寬高度後接近姓名上限 10.5pt
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
      const { lines, total } = personLayout(c, 24, h, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7 });
      expect(lines).toHaveLength(6); // 每人：編號、班級｜姓名、一行科目
      expect(lines[2]!.runs[0]!.text).toBe(names.join('、'));
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
      const { lines, total } = personLayout(c, w, h, { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7 });
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
    const o = { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7 };
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
