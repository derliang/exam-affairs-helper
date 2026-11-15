import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMany, wordNoticeText } from './Step6';
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
