/**
 * 分科兩處 JSON 匯入（版本清單備份、上次定案座位）一次匯入多個檔案（#506、D187）。
 * 逐檔讀取、單檔壞檔只影響它自己；多檔之間同一個版本號、同一位考生的座位出現不只一次時，逐筆問使用者，不靜默覆蓋。
 */
import type { AstVersion, PrevSeat } from '../../data';
import { parseVersions } from '../../core/astD99/release';
import { groupByKey, readFiles, resolveConflicts, type Candidate, type Conflict, type ConflictChoice, type FileRead } from '../../import';
import { Alert, Button, Modal } from '../components';
import { ConflictList } from '../pages/FileResults';

export type JsonItem = { kind: 'v'; v: AstVersion } | { kind: 's'; s: PrevSeat };
export interface ParsedFile { versions: AstVersion[]; seats: PrevSeat[]; examId?: string; year?: number }
export interface JsonAsk { unique: Candidate<JsonItem>[]; conflicts: Conflict<JsonItem>[] }

/** 逐檔讀取並解析；check 回傳非空字串＝這個檔案不能用（只影響它自己） */
export const readJsonFiles = (files: readonly File[], check: (r: ParsedFile) => string): Promise<FileRead<ParsedFile>[]> =>
  readFiles(files, async (f) => {
    const r = parseVersions(await f.text());
    if (!r.ok) throw new Error(r.error);
    const why = check(r);
    if (why) throw new Error(why);
    return r;
  });

const keyOf = (i: JsonItem): string => (i.kind === 'v' ? `v:${i.v.n}` : `s:${i.s.code}`);

/** 把多個檔案的版本與座位依鍵分組：同鍵出現不只一次（跨檔或同檔內）就是衝突 */
export function groupJsonFiles(parts: readonly { name: string; value: Pick<ParsedFile, 'versions' | 'seats'> }[]): JsonAsk {
  return groupByKey(parts.map((p) => ({ file: p.name, items: [...p.value.versions.map((v) => ({ kind: 'v' as const, v })), ...p.value.seats.map((s) => ({ kind: 's' as const, s }))] as JsonItem[] })), keyOf);
}

/** 依逐筆決定產出合併後的版本（依版本號排序）與座位 */
export function finishJson(ask: JsonAsk, choices: Readonly<Record<string, ConflictChoice>>): { versions: AstVersion[]; seats: PrevSeat[]; ready: boolean; pending: number } {
  const r = resolveConflicts(ask.unique, ask.conflicts, choices);
  const versions = r.items.flatMap((i) => (i.kind === 'v' ? [i.v] : [])).sort((a, b) => a.n - b.n);
  const seats = r.items.flatMap((i) => (i.kind === 's' ? [i.s] : []));
  return { versions, seats, ready: r.ready, pending: r.pending.length };
}

const describe = (i: JsonItem): string => (i.kind === 'v' ? `${i.v.at.slice(0, 16).replace('T', ' ')}　${i.v.reason}` : `${i.s.roomId} 第 ${i.s.row} 排－${i.s.depth} 深位`);
const titleOf = (key: string): string => (key.startsWith('v:') ? `版本 ${key.slice(2)}` : `座位 ${key.slice(2)}`);

export function JsonConflictModal(p: {
  title: string; ask: JsonAsk; choices: Record<string, ConflictChoice>; onChoose: (k: string, c: ConflictChoice | null) => void; onApply: () => void; onCancel: () => void; confirmText: string;
}) {
  const r = finishJson(p.ask, p.choices);
  return (
    <Modal title={p.title} onClose={p.onCancel} actions={<><Button onClick={p.onCancel}>取消匯入</Button><Button kind="primary" disabled={!r.ready} onClick={p.onApply}>{p.confirmText}</Button></>}>
      <ConflictList conflicts={p.ask.conflicts} choices={p.choices} onChoose={p.onChoose} describe={describe} titleOf={titleOf} />
      {!r.ready && <Alert tone="warn"><b>還不能確認：</b>還有 {r.pending} 筆沒有決定。</Alert>}
    </Modal>
  );
}
