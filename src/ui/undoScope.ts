/** 復原的領域（#568）：模擬考、補考、共用設定各自一條，互不看見、互不退 */
import type { Doc } from './store';

export type UndoScope = 'exam' | 'makeup' | 'settings';
export const UNDO_SCOPES: UndoScope[] = ['exam', 'makeup', 'settings'];

/** 每個領域管的 Doc 欄位 */
const KEYS: Record<UndoScope, (keyof Doc)[]> = {
  exam: ['exams', 'examFiles'],
  makeup: ['makeups'],
  settings: ['settings', 'rosters', 'rosterYear', 'otherYears'],
};

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** 這次變更動到哪些領域（至少一個；都沒變回空陣列） */
export function docScopes(prev: Doc, next: Doc): UndoScope[] {
  return UNDO_SCOPES.filter((sc) => KEYS[sc].some((k) => !same(prev[k], next[k])));
}

/** 取 state 的指定領域貼到 present（其餘領域維持現況；state 沒有的欄位就刪掉） */
export function sliceDoc(present: Doc, state: Doc, scopes: string[]): Doc {
  const out: Doc = { ...present };
  for (const sc of scopes) for (const k of KEYS[sc as UndoScope] ?? []) {
    const v = state[k];
    if (v === undefined) delete (out as unknown as Record<string, unknown>)[k];
    else (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** 目前所在頁面的復原領域 */
export const scopeOfPage = (page: string): UndoScope => (page === 'makeup' || page.startsWith('makeup') ? 'makeup' : page === 'settings' ? 'settings' : 'exam');
