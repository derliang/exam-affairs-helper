import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderDocx, wideLabelLayout } from './index';
import type { LabelPageModel } from './model';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };
const SUBJ = ['物理', '化學', '數甲', '生物', '歷史', '地理', '公民', '英文'];

function page(paper: "B4" | "A3", n: number, nSub: number, grid?: { cols: number; rows: number }, roomName = '綜合教室'): LabelPageModel {
  const persons = Array.from({ length: n }, (_, i) => ({
    code: String(100 + i).padStart(4, '0'), classLabel: '溫', name: `甲生${i}`,
    sched: SUBJ.slice(0, nSub).map((s, k) => `第一天 時段${k} ${s}`), schedShort: SUBJ.slice(0, nSub),
  }));
  return {
    kind: 'label', title: '整合標籤', examName: '測試', roomName: roomName, layout: wideLabelLayout(paper), notes: [], grid,
    cells: [{ coord: '1-1', seat: { row: 1, depth: 1 }, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [], persons }],
  } as LabelPageModel;
}

describe('#622 兩倍寬整合標籤：多人共用格不得產生負值', () => {
  for (const paper of ['B4', 'A3'] as const)
    for (const grid of [undefined, { cols: 1, rows: 7 }]) for (const n of [2, 3]) for (const nSub of [1, 8])
      it(`${paper} ${JSON.stringify(grid)} ${n} 人 ${nSub} 科`, async () => {
        const buf = await renderDocx({ label: [page(paper, n, nSub, grid)] }, { fonts, ...meta });
        expect(buf.byteLength).toBeGreaterThan(1000);
      });
});

describe('#622 根因：只剩 1 排的標籤頁，頁首教室牌比表格寬', () => {
  for (const paper of ['B4', 'A3'] as const)
    it(`${paper} 教室名很長＋整合標籤（第 3／3 張）＋只有 1 排`, async () => {
      const long = '綜合教室甲乙丙丁戊己　整合標籤（第 3／3 張）';
      const buf = await renderDocx({ label: [page(paper, 3, 2, { cols: 1, rows: 7 }, long)] }, { fonts, ...meta });
      expect(buf.byteLength).toBeGreaterThan(1000);
    });
});

import JSZip from 'jszip';
import { subsetTtf, glyphBytesOf } from './fontSubset';
import { buildSeatPages } from './index';
import { makeFixture } from './fixtures';

describe('#630 字型只內嵌用到的字形', () => {
  it('子集後：用到的字形不變、沒用到的清空、檔案很小', () => {
    const sub = subsetTtf(fonts.regular, new Set('考務小幫手ABC'));
    expect(sub.byteLength).toBeLessThan(400_000);
    for (const ch of '考務小幫手ABC') expect(Math.abs(glyphBytesOf(sub, ch) - glyphBytesOf(fonts.regular, ch))).toBeLessThanOrEqual(3); // 4 位元組對齊的補位
    expect(glyphBytesOf(sub, '考')).toBeGreaterThan(0);
    expect(glyphBytesOf(sub, '鑫')).toBe(0);
    expect(glyphBytesOf(fonts.regular, '鑫')).toBeGreaterThan(0);
  });
  it('座位表 Word 檔不再是 4MB，且字型表仍在', async () => {
    const buf = await renderDocx({ seat: buildSeatPages(makeFixture()) }, { fonts, ...meta });
    expect(buf.byteLength).toBeLessThan(900_000);
    const z = await JSZip.loadAsync(buf);
    expect(Object.keys(z.files).some((n) => n.startsWith('word/fonts/'))).toBe(true);
  });
});

import { buildLabelPages } from './index';
describe('#625 學校名稱印在座位表與標籤頁首', () => {
  it('座位表、標籤的 Word 與列印頁都有校名；沒填就不印', async () => {
    const f = makeFixture();
    f.settings.schoolName = '○○中學';
    const xml = async (pg: Parameters<typeof renderDocx>[0]) => (await JSZip.loadAsync(await renderDocx(pg, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(await xml({ seat: buildSeatPages(f) })).toContain('○○中學');
    expect(await xml({ label: buildLabelPages(f, 'class') })).toContain('○○中學');
    f.settings.schoolName = '';
    expect(await xml({ seat: buildSeatPages(f) })).not.toContain('○○中學');
  });
  it('表頭範本自己已寫校名時不重複', async () => {
    const { titleOf } = await import('./index');
    expect(titleOf({ examName: 'x', heading: '○○中學 模擬考', school: '○○中學' })).toBe('○○中學 模擬考');
    expect(titleOf({ examName: 'x', heading: '模擬考', school: '○○中學' })).toBe('○○中學　模擬考');
  });
});

import { tableModelPages, tablePages } from './pageEstimate';
describe('#632 預告頁數：長表要算接下去的頁', () => {
  const t = (n: number, landscape = false) => ({ landscape, rows: Array.from({ length: n }, () => ['x']), heads: ['a'], headGroups: undefined, totalRow: undefined });
  it('直式 100 列不是 1 頁；橫式一班一頁', () => {
    expect(tableModelPages(t(100))).toBe(tablePages(100));
    expect(tableModelPages(t(100))).toBeGreaterThan(4);
    expect(tableModelPages(t(45, true))).toBe(1);
    expect(tableModelPages(t(0))).toBe(1);
  });
});
