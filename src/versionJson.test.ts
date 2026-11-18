import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// public/version.json 是對外（teacher-hub 卡片）讀的版號，要跟 package.json 同一版；
// 1.26.6～1.26.8 曾漏改，正式站讀到舊版號。
describe('public/version.json 與 package.json 版號一致', () => {
  it('version 相同', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const pub = JSON.parse(readFileSync('public/version.json', 'utf8')) as { version: string; releaseDate: string };
    expect(pub.version).toBe(pkg.version);
    expect(pub.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
