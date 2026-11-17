import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import type { FolderPick } from '../data';
import { DiscardDialog, FolderCard, FolderListError, FolderLostAlert, RestoreMissing, changeOptions } from './pages/FolderUi';
import { NewExam } from './pages/NewExam';
import { Init } from './pages/Init';
import { createMemoryRepository, demoDoc } from './repository';

const css = readFileSync('src/styles/app.css', 'utf8');
const noop = () => undefined;
const pick = (kind: FolderPick['kind'], extra: Partial<FolderPick> = {}): FolderPick => ({ name: '新資料夾', kind, exams: 0, rosters: 0, handle: {} as never, ...extra });

describe('G16 找不到資料夾：白話說明與出路', () => {
  it('警告：寫出資料夾名稱與 N 項未存，三個出路都在，英文原文只在「技術細節」', () => {
    const html = renderToString(<FolderLostAlert name="模擬考資料" pending={5} onRelink={noop} onChange={noop} onDiscard={noop} onSettings={noop} />);
    expect(html).toContain('找不到資料夾「模擬考資料」');
    expect(html).toContain('可能被刪除、改名或移到別處了');
    expect(html).toContain('有 5 項修改還沒存進去');
    for (const t of ['重新連結', '更換資料夾', '放棄未存的修改…', '技術細節']) expect(html).toContain(t);
    expect(html).not.toContain('A requested file');
    expect(html).not.toContain('重試存檔'); // 紅、黃兩條合併，不再要人「重試」
  });
  it('列表區：顯示「讀不到資料夾，所以無法顯示模擬考」，不是「還沒有模擬考」', () => {
    const html = renderToString(<FolderListError onRelink={noop} />);
    expect(html).toContain('讀不到資料夾，所以無法顯示模擬考');
    expect(html).toContain('這不代表資料被刪掉了');
    expect(html).not.toContain('還沒有模擬考');
  });
  it('啟動時上次的資料夾找不到：同樣白話提示，兩個出路', () => {
    const html = renderToString(<RestoreMissing name="模擬考資料" onRelink={noop} onOther={noop} />);
    expect(html).toContain('找不到上次使用的資料夾');
    expect(html).toContain('你的資料沒有消失');
    expect(html).toContain('重新連結');
    expect(html).toContain('選另一個資料夾');
  });
  it('Init：沒有資料夾且啟動還原失敗時顯示該說明（有 fs 的實作才有 restoreProblem）', () => {
    const fs = { restoreProblem: () => ({ kind: 'missing' as const, name: '舊資料夾' }), hasFolder: () => false } as never;
    const html = renderToString(<Init repo={createMemoryRepository()} fsSupported fs={fs} doc={demoDoc()} onDialog={noop} onDone={noop} />);
    expect(html).toContain('找不到上次使用的資料夾');
    expect(html).toContain('舊資料夾');
  });
  it('放棄前二次確認：列出會丟掉什麼、備份預設勾選', () => {
    const html = renderToString(<DiscardDialog pending={2} lost={['教室調整', '名單匯入']} onBackup={noop} onConfirm={noop} onClose={noop} />);
    expect(html).toContain('「教室調整」、「名單匯入」');
    expect(html).toMatch(/type="checkbox"[^>]*checked|checked[^>]*type="checkbox"/);
    expect(html).toContain('先把暫存內容下載成備份檔');
  });
  it('更換資料夾時暫存修改的選項：空資料夾可帶過去；已有資料或其他內容只能放棄（不合併）；讀不了的不能用', () => {
    expect(changeOptions(pick('empty'), 3)).toBe('carry-or-discard');
    expect(changeOptions(pick('app', { exams: 2 }), 3)).toBe('discard-only');
    expect(changeOptions(pick('other'), 3)).toBe('discard-only');
    expect(changeOptions(pick('app', { problem: '版本較新' }), 3)).toBe('blocked');
    expect(changeOptions(pick('app'), 0)).toBe('none');
  });
});

describe('G24 資料夾設定頁「目前資料夾」卡片', () => {
  const base = { name: '模擬考資料', pending: 0, exams: 3, rosters: 2, onRelink: noop, onChange: noop, onMove: noop };
  it('正常：名稱、狀態、最後存檔、內容與三個動作各一句話', () => {
    const html = renderToString(<FolderCard {...base} missing={false} lastSaved={new Date('2026-11-17T06:32:00Z')} />);
    for (const t of ['目前資料夾', '正常', '模擬考資料', '2026-11-17 14:32（台北）', '3 場模擬考、學生名單 2 份', '找回原本那份', '改用另一份資料', '把目前這份帶到別處', '三種操作都不會刪除任何資料夾']) expect(html).toContain(t);
    expect(html).not.toMatch(/disabled/);
  });
  it('找不到：狀態改為找不到、搬到新位置停用並說明', () => {
    const html = renderToString(<FolderCard {...base} missing pending={5} />);
    expect(html).toContain('找不到');
    expect(html).toContain('有 5 項修改');
    expect(html).toContain('沒有東西可以複製：請先「重新連結」');
    expect(html).toMatch(/disabled[^>]*>搬到新位置/);
  });
  it('已選資料夾的資料夾設定頁顯示卡片、沒有選擇資料夾的拖放區', () => {
    const fs = { folderName: () => '模擬考資料', pendingCount: () => 0, lastSavedAt: () => undefined, restoreProblem: () => undefined, hasFolder: () => true } as never;
    const repo = { ...createMemoryRepository(), hasFolder: () => true };
    const html = renderToString(<Init repo={repo} fsSupported fs={fs} doc={demoDoc()} onDialog={noop} onBack={noop} onDone={noop} />);
    expect(html).toContain('目前資料夾');
    expect(html).not.toContain('將資料夾拖曳至此');
  });
});

describe('G17 新增模擬考「次別」：多列格子', () => {
  const html = renderToString(<NewExam doc={demoDoc()} onCancel={noop} onCreate={noop} now={() => new Date('2026-11-17T00:00:00+08:00')} />);
  it('學測：至少四格的格子（不是橫向分段按鈕），說明在格子下方', () => {
    expect(html).toContain('roundgrid');
    expect((html.match(/class="rbtn"/g) ?? []).length + (html.match(/class="rbtn" aria-pressed/g) ?? []).length).toBeGreaterThanOrEqual(4);
    for (const t of ['第一次', '第二次', '第三次', '第四次']) expect(html).toContain(t);
    expect(html.indexOf('roundgrid')).toBeLessThan(html.indexOf('第 1、2 次數學是單一科'));
    expect(html).not.toContain('class="seg"');
  });
  it('格子不捲動：整列寬、自動換行、手機單欄；沒有 overflow-x', () => {
    expect(css).toMatch(/\.roundgrid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(/);
    expect(css).toContain('.newgrid-wide{grid-column:1/-1}');
    expect(css).toMatch(/@media \(max-width:640px\)\{\.newgrid\{grid-template-columns:minmax\(0,1fr\)\}/);
    const block = css.slice(css.indexOf('/* G17'));
    expect(block).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });
});
