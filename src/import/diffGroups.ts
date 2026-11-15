/**
 * 名單比對差異分組（Issue #201）：
 * A 缺字／子字串相似（建議視為同一人）、B 座號相同但姓名完全不同（可能不是同一人）、C 缺漏（只在一邊）。
 * 純邏輯：不改 compareRosters 的輸出，畫面端再依分組顯示與批次套用。
 */
import type { RosterDiff, RosterDiffChoice } from '../data/types';

export type DiffGroup = 'A' | 'B' | 'C';

/** 一個姓名是另一個的子字串（含相同）就算缺字／相似 */
export function nameSimilar(a: string, b: string): boolean {
  const x = a.trim(), y = b.trim();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** 只分類「姓名不同」與缺漏；組別不同、整班新增不屬於這三組，回傳 null */
export function classifyDiff(d: RosterDiff): DiffGroup | null {
  if (d.kind === 'only-in-exam' || d.kind === 'only-in-roster') return 'C';
  if (d.kind !== 'mismatch' || !d.exam || !d.roster) return null;
  // 同名換班級／座號（姓名相同）是同一人，歸 A
  if (d.exam.name.trim() === d.roster.name.trim()) return 'A';
  if (nameSimilar(d.exam.name, d.roster.name)) return 'A';
  return 'B';
}

export interface GroupedDiffs {
  A: RosterDiff[];
  B: RosterDiff[];
  C: RosterDiff[];
  other: RosterDiff[];
}

export function groupDiffs(diffs: readonly RosterDiff[]): GroupedDiffs {
  const out: GroupedDiffs = { A: [], B: [], C: [], other: [] };
  for (const d of diffs) out[classifyDiff(d) ?? 'other'].push(d);
  return out;
}

/** 整組套用某一邊（use-exam／use-roster）：覆蓋該組內所有差異的選擇，不動其他組 */
export function applyGroupChoice(diffs: readonly RosterDiff[], group: DiffGroup, choice: Extract<RosterDiffChoice, 'use-exam' | 'use-roster'>): RosterDiff[] {
  return diffs.map((d) => {
    if (classifyDiff(d) !== group) return d;
    const { edited: _e, ...rest } = d;
    return { ...rest, choice };
  });
}
