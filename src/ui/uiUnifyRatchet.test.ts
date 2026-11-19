/**
 * UI 統一自動檢查（ratchet，#413；使用者 2026-11-19 在 UI 統一盤點稿 v2.72 十項全選 A）。
 * 掃 src/ui 的程式原始碼（不含測試）：已統一的項目不得退回；還沒全部統一的項目只准「變少」不准「變多」。
 * 要放寬任何一項，必須先經設計員與使用者同意並同步更新 docs/design/DESIGN.md〈10.41 全站同一種工作一種畫法〉，不是直接改這裡的數字。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'ui');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = walk(ROOT).map((p) => ({ rel: relative(ROOT, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }));

/** 去掉註解（// 與 块註解），只留會畫出來或執行的程式與字串 */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hits = (re: RegExp): string[] => FILES.flatMap((f) => (code(f.src).match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).map((m) => `${f.rel}：${m.trim().slice(0, 60)}`));

describe('#413 第 2 項：刪除確認一律標準 ConfirmModal／ConfirmButton', () => {
  it('不得用瀏覽器原生 confirm／alert／prompt', () => {
    expect(hits(/\bwindow\.(confirm|alert|prompt)\b|\b(?:globalThis|self)\.(confirm|alert|prompt)\b/)).toEqual([]);
  });
  it('不得要使用者輸入名稱或確認字樣才能刪除', () => {
    expect(hits(/輸入考試名稱確認|輸入考試名稱「|請輸入「|要刪除請輸入|deleteNameMatches|CLEAR_KEYWORD/)).toEqual([]);
  });
});

describe('#413 第 3 項：還原預設／重置常駐可按，點了先確認', () => {
  it('「還原預設」按鈕不得 disabled', () => {
    const bad = FILES.flatMap((f) => code(f.src).split('\n').filter((l) => /還原預設|還原成預設/.test(l) && /disabled=/.test(l)).map((l) => `${f.rel}：${l.trim().slice(0, 60)}`));
    expect(bad).toEqual([]);
  });
});

describe('#413 第 4 項：前往與返回的按鈕文字三種固定寫法', () => {
  it('跳到別頁寫「到 ○○ ›」，不再寫「前往 ○○」「去 ②」', () => {
    expect(hits(/前往 ?[①-⑥$]|'去 [①-⑥]|>去 [①-⑥]|>前往[^下<]|'前往處理/)).toEqual([]);
  });
  it('返回寫「← 回到 ○○」，不再寫「返回」按鈕字樣', () => {
    expect(hits(/>← 返回<|: '返回'\}|'← 返回'/)).toEqual([]);
  });
});

describe('#413 第 5 項：展開／收合只用「標題＋▾／▴」', () => {
  it('summary 與展開鈕的字不再用「展開／收合／檢查」開頭', () => {
    expect(hits(/<summary[^>]*>\s*(展開|收合)|' ?(收合|展開)' :|\? '收合'/)).toEqual([]);
  });
});

describe('#413 第 7 項：空白狀態用 EmptyState', () => {
  it('不得再用自寫小灰字寫「還沒有／目前沒有／沒有…」當空白狀態', () => {
    expect(hits(/<p class="small muted">(還沒有(?!名單或教室，指標)|目前沒有(?!模擬考使用這份名單)|這[一個][節個時][^<]{0,6}沒有|共用設定還沒有|每個時段所有人都考)/)).toEqual([]);
  });
});

describe('#413 第 8 項：開／關控制', () => {
  it('分科 ③ 的「允許自習去他班原班」「固定自習教室」用 Switch，不再是 aria-pressed 的文字切換鈕', () => {
    const f = FILES.find((x) => x.rel === 'ast/AstStep3.tsx')!;
    expect(code(f.src)).not.toMatch(/aria-pressed/);
    expect(code(f.src)).toMatch(/<Switch\b/);
  });
  it('原生 checkbox 只准「勾選項目」，數量不得增加（現況 14 處：含 Switch 自己內部那一個，及列表「選取」「全選」兩處——模擬考列表包 v2.74 指定的選取方塊）', () => {
    expect(hits(/type="checkbox"/).length).toBeLessThanOrEqual(14);
  });
});

describe('#413 第 10 項：窄寬度不用橫向捲軸', () => {
  it('class="scroll" 只准減少，不准增加（現況 23 處；改成卡片堆疊後逐步降到 0）', () => {
    expect(hits(/class="scroll[ "]/).length).toBeLessThanOrEqual(23);
  });
});
