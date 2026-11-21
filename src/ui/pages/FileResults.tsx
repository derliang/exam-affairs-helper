import type { Conflict, ConflictChoice, FileRead } from '../../import';
import { Alert, Button, Seg } from '../components';

/** 從 <input type="file" multiple> 或拖放事件取出檔案（保留選取順序） */
export const filesOfInput = (el: HTMLInputElement): File[] => Array.from(el.files ?? []);
export const filesOfDrop = (e: DragEvent): File[] => Array.from(e.dataTransfer?.files ?? []);

/**
 * 多檔匯入（#506、D187）：每個檔案各自的讀取結果。
 * 讀不進來的檔案只影響它自己，其他檔案照常處理，並明講哪個檔案、什麼原因。
 */
export function FileResults(p: { results: readonly (FileRead<unknown> & { note?: string })[]; /** 只有一個檔案且成功時不顯示 */ hideSingleOk?: boolean }) {
  const bad = p.results.filter((r) => !r.ok);
  const good = p.results.filter((r) => r.ok);
  if (p.hideSingleOk && p.results.length === 1 && bad.length === 0) return null;
  return (
    <div class="stack" style="gap:6px" aria-label="各檔案讀取結果">
      {bad.map((r) => (
        <Alert key={r.name} tone="danger"><b>「{r.name}」讀不進來，已略過這個檔案</b>：{r.ok ? '' : r.error}{good.length > 0 ? '　其他檔案照常處理。' : ''}</Alert>
      ))}
      {good.length > 0 && p.results.length > 1 && (
        <Alert tone="ok"><b>已讀取 {good.length} 個檔案</b>
          <ul class="small" style="margin:4px 0 0;padding-left:18px">{good.map((r) => <li key={r.name}>{r.name}{r.note ? `：${r.note}` : ''}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}

/**
 * 多檔之間同一筆出現不只一次（跨檔重複學生、同檔內重複、座號重複…）：逐筆請使用者決定，
 * 不預設任何選項、不靜默略過或覆蓋（D187，沿用 G10 的逐筆詢問）。
 */
export function ConflictList<T>(p: {
  conflicts: readonly Conflict<T>[]; choices: Readonly<Record<string, ConflictChoice>>;
  onChoose: (key: string, c: ConflictChoice | null) => void;
  /** 一筆資料的白話描述 */ describe: (item: T) => string;
  /** 這個鍵的標題，例「01 班 5 號」 */ titleOf: (key: string, c: Conflict<T>) => string;
  /** 是否提供「都不匯入」（預設有；補考的目前名單那一列不能整筆拿掉，傳 false） */ allowSkip?: boolean;
}) {
  const decided = p.conflicts.filter((c) => p.choices[c.key] !== undefined).length;
  return (
    <div class="stack" style="gap:8px" aria-label="多檔重複的資料">
      <h4 style="margin:8px 0 0">不同檔案出現同一筆（{p.conflicts.length} 筆，已決定 {decided} 筆）</h4>
      <p class="small muted">這些資料在多個檔案（或同一檔內）出現不只一次，不會被默默略過或覆蓋。請逐筆決定要留哪一份，或都不匯入；全部決定完才能繼續。</p>
      <div class="row">
        <Button small onClick={() => p.conflicts.forEach((c) => p.onChoose(c.key, 0))}>全部保留先讀到的</Button>
        <Button small onClick={() => p.conflicts.forEach((c) => p.onChoose(c.key, null))}>全部重選</Button>
      </div>
      {p.conflicts.map((c) => {
        const v = p.choices[c.key];
        return (
          <div class="card stack" key={c.key} style="gap:6px">
            <div class="lab">{p.titleOf(c.key, c)}　{v === undefined ? '（還沒決定）' : '（已決定）'}</div>
            <Seg label={`${p.titleOf(c.key, c)} 怎麼處理`} value={v === undefined ? '' : String(v)}
              options={[...c.candidates.map((x, i) => ({ value: String(i), label: `保留「${x.file}」的：${p.describe(x.item)}` })), ...(p.allowSkip === false ? [] : [{ value: 'skip', label: '都不匯入' }])]}
              onChange={(s) => p.onChoose(c.key, s === 'skip' ? 'skip' : Number(s))} />
          </div>
        );
      })}
    </div>
  );
}
