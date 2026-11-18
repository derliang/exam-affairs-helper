/** 修復包 A（2026-11-18）：標籤整頁高度不溢出（#372 #385 #387）、匯出班名表只用本部別（#371）、自習頁標示天與時段（#386） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildLabelPages, buildSeatPages, LABEL_PAGE_FIXED_MM, labelBoxMm, labelNotePt, mmToTwip, PAPER_MM, renderDocx, renderPrintHtml, statLayout } from './index';
import { makeFixture } from './fixtures';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };

/** Word 實測（B4，2026-11-18）：格子上緣離頁面上緣 24.4mm（上邊界 3＋標題列與間距），頁面下邊界 10mm，表格後的段落 0.35mm */
const WORD_TOP_MM = 24.4;
const WORD_BOTTOM_MM = 10;

describe('標籤整頁高度（#372 #385 #387）：格子加上標題與頁尾不得超過紙高', () => {
  it('每種紙張、每種深位數：格高總和＋標題頁尾預算 ≤ 紙高（滿 7 列、8 列也放同一頁）', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = { paper, cols: 7, rows: 7 };
      for (let rows = 1; rows <= 8; rows++) {
        const grid = rows * labelBoxMm(l, rows).h;
        const need = rows >= 7 ? grid + LABEL_PAGE_FIXED_MM : grid + WORD_TOP_MM + WORD_BOTTOM_MM + 0.35;
        expect(need, `${paper} ${rows} 列`).toBeLessThanOrEqual(PAPER_MM[paper].h);
      }
      // 預算本身不得小於 Word 實測的標題＋頁尾（這是 #372 的根因：以前猜 22mm，實測要約 35mm）
      expect(LABEL_PAGE_FIXED_MM).toBeGreaterThanOrEqual(WORD_TOP_MM + WORD_BOTTOM_MM + 0.35);
    }
  });

  it('有注意事項時（深位≤5）也不超過紙高；放不下的深位（6、7）不印注意事項而不是擠到下一頁', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = { paper, cols: 7, rows: 7 };
      for (let rows = 1; rows <= 7; rows++) {
        const pt = labelNotePt(l, rows, 4, paper === 'B4' ? 13 : 20);
        if (!pt) continue;
        // 與 Word 實作相同的算法：標題列＋格子＋3mm 間距＋注意事項（標題行加 4 行、行高 1.75 倍、上下內距各 2mm、行間 1mm）
        const note = 3 + (pt + 1) * 0.3528 * 1.75 + 1 + 4 * pt * 0.3528 * 1.75 + 4;
        expect(rows * labelBoxMm(l, rows).h + WORD_TOP_MM + note + WORD_BOTTOM_MM, `${paper} ${rows} 列`).toBeLessThanOrEqual(PAPER_MM[paper].h);
      }
    }
  });

  it('Word：滿 7 排×7 深位的每間教室只有一頁，格高＋上下邊界＋標題預算不超過頁高（twips）', async () => {
    for (const paper of ['B4', 'A3'] as const) {
      const f = makeFixture({ paper });
      f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth: 7, seatCount: 49 };
      const pages = buildLabelPages(f, 'class');
      const x = await (await JSZip.loadAsync(await renderDocx({ label: pages }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
      expect((x.match(/<w:sectPr/g) ?? []).length).toBe(pages.length);
      const rowTw = Number(x.match(/<w:trHeight w:val="(\d+)" w:hRule="exact"/)![1]);
      const pg = x.match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/)!;
      const mar = x.match(/<w:pgMar w:top="(\d+)" w:right="\d+" w:bottom="(\d+)"/)!;
      // 7 列＋（上邊界＋標題列與間距，Word 實測合計 24.4mm）＋下邊界＋表格後的段落
      const total = 7 * rowTw + mmToTwip(WORD_TOP_MM) + Number(mar[2]) + mmToTwip(0.35);
      expect(Number(mar[1]), '上邊界').toBeLessThanOrEqual(mmToTwip(WORD_TOP_MM));
      expect(total, `${paper} 總高 twips`).toBeLessThanOrEqual(Number(pg[2]));
    }
  });

  it('列印頁（PDF 路徑）：格高同 Word，7 列格子加上標題不碰到頁尾', () => {
    const f = makeFixture({ paper: 'B4' });
    f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth: 7, seatCount: 49 };
    const html = renderPrintHtml({ label: buildLabelPages(f, 'class') }, meta);
    const h = labelBoxMm({ paper: 'B4', cols: 7, rows: 7 }, 7).h;
    expect(html).toContain(`height:${+h.toFixed(2)}mm`);
    // 頁首 3mm＋標題列約 16mm（含 3mm 下距）＋ 7 列；頁尾在最下方 8mm 內，格子底不得超過紙高 353－10mm
    expect(3 + 16 + 7 * h).toBeLessThanOrEqual(353 - 10);
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

describe('自習參考座位頁標示第幾天、哪個時段（#386）', () => {
  const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;

  it('統計表的「自習人數」列本身就寫第幾天、時段與科目（只看那張表也知道是哪一節）', () => {
    const pg = buildSeatPages(real(), 'reserve').find((p) => p.roomName.includes('參考座位'))!;
    const label = pg.stats.table.rows[0]!.label;
    expect(label).toMatch(/^自習人數（第.天 時段.+國文）$/);
    // 頁首小標籤仍有同樣的天與時段
    expect(pg.chips.some((c) => /第.天 時段./.test(c))).toBe(true);
  });

  it('列較長時統計表高度已計入（statLayout 依文字寬度決定列高，不會被截掉）', () => {
    const pg = buildSeatPages(real(), 'reserve').find((p) => p.roomName.includes('參考座位'))!;
    const sl = statLayout(pg);
    expect(sl.rowH).toHaveLength(2);
    expect(sl.rowH[1]!).toBeGreaterThanOrEqual(8);
  });

  it('Word 與列印頁都有這串字', async () => {
    const seat = buildSeatPages(real(), 'reserve');
    const x = await (await JSZip.loadAsync(await renderDocx({ seat }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(x).toContain('自習人數（第一天 時段三、第二天 時段三');
    expect(renderPrintHtml({ seat }, meta)).toContain('自習人數（第一天 時段三、第二天 時段三');
  });
});
