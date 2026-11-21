/** Issue #504：標籤外框完整、長角標不蓋住姓名（假資料，不含真實姓名） */
import { describe, expect, it } from 'vitest';
import { labelCornerFit, labelBoxMm, textWidthMm, type CellModel } from './model';
import { buildLabelPages, renderPrintHtml } from './index';
import { makeFixture } from './fixtures';

const cell = (corners: CellModel['corners']): CellModel =>
  ({ coord: '1-1', code: '0101', classLabel: '勤', name: '丙生王', colorBg: 'FFFFFF', colorFg: '000000', corners }) as CellModel;

describe('標籤有角標時的版面（#504）', () => {
  const box = { w: 27, h: 35 };
  const long = cell([{ kind: 'detach', text: '抽離 數A、自然 考試' } as never]);
  it('編號＋姓名＋角標帶放得進格高，編號不低於 14pt', () => {
    const f = labelCornerFit(long, box.w, box.h, 31, 11);
    const nameMm = f.namePt * 0.3528 * 1.15;
    expect(f.codePt).toBeGreaterThanOrEqual(14);
    expect(5 + f.codePt * 0.3528 + 2.6 + nameMm + f.bandMm).toBeLessThanOrEqual(box.h + 0.01);
  });
  it('長抽離小牌分兩行，帶高隨行數增加；沒有角標時帶高為 0', () => {
    const two = labelCornerFit(long, box.w, box.h, 31, 11);
    expect(two.lines.length).toBeGreaterThanOrEqual(2);
    expect(labelCornerFit(cell([]), box.w, box.h, 31, 11).bandMm).toBe(0);
    expect(textWidthMm('抽離', 11, true)).toBeGreaterThan(0);
  });
  it('PDF 空位格保留外框（不再 border:none），格尺寸可算', () => {
    const pages = buildLabelPages(makeFixture());
    const html = renderPrintHtml({ label: pages }, { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' });
    expect(html).not.toContain('.pp-c.pp-bl{border:none');
    expect(html).toContain('.pp-c.pp-bl{background:none}');
    const b = labelBoxMm(pages[0]!.layout, 7, 0, 7);
    expect(b.w).toBeGreaterThan(0);
  });
});
