import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('#466 各班人數那列不被擠成兩行', () => {
  it('標題獨立一行；每個班與「合計」標不拆開', () => {
    const src = readFileSync('src/ui/pages/Step2.tsx', 'utf8');
    const i = src.indexOf('id="x-perclass"');
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 1200);
    expect(block).toContain('各班人數');
    expect((block.match(/white-space:nowrap/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
