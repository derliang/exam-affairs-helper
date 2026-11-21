/**
 * 復原機制（UI-05／TODO-07，DESIGN 10.1）：快照式，最多 20 步，Ctrl+Z 同效。泛型、不碰 DOM。
 * 每一步都記「做了什麼」（label），按鈕才能寫「↶ 復原：新增學生」，不再顯示累計數字。
 */
export const UNDO_LIMIT = 20;

/** 一步：state 是這個動作「之前」的快照，label 是這個動作的名稱 */
/** scopes：這一步動到哪些領域（#568）；沒有＝舊式整份快照，所有領域都看得到 */
export interface UndoEntry<T> { state: T; label: string; scopes?: string[] }

export interface History<T> {
  past: UndoEntry<T>[];
  present: T;
}

export const DEFAULT_LABEL = '上一個動作';

export const newHistory = <T>(present: T): History<T> => ({ past: [], present });

/**
 * 與 JSON.stringify(a) === JSON.stringify(b) 同義（值為 undefined 的欄位視同沒有），但同一個參照直接視為相等，
 * 所以不可變更新時只比到真正有變的子樹，不必每次輸入都序列化整份 Doc（#72）。資料只含 JSON 型別。
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
  if (ka.length !== Object.keys(ob).filter((k) => ob[k] !== undefined).length) return false;
  for (const k of ka) if (!(k in ob) || !jsonEqual(oa[k], ob[k])) return false;
  return true;
}

/** 套用一次變更；內容沒變就不記一步 */
export function commit<T>(h: History<T>, next: T, label: string = DEFAULT_LABEL, limit = UNDO_LIMIT, scopes?: string[]): History<T> {
  if (jsonEqual(next, h.present)) return h;
  const past = [...h.past, { state: h.present, label, ...(scopes && scopes.length > 0 ? { scopes } : {}) }];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;

/** 下一次復原會退掉哪個動作（沒有就 undefined） */
export const nextUndoLabel = <T>(h: History<T>): string | undefined => h.past[h.past.length - 1]?.label;

/** 可回頭的步驟，最新的在前（供「回到某一步」選單用） */
export const undoSteps = <T>(h: History<T>): { index: number; label: string }[] =>
  h.past.map((e, index) => ({ index, label: e.label })).reverse();

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev.state };
}

/**
 * 直接回到第 index 步「之前」的狀態（0 = 最早）。比它新的步驟一併退掉，所以只回傳
 * 被退掉的動作名稱（新到舊），畫面據此標示「已過期」並提醒。
 */
export function undoTo<T>(h: History<T>, index: number): { history: History<T>; dropped: string[] } {
  const target = h.past[index];
  if (target === undefined) return { history: h, dropped: [] };
  return {
    history: { past: h.past.slice(0, index), present: target.state },
    dropped: h.past.slice(index).map((e) => e.label).reverse(),
  };
}

/* ---------- 依領域復原（#568）：模擬考、補考、共用設定各自只看得到、只退自己領域的步驟 ---------- */

/** 取 state 裡指定領域的那部分，貼到 present 上（其餘領域維持現況） */
export type Slicer<T> = (present: T, state: T, scopes: string[]) => T;

const sees = <T>(e: UndoEntry<T>, scope: string): boolean => !e.scopes || e.scopes.includes(scope);

/** 這個領域下一次復原會退掉哪個動作 */
export function nextUndoLabelIn<T>(h: History<T>, scope: string): string | undefined {
  for (let i = h.past.length - 1; i >= 0; i--) if (sees(h.past[i]!, scope)) return h.past[i]!.label;
  return undefined;
}

export const canUndoIn = <T>(h: History<T>, scope: string): boolean => nextUndoLabelIn(h, scope) !== undefined;

/** 這個領域可回頭的步驟，最新在前；index 是在整個堆疊裡的位置（交給 undoToIn） */
export const undoStepsIn = <T>(h: History<T>, scope: string): { index: number; label: string }[] =>
  h.past.map((e, index) => ({ index, label: e.label, ok: sees(e, scope) })).filter((x) => x.ok).map(({ index, label }) => ({ index, label })).reverse();

/** 把這些領域從 entry 的 scopes 拿掉；拿光就整步消失。沒有 scopes 的舊式步驟整步消失 */
const without = <T>(e: UndoEntry<T>, gone: string[]): UndoEntry<T> | undefined => {
  if (!e.scopes) return undefined;
  const left = e.scopes.filter((x) => !gone.includes(x));
  return left.length > 0 ? { ...e, scopes: left } : undefined;
};

/**
 * 退掉這個領域最新的一步：只把該領域的資料還原成那一步之前，其他領域（例如補考）不動。
 * 一步同時動到多個領域時，另一個領域在它之後沒有更新的步驟，就一併還原（兩邊資料才對得上）；否則只退自己這一邊，另一邊留在堆疊裡。
 */
export function undoIn<T>(h: History<T>, scope: string, slice: Slicer<T>, all: string[]): History<T> {
  let k = -1;
  for (let i = h.past.length - 1; i >= 0; i--) if (sees(h.past[i]!, scope)) { k = i; break; }
  if (k < 0) return h;
  const e = h.past[k]!;
  const take = e.scopes ? e.scopes.filter((sc) => sc === scope || !h.past.slice(k + 1).some((x) => sees(x, sc))) : all;
  const past = h.past.flatMap((x, i) => (i === k ? [without(x, take)].filter((y): y is UndoEntry<T> => !!y) : [x]));
  return { past, present: slice(h.present, e.state, take) };
}

/** 回到這個領域第 index 步（整個堆疊裡的位置）之前：只還原該領域，並把這領域之後的步驟拿掉（標為過期） */
export function undoToIn<T>(h: History<T>, scope: string, index: number, slice: Slicer<T>): { history: History<T>; dropped: string[] } {
  const target = h.past[index];
  if (target === undefined || !sees(target, scope)) return { history: h, dropped: [] };
  const dropped = h.past.slice(index).filter((e) => sees(e, scope)).map((e) => e.label).reverse();
  const past = h.past.flatMap((x, i) => (i < index ? [x] : [without(x, [scope])].filter((y): y is UndoEntry<T> => !!y)));
  return { history: { past, present: slice(h.present, target.state, [scope]) }, dropped };
}
