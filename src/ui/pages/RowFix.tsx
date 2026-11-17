import { useState } from 'preact/hooks';
import { Badge, Seg } from '../components';

export type RowMode = 'add' | 'edit' | 'skip';
export interface RowFixValue { classNo: number; seatNo: number; name: string; schoolId?: string; groupCode?: string }

/** 補上／修改時各欄的即時檢查（只看這一列自己；跨列的撞號、撞學號由父層用 error 帶回） */
export const checkRowValue = (v: { classNo: number; seatNo: number; name: string }): string =>
  !Number.isInteger(v.classNo) || v.classNo < 1 || v.classNo > 99 ? '班級要是 1～99 的整數'
    : !Number.isInteger(v.seatNo) || v.seatNo < 1 || v.seatNo > 99 ? '座號要是 1～99 的整數'
      : v.name.trim() === '' ? '姓名不能空白' : '';

const MODE_TEXT: Record<RowMode, string> = { add: '手動補上（新增）', edit: '修改內容', skip: '略過' };

/**
 * G10：匯入名單遇到有問題的列時，逐列問使用者怎麼處理（學生名單與考試名單共用）。
 * 三選一：手動補上（新增）、修改內容、略過；沒有「稍後處理」，沒決定前父層不讓按確認。
 * 顯示這一列在原始檔的位置（工作表、第幾列）與原始內容，方便對照。
 */
export function RowFix(p: {
  where: string; kindText: string; message: string; cells: readonly string[];
  draft: { classNo?: number; seatNo?: number; name: string; schoolId?: string; groupCode?: string };
  /** 是否讓使用者改學號（學生名單才有） */
  withSchoolId?: boolean;
  /** 考試名單的未知組別：給可選的組別代碼 */
  groupCodes?: readonly string[];
  /** 父層算出的錯誤（撞座號、撞學號…） */
  error?: string;
  onDecide: (d: { mode: 'add' | 'edit'; value: RowFixValue } | { mode: 'skip' } | null) => void;
}) {
  const [mode, setMode] = useState<RowMode | null>(null);
  const [c, setC] = useState(p.draft.classNo === undefined ? '' : String(p.draft.classNo));
  const [s, setS] = useState(p.draft.seatNo === undefined ? '' : String(p.draft.seatNo));
  const [n, setN] = useState(p.draft.name);
  const [sid, setSid] = useState(p.draft.schoolId ?? '');
  const [g, setG] = useState(p.draft.groupCode ?? '');
  const valueOf = (cc = c, ss = s, nn = n, id = sid, gg = g): RowFixValue => ({ classNo: Number(cc), seatNo: Number(ss), name: nn.trim(), ...(id.trim() ? { schoolId: id.trim() } : {}), ...(gg ? { groupCode: gg } : {}) });
  const local = (v: RowFixValue): string => checkRowValue(v) || (p.groupCodes && !p.groupCodes.includes(v.groupCode?.charAt(0).toUpperCase() ?? '') ? '請選一個組別' : '');
  const emit = (m: 'add' | 'edit', v: RowFixValue) => p.onDecide(local(v) ? null : { mode: m, value: v });
  const pick = (m: RowMode) => {
    setMode(m);
    if (m === 'skip') p.onDecide({ mode: 'skip' });
    else emit(m, valueOf());
  };
  const edit = (next: Partial<{ c: string; s: string; n: string; sid: string; g: string }>) => {
    const nc = next.c ?? c, ns = next.s ?? s, nn = next.n ?? n, nsid = next.sid ?? sid, ng = next.g ?? g;
    if (next.c !== undefined) setC(nc);
    if (next.s !== undefined) setS(ns);
    if (next.n !== undefined) setN(nn);
    if (next.sid !== undefined) setSid(nsid);
    if (next.g !== undefined) setG(ng);
    if (mode === 'add' || mode === 'edit') emit(mode, valueOf(nc, ns, nn, nsid, ng));
  };
  const editing = mode === 'add' || mode === 'edit';
  const msg = editing ? (local(valueOf()) || p.error || '') : '';
  const done = mode === 'skip' || (editing && !msg);
  return (
    <div class="card stack" style="padding:10px;gap:8px;margin:6px 0">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <Badge tone={done ? 'ok' : 'warn'}>{done && mode ? `已決定：${MODE_TEXT[mode]}` : '待處理'}</Badge>
        <b>{p.where}</b><span>{p.kindText}</span>
      </div>
      <div class="small">{p.message.replace(/，已略過(這一列)?$/, '')}</div>
      <div class="muted small">原始檔這一列的內容：{p.cells.length ? p.cells.join('｜') : '（空白）'}</div>
      <Seg<RowMode> label={`${p.where} 處理方式`} value={(mode ?? '') as RowMode} onChange={pick}
        options={[{ value: 'add', label: MODE_TEXT.add }, { value: 'edit', label: MODE_TEXT.edit }, { value: 'skip', label: MODE_TEXT.skip }]} />
      {editing && (
        <div class="stack" style="gap:6px">
          <div class="btnrow">
            <input class="input" style="width:72px" aria-label={`${p.where} 班級`} placeholder="班級" inputMode="numeric" value={c} onInput={(e) => edit({ c: e.currentTarget.value })} />
            <input class="input" style="width:72px" aria-label={`${p.where} 座號`} placeholder="座號" inputMode="numeric" value={s} onInput={(e) => edit({ s: e.currentTarget.value })} />
            <input class="input" style="width:120px" aria-label={`${p.where} 姓名`} placeholder="姓名" value={n} onInput={(e) => edit({ n: e.currentTarget.value })} />
            {p.withSchoolId && <input class="input" style="width:130px" aria-label={`${p.where} 學號`} placeholder="學號（選填）" value={sid} onInput={(e) => edit({ sid: e.currentTarget.value })} />}
            {p.groupCodes && (
              <select class="input" aria-label={`${p.where} 組別`} value={g} onChange={(e) => edit({ g: e.currentTarget.value })}>
                <option value="">— 選組別 —</option>{p.groupCodes.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
          </div>
          <span class={msg ? 'field-msg' : 'hint'} role={msg ? 'alert' : undefined}>{msg || (mode === 'add' ? '補好後這一列會新增進名單。' : '改好後這一列會以修改後的內容加入名單。')}</span>
        </div>
      )}
      {mode === 'skip' && <span class="hint">這一列不會匯入。</span>}
    </div>
  );
}
