import { describe, expect, it, vi } from 'vitest';
import type { ExamConfig } from '../data';
import type { Doc } from './store';

vi.mock('./seating', async (orig) => ({
  ...(await orig<typeof import('./seating')>()),
  detachPreview: () => ({ ok: false, errors: ['自然：抽離考試用掉部分預備教室後，剩下的座位不足以容納抽離自習 1 人'] }),
}));

describe('預備教室不足訊息（#204）', () => {
  it('detail 不含前綴；message 只有一個前綴', async () => {
    const { reserveCheck } = await import('./capacity');
    const r = reserveCheck({} as Doc, { kind: 'gsat' } as ExamConfig);
    expect(r.tone).toBe('warn');
    expect(r.message.match(/預備教室座位不足：/g)).toHaveLength(1);
    expect(r.detail).not.toContain('預備教室座位不足：');
    expect(r.detail).toContain('自然');
  });
});
