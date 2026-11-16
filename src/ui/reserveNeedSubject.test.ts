import { describe, expect, it, vi } from 'vitest';
import type { ExamConfig } from '../data';
import type { Doc } from './store';

// #263：預備教室不足時，狀態卡（reserveNeed.who）要點名「第一個放不下的節次」，與排座回報的第一個錯誤同一科
vi.mock('./seating', async (orig) => ({
  ...(await orig<typeof import('./seating')>()),
  examRooms: () => [{ kind: 'reserve', seatCount: 10 }],
  effectiveMarkRules: () => ({ rules: [] }),
  seatableEntries: () => [],
  examClasses: () => [],
  examOverrides: () => [],
}));
vi.mock('./rooms', () => ({ roomsOfDivision: () => [{ kind: 'reserve' }] }));
vi.mock('../core', async (orig) => ({
  ...(await orig<typeof import('../core')>()),
  // 自然 15 人、數學A 38 人，都超過 10 個座位
  applyMarks: () => [
    ...Array.from({ length: 15 }, (_, i) => ({ code: `n${i}`, subjectId: 'nat', mode: 'extra' })),
    ...Array.from({ length: 38 }, (_, i) => ({ code: `m${i}`, subjectId: 'ma', mode: 'extra' })),
  ],
}));
vi.mock('../core/detach', async (orig) => ({
  ...(await orig<typeof import('../core/detach')>()),
  periodGroups: () => [{ subjectIds: ['nat'], periods: [1] }, { subjectIds: ['ma'], periods: [2] }],
}));
vi.mock('../core/periods', () => ({ examSubjectPeriods: () => new Map() }));

describe('預備教室不足：卡片與訊息同一科（#263）', () => {
  it('兩節都放不下時點名第一個放不下的「自然」，不是人數最多的「數學A」', async () => {
    const { reserveNeed } = await import('./capacity');
    const exam = { kind: 'gsat', division: 'senior', subjects: [{ id: 'nat', name: '自然' }, { id: 'ma', name: '數學A' }] } as unknown as ExamConfig;
    const n = reserveNeed({ settings: { classrooms: [], classes: [] }, exams: [] } as unknown as Doc, exam);
    expect(n.who).toBe('自然');
    expect(n.need).toBe(15);
    expect(n.need).toBeGreaterThan(n.avail);
  }, 30000);
});
