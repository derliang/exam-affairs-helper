/**
 * 座位表與標籤的底色分類（使用者 2026-11-23 裁示，取代「依班級上色」）。
 * - 理組考國英數自然、文組考國英數社會＝一般考生，不上底色。
 * - 理組加考「數B」「社會」「兩者」、文組加考「數A」「自然」「兩者」＝六種底色；班級代表色不再用在座位表與標籤。
 * - 黑白列印也要分得出：同組三種底色的灰階亮度彼此相差 ≥ 20（colors 測試把關），標示文字另外印在格內。
 * 只有學測有文理組與數A／數B；分科、會考與沒有文理組的班級一律不上色。純函式。
 */
import type { Track } from '../data';

export type SeatKind = 'general' | 'sci-b' | 'sci-soc' | 'sci-both' | 'lib-a' | 'lib-sci' | 'lib-both';

export interface SeatKindInfo {
  /** 圖例用文字 */
  label: string;
  /** 匯出用色碼（不含 #）：底／線／字；UI 用 tokens.css 的 --sk-* 同一組色 */
  bg: string;
  line: string;
  fg: string;
}

export const SEAT_KINDS: Record<SeatKind, SeatKindInfo> = {
  general: { label: '一般考生（沒有底色）', bg: 'FFFFFF', line: '222222', fg: '22201B' },
  'sci-b': { label: '理組加考數B', bg: 'D6E8FA', line: '6E9BD0', fg: '17406E' },
  'sci-soc': { label: '理組加考社會', bg: 'F2C27A', line: 'C58A2E', fg: '5E3A00' },
  'sci-both': { label: '理組加考數B＋社會', bg: 'A58CD8', line: '6F55B0', fg: '2A1A5C' },
  'lib-a': { label: '文組加考數A', bg: 'D3EFD1', line: '78B574', fg: '1F5A1A' },
  'lib-sci': { label: '文組加考自然', bg: 'F0B0C8', line: 'C9638C', fg: '6E1636' },
  'lib-both': { label: '文組加考數A＋自然', bg: '6FB5AF', line: '3F8680', fg: '0B3B37' },
};

/** 圖例與測試用的固定順序 */
export const SEAT_KIND_ORDER: SeatKind[] = ['general', 'sci-b', 'sci-soc', 'sci-both', 'lib-a', 'lib-sci', 'lib-both'];

/** 各組「加考」才算特別的兩科：理組＝數B、社會；文組＝數A、自然（科目 id） */
const EXTRA_IDS: Record<Track, [string, string]> = { science: ['math-b', 'social'], liberal: ['math-a', 'science'] };

/** 依文理組與「加考」的科目 id 算出底色分類；沒有文理組（分科、會考、國中）或沒加考這兩科＝一般 */
export function seatKindOf(track: Track | undefined, extraSubjectIds: Iterable<string>): SeatKind {
  if (!track) return 'general';
  const ids = new Set(extraSubjectIds);
  const [first, second] = EXTRA_IDS[track];
  const a = ids.has(first);
  const b = ids.has(second);
  if (!a && !b) return 'general';
  if (track === 'science') return a && b ? 'sci-both' : a ? 'sci-b' : 'sci-soc';
  return a && b ? 'lib-both' : a ? 'lib-a' : 'lib-sci';
}

/** 一張圖裡出現過的非一般分類（依固定順序），圖例只列這些；沒有就不印圖例 */
export function legendKindsOf(kinds: Iterable<SeatKind>): SeatKind[] {
  const set = new Set(kinds);
  return SEAT_KIND_ORDER.filter((k) => k !== 'general' && set.has(k));
}
