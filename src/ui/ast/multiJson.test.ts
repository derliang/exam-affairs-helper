import { describe, expect, it } from 'vitest';
import type { AstVersion } from '../../data';
import { finishJson, groupJsonFiles } from './multiJson';

const ver = (n: number, reason = 'r'): AstVersion => ({ n, at: '2026-11-01T08:00:00Z', changes: '', affected: { students: 0, rooms: [] }, reason, snap: { exams: [], study: [] }, code: `c${n}` });
const seat = (code: string, row: number) => ({ code, roomId: 'R1', row, depth: 1 });

describe('#506 分科 JSON 多檔合併', () => {
  it('不同檔案各有不同版本與座位：無衝突，版本依版本號排序', () => {
    const g = groupJsonFiles([
      { name: 'a.json', value: { versions: [ver(2)], seats: [seat('0101', 1)] } },
      { name: 'b.json', value: { versions: [ver(1), ver(3)], seats: [seat('0102', 2)] } },
    ]);
    expect(g.conflicts).toEqual([]);
    const m = finishJson(g, {});
    expect(m.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(m.seats.map((s) => s.code)).toEqual(['0101', '0102']);
  });
  it('跨檔同一版本號、同一位考生座位不同：列為衝突，沒決定不能完成；決定後照決定', () => {
    const g = groupJsonFiles([
      { name: 'a.json', value: { versions: [ver(1, 'A')], seats: [seat('0101', 1)] } },
      { name: 'b.json', value: { versions: [ver(1, 'B')], seats: [seat('0101', 5)] } },
    ]);
    expect(g.conflicts.map((c) => c.key).sort()).toEqual(['s:0101', 'v:1']);
    expect(finishJson(g, {}).ready).toBe(false);
    const m = finishJson(g, { 'v:1': 1, 's:0101': 0 });
    expect(m.ready).toBe(true);
    expect(m.versions[0]!.reason).toBe('B');
    expect(m.seats[0]!.row).toBe(1);
  });
  it('同一檔內重複：也要問', () => {
    const g = groupJsonFiles([{ name: 'a.json', value: { versions: [], seats: [seat('0101', 1), seat('0101', 2)] } }]);
    expect(g.conflicts).toHaveLength(1);
  });
});
