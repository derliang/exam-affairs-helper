import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMany, noticeOf, wordButtonHint, wordNoticeText } from './Step6';
import { alignmentExport } from '../featureRegister/alignment';
import type { OutputFile } from '../../export/plan';

const f = (name: string): OutputFile => ({ name, desc: '', mime: 'application/octet-stream', data: new Uint8Array([1]) } as OutputFile);

describe('多檔下載（#203）', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('提示文字不宣稱「已下載 N 個」，多檔時提醒允許多檔下載並請核對', () => {
    const t = wordNoticeText(4);
    expect(t).not.toMatch(/已下載/);
    expect(t).toContain('允許');
    expect(t).toContain('4 個檔案');
    expect(wordNoticeText(1)).not.toMatch(/已下載/);
  });

  it('#358 列印頁（對位測試頁）不算成下載檔：4 個 Word＋1 個列印頁，提示分開寫', () => {
    const out = [f('a.docx'), f('b.docx'), f('c.docx'), f('d.docx'), { name: '列印對位測試頁-列印用頁面.html', desc: '', mime: 'text/html', data: '<p/>' } as OutputFile];
    const t = noticeOf(out);
    expect(t).toContain('已送出 4 個下載要求');
    expect(t).toContain('確認 4 個檔案都在');
    expect(t).toContain('另有 1 個列印頁已在新分頁開啟');
    expect(t).not.toContain('5 個');
    expect(wordButtonHint(4, 1)).toBe('將下載 4 個 Word 檔案，另在新分頁開啟 1 個列印頁');
    expect(wordButtonHint(5, 0)).toBe('將下載 5 個 Word 檔案');
    expect(wordButtonHint(0, 1)).toBe('將在新分頁開啟 1 個列印頁（不存檔）');
    expect(wordNoticeText(0, 1)).toMatch(/^已在新分頁開啟 1 個列印頁/);
    expect(wordNoticeText(4)).toBe(wordNoticeText(4, 0));
  });

  it('#358 對位測試頁登記為「只產生列印頁」', () => {
    expect(alignmentExport.printPageOnly).toBe(true);
  });

  it('逐檔下載、每檔之間有間隔（不同一瞬間連續觸發）', async () => {
    const clicks: number[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click: () => { clicks.push(Date.now()); } }) });
    await downloadMany([f('a'), f('b'), f('c')], 30);
    expect(clicks).toHaveLength(3);
    expect(clicks[1]! - clicks[0]!).toBeGreaterThanOrEqual(25);
    expect(clicks[2]! - clicks[1]!).toBeGreaterThanOrEqual(25);
  });
});
