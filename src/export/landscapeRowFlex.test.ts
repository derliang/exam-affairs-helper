/** #551 橫式表列高：列數少（列高沒被擠壓）時 Word 用「至少」，格內折行不被切；列數多時維持固定以便一頁放得下。全部假資料。 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { landscapeRowsFlex, renderDocx, type TablePageModel } from './index';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-21T08:30:00Z', dataVersion: 'A1B2C3D4' };
const page = (n: number): TablePageModel => ({
  kind: 'table', landscape: true, title: '補考考程表', heads: ['考日', '時段一'], widths: [2, 4],
  rows: Array.from({ length: n }, (_, i) => [`第 ${i} 列`, '09:00–09:50　生物 4 人次＋化學 9 人次＋英文 10 人次＋物理 3 人次＋國文 5 人次（教室 R3 34）']),
});
const rules = async (n: number): Promise<string[]> => {
  const z = await JSZip.loadAsync(await renderDocx({ table: [page(n)] }, { fonts, ...meta }));
  const x = await z.file('word/document.xml')!.async('string');
  return [...x.matchAll(/w:hRule="(\w+)"/g)].map((m) => m[1]!);
};

describe('橫式表列高能不能長高（#551）', () => {
  it('列數少＝能長高，列數多＝固定', () => {
    expect(landscapeRowsFlex(5, 1)).toBe(true);
    expect(landscapeRowsFlex(19, 1)).toBe(true); // 163/20 ≈ 8.15 ≥ 8
    expect(landscapeRowsFlex(20, 1)).toBe(false); // 163/21 ≈ 7.8 < 8
    expect(landscapeRowsFlex(45, 1)).toBe(false);
  });
  it('Word：列數少用 atLeast（折兩行不被切），列數多維持 exact', async () => {
    const few = await rules(4);
    expect(few).toContain('atLeast');
    expect(few).not.toContain('exact');
    const many = await rules(40);
    expect(many).toContain('exact');
    expect(many).not.toContain('atLeast');
  });
});
