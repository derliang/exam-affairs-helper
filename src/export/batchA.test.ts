/** 修復包 A／A2（2026-11-18）：標籤整頁高度不溢出、四周列印邊距、注意事項必印（#372 #385 #387、D136）、匯出班名表只用本部別（#371）、自習頁標示天與時段（#386） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildLabelPages, buildSeatPages, LABEL_BOTTOM_MM, LABEL_EDGE_MM, LABEL_EDGE_X_MM, LABEL_FOOTER_MM, LABEL_NOTE_PT, LABEL_PAGE_FIXED_MM, labelFit, labelNoteBlockMm, mmToTwip, PAPER_MM, renderDocx, renderPrintHtml, statLayout } from './index';
import { makeFixture } from './fixtures';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };

/** Word 實測（B4，2026-11-18）：標題列與它下方間距合計 21.4mm（格子上緣＝上邊界＋21.4）；表格後必有的段落 0.35mm */
const WORD_HEAD_MM = 21.4;

describe('標籤整頁高度（#372 #385 #387、D136）：四周留列印邊距、注意事項一定印、每間教室一頁', () => {
  it('每種紙張、深位 1～8、注意事項 0～4 行：格子＋標題＋注意事項＋頁尾 ≤ 紙高；寬＋左右邊距 ≤ 紙寬；有注意事項就一定印', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = { paper, cols: 7, rows: 7 };
      for (let rows = 1; rows <= 8; rows++) {
        for (let lines = 0; lines <= 4; lines++) {
          const f = labelFit(l, rows, lines);
          const need = LABEL_EDGE_MM + WORD_HEAD_MM + rows * f.h + labelNoteBlockMm(paper, f.notePt, lines) + 0.35 + LABEL_BOTTOM_MM;
          expect(need, `${paper} ${rows} 列 ${lines} 行`).toBeLessThanOrEqual(PAPER_MM[paper].h);
          expect(7 * f.w + 2 * LABEL_EDGE_X_MM).toBeLessThanOrEqual(PAPER_MM[paper].w + 1e-9);
          if (lines) expect(f.notePt, `${paper} ${rows} 列 ${lines} 行要印注意事項`).toBeGreaterThanOrEqual(LABEL_NOTE_PT[paper].min);
          else expect(f.notePt).toBe(0);
          expect(f.h).toBeLessThanOrEqual(PAPER_MM[paper].h / 7 + 1e-9);
        }
      }
      expect(LABEL_PAGE_FIXED_MM).toBeGreaterThanOrEqual(LABEL_EDGE_MM + WORD_HEAD_MM + 0.35 + LABEL_BOTTOM_MM);
    }
    // 列印邊距至少 5mm（一般印表機不可列印區約 4～5mm），頁尾文字也在可列印區內
    expect(LABEL_EDGE_MM).toBeGreaterThanOrEqual(5);
    expect(LABEL_FOOTER_MM).toBeGreaterThanOrEqual(5);
    expect(LABEL_BOTTOM_MM - LABEL_FOOTER_MM).toBeGreaterThanOrEqual(4.6 + 2);
  });

  it('深位 5 以下（有 3 行注意事項）格高仍是紙高÷7、字級不縮；深位 6、7 格子縮矮但注意事項照印', () => {
    const b4 = { paper: 'B4' as const, cols: 7, rows: 7 };
    expect(labelFit(b4, 5, 3)).toMatchObject({ h: 353 / 7, notePt: 13 });
    for (const rows of [6, 7]) {
      const f = labelFit(b4, rows, 3);
      expect(f.notePt).toBe(LABEL_NOTE_PT.B4.min);
      expect(f.h).toBeLessThan(353 / 7);
      expect(f.h).toBeGreaterThan(37); // 「稍微縮小」：B4 深位 7 約 38.4mm（D136，邊距 10mm）
    }
  });

  it('Word：深位 6、7（B4、A3）每間教室一個區段、四周邊距 ≥ 10mm、注意事項有印，且格高＋標題＋注意事項＋下邊界不超過頁高', async () => {
    for (const paper of ['B4', 'A3'] as const) {
      for (const depth of [6, 7]) {
        const f = makeFixture({ paper });
        f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth, seatCount: 7 * depth };
        const pages = buildLabelPages(f, 'class');
        const x = await (await JSZip.loadAsync(await renderDocx({ label: pages }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
        expect((x.match(/<w:sectPr/g) ?? []).length).toBe(pages.length);
        expect(x).toContain('注意事項');
        const rowTw = Number(x.match(/<w:trHeight w:val="(\d+)" w:hRule="exact"/)![1]);
        const pg = x.match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/)!;
        const mar = x.match(/<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)" w:header="\d+" w:footer="(\d+)"/)!;
        const [top, right, bottom, left, footer] = [1, 2, 3, 4, 5].map((i) => Number(mar[i])) as [number, number, number, number, number];
        for (const v of [top, right, left, footer]) expect(v).toBeGreaterThanOrEqual(mmToTwip(LABEL_EDGE_MM) - 1);
        const fit = labelFit(pages[0]!.layout, depth, pages[0]!.notes.length);
        const total = top + mmToTwip(WORD_HEAD_MM) + depth * rowTw + mmToTwip(labelNoteBlockMm(paper, fit.notePt, pages[0]!.notes.length)) + mmToTwip(0.35) + bottom;
        expect(total, `${paper} 深位 ${depth}`).toBeLessThanOrEqual(Number(pg[2]));
        expect(Number(pg[1])).toBe(mmToTwip(PAPER_MM[paper].w));
      }
    }
  });

  it('列印頁（PDF 路徑）：四周 10mm 內距、格高與 Word 同、深位 7 也印注意事項', () => {
    const f = makeFixture({ paper: 'B4' });
    f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth: 7, seatCount: 49 };
    const html = renderPrintHtml({ label: buildLabelPages(f, 'class') }, meta);
    const fit = labelFit({ paper: 'B4', cols: 7, rows: 7 }, 7, 3);
    expect(html).toContain(`height:${+fit.h.toFixed(2)}mm`);
    expect(html).toContain('padding:10mm 10.5mm');
    expect(html).toContain('class="pp-note"');
  });
});

