/** 稿 v2.99（D207、DESIGN §10.58）：窄寬斷行規則寫在 app.css 的守門測試（實際斷行量測在設計員驗收腳本，這裡只擋規則被刪） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('窄寬斷行規則（D207）', () => {
  it('R6 全站中文只在標點空白換行，輸入欄與程式碼不受影響', () => {
    expect(css).toContain('body{word-break:keep-all;line-break:strict;overflow-wrap:break-word}');
    expect(css).toContain('code,pre,kbd,samp,textarea,input{word-break:normal;overflow-wrap:anywhere}');
  });
  it('R7 學生名單寬版不換行、容器 ≤900px 小卡內一律可換行', () => {
    expect(css).toContain('.t.rt-t.rt-keep td:not(.small),.t.rt-t.rt-keep th{white-space:nowrap}');
    expect(css).toMatch(/@container \(max-width:900px\)\{\.t\.rt-t\.rt-keep td:not\(\.small\),\.t\.rt-t\.rt-keep td\.small\{white-space:normal;min-width:0\}\}/);
  });
  it('R8 節次與時長一天一欄的門檻是 1000px', () => {
    expect(css).toContain('@media (max-width:1000px){.tt{grid-template-columns:1fr}}');
  });
  it('R9 ≤560px 長按鈕可換行、不超出容器', () => {
    expect(css).toMatch(/@media \(max-width:560px\)\{\.btn\{max-width:100%;white-space:normal;height:auto/);
  });
});