describe('匯出班名表只用本部別的班級（#371）', () => {
  it('國中、高中班號重疊時，高中考生印高中的班名，不被國中班名蓋掉', () => {
    const f = makeFixture();
    // 另加兩個國中班，班號與高中 1、2 重疊（settings.classes 同時有兩個部別）
    // 國中班排在後面：用全部班級建表時，後面的班會蓋掉前面同號的高中班（#371 的情形）
    f.settings.classes = [
      ...f.settings.classes,
      { no: 1, name: '國溫', division: 'junior', colorIndex: 1 },
      { no: 2, name: '國良', division: 'junior', colorIndex: 2 },
    ] as typeof f.settings.classes;
    const labels = buildLabelPages(f, 'class').flatMap((p) => p.cells.map((c) => c.classLabel));
    expect(labels).toContain('溫');
    expect(labels).toContain('良');
    expect(labels.some((l) => l.startsWith('國'))).toBe(false);
    const seatLabels = buildSeatPages(f, 'class').flatMap((p) => [...p.cells.values()].map((c) => c.classLabel));
    expect(seatLabels.some((l) => l.startsWith('國'))).toBe(false);
    for (const p of buildSeatPages(f, 'class')) expect(p.stats.table.classes.some((c) => c.startsWith('國'))).toBe(false);
  });
});

describe('自習座位頁標示第幾天、哪個時段（#386、D147⑦）', () => {
  const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;

  it('統計表的「自習人數」列本身就寫第幾天、時段與科目（只看那張表也知道是哪一節）', () => {
    const pg = buildSeatPages(real(), 'reserve').find((p) => p.roomName.includes('自習座位'))!;
    const label = pg.stats.table.rows[0]!.label;
    expect(label).toMatch(/^自習人數（第 \d 天 時段.+國文）$/);
    // 頁首小標籤仍有同樣的天與時段
    expect(pg.chips.some((c) => /第 \d 天 時段./.test(c))).toBe(true);
  });

  it('列較長時統計表高度已計入（statLayout 依文字寬度決定列高，不會被截掉）', () => {
    const pg = buildSeatPages(real(), 'reserve').find((p) => p.roomName.includes('自習座位'))!;
    const sl = statLayout(pg);
    expect(sl.rowH).toHaveLength(2);
    expect(sl.rowH[1]!).toBeGreaterThanOrEqual(8);
  });

  it('Word 與列印頁都有這串字', async () => {
    const seat = buildSeatPages(real(), 'reserve');
    const x = await (await JSZip.loadAsync(await renderDocx({ seat }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(x).toContain('自習人數（第 1 天 時段三、第 2 天 時段三');
    expect(renderPrintHtml({ seat }, meta)).toContain('自習人數（第 1 天 時段三、第 2 天 時段三');
  });
});
