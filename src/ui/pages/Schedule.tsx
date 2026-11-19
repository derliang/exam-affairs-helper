/**
 * 共用設定第六個分頁「節次與時長」（稿 v2.22，校-55；D92、D94）：
 * 像學校的模擬考科目表，一天一欄、科目由上往下；可拖拉或按 ↑↓ 改順序（也可移到另一天）；
 * 節次編號依順序自動算，勾「與上一科同節」才同節；開始時間選填、不印在標籤上；可新增、刪除、還原預設。
 */
import { useState } from 'preact/hooks';
import type { PeriodTable, ScheduleKey } from '../../data';
import { addRow, dropRow, isDefaultSchedule, moveRow, numberRows, removeRow, slotName, SCHEDULE_KEYS, scheduleOf, updateRow, withSchedule, type RowRef } from '../../core/periods';
import { Button, ConfirmButton, Modal } from '../components';
import { defaultSubjects } from '../subjects';
import { confirmCopy } from '../flow';
import type { Doc } from '../store';

const NOTES: Record<ScheduleKey, string> = {
  g12: '順序依學校科目表（與大考日程圖不同）；英聽一定排在第一天最後一節。國文「整個一起標」：國綜、國寫是兩節，但標示與抽離當成一個。',
  g34: '沒有英聽，英聽的位置換成數學 B。國文「整個一起標」：國綜、國寫是兩節，但標示與抽離當成一個。',
  ast: '兩天各 4 節、共 8 節，順序與正式考試相同，每節 80 分鐘。學校偶爾把兩天壓成一天、文理組同節考不同科（例如 114 下學期第 6 次），那是特例：勾「與上一科同節」即可。',
  bcct: '順序與時長同正式會考。會考不需要抽離，節次與時長只用在標籤與日程顯示。',
};
const DAY = ['一', '二', '三', '四'];
const KEY_KIND: Record<ScheduleKey, { kind: 'gsat' | 'ast' | 'bcct'; round: number }> = { g12: { kind: 'gsat', round: 1 }, g34: { kind: 'gsat', round: 3 }, ast: { kind: 'ast', round: 1 }, bcct: { kind: 'bcct', round: 1 } };

/** 開始時間＋時長 → 結束時間（HH:MM，自動算；沒有開始時間或時長回空字串） */
export function endTimeOf(start: string | undefined, minutes: number | undefined): string {
  const m = start ? /^(\d{1,2}):(\d{2})$/.exec(start) : null;
  if (!m || !minutes) return '';
  const t = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 把某一天的考科全部移到第 1 天最後（#365）；這一天保留成空天，不自動刪 */
export function moveDayToFirst(t: PeriodTable, day: number): PeriodTable {
  if (day <= 0 || !t.days[day]?.length) return t;
  const c = JSON.parse(JSON.stringify(t)) as PeriodTable;
  c.days[0]!.push(...c.days[day]!.splice(0));
  return c;
}

/** 每天新增考科（#365、D164 G）：挑這個考試類型既有的科目。自訂名稱與 G38（科目名稱與時長寫死、新增的自訂科目一律忽略）衝突，等裁示，這一版沒做 */
function AddSubjectModal(p: { scheduleKey: ScheduleKey; day: number; onAdd: (name: string, subjectId?: string) => void; onClose: () => void }) {
  const kind = KEY_KIND[p.scheduleKey];
  const subs = defaultSubjects(kind.kind, kind.round);
  const [pick, setPick] = useState(subs[0]?.id ?? '');
  const chosen = subs.find((s) => s.id === pick);
  const name = chosen?.name ?? '';
  return (
    <Modal title={`新增考科（第 ${DAY[p.day] ?? p.day + 1} 天）`} onClose={p.onClose}
      actions={<><Button onClick={p.onClose}>取消</Button><Button kind="primary" disabled={!name} onClick={() => { p.onAdd(name, chosen?.id); p.onClose(); }}>新增</Button></>}>
      <div class="stack">
        <div class="field"><label for="add-sub">從這個考試類型既有的科目挑</label>
          <select id="add-sub" class="input" value={pick} onChange={(e) => setPick(e.currentTarget.value)}>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
    </Modal>
  );
}

export function ScheduleTab({ doc, onChange }: { doc: Doc; onChange: (d: Doc) => void }) {
  const [key, setKey] = useState<ScheduleKey>('g12');
  const [drag, setDrag] = useState<RowRef | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [note, setNote] = useState(false); // 與預設相同時按「還原預設」確認後顯示「已是預設值」
  const table = scheduleOf(doc.settings, key);
  const label = SCHEDULE_KEYS.find((x) => x.key === key)!.label;
  const save = (t: PeriodTable) => onChange({ ...doc, settings: withSchedule(doc.settings, key, t) });
  const rows = numberRows(table);
  const slotAt = (day: number, index: number) => rows.find((x) => x.day === day && x.index === index)!.slot;
  const dropProps = (to: RowRef, id: string) => ({
    onDragOver: (e: DragEvent) => { if (drag) { e.preventDefault(); setOver(id); } },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: DragEvent) => { e.preventDefault(); if (drag) save(dropRow(table, drag, to)); setDrag(null); setOver(null); },
  });
  return (
    <div class="card stack">
      <div>
        <h3>節次與時長</h3>
        <p class="small muted">像學校的模擬考科目表：一天一欄，科目由上往下。<b>最重要的是科目順序</b>：用左邊的 ⠿ 拖拉，或按 ↑↓，也可以拖到另一天；新增模擬考時自動帶入這份順序。科目名稱與每科時長是大考規定，不能修改；時長只看考試時間、不管發卷與休息；開始時間每次可能不同，所以選填，也不會印在標籤上。</p>
      </div>
      <div class="row" style="justify-content:space-between">
        <div class="seg ttseg" role="group" aria-label="考試類型">
          {SCHEDULE_KEYS.map((x) => <button type="button" key={x.key} aria-pressed={key === x.key} onClick={() => { setKey(x.key); setNote(false); }}>{x.label}</button>)}
        </div>
        <div class="row" style="gap:8px">
          {note && isDefaultSchedule(table, key) && <span class="small muted" role="status">已是預設值</span>}
          {/* D156：常駐可按（不因「與預設相同」停用）、主色外框、先確認；改過才真的還原，相同只提示 */}
          <ConfirmButton kind="accent-outline" undoable={false} copy={confirmCopy.resetSchedule(label, isDefaultSchedule(table, key))}
            onConfirm={() => { if (isDefaultSchedule(table, key)) setNote(true); else onChange({ ...doc, settings: withSchedule(doc.settings, key, undefined) }); }}>{`↺ 還原「${label}」預設`}</ConfirmButton>
        </div>
      </div>
      <div class="alert a-info" role="status">
        <span aria-hidden="true">ℹ</span>
        <div><b>節次編號依順序自動算；同節＝同時進行。</b>{NOTES[key]}同一節各科的抽離人數會加總，再和預備教室容量比（預設一節一科，只有勾「與上一科同節」才會用到）。對應：1 月＝學測、7 月＝分科、5 月＝國中會考。</div>
      </div>
      {adding !== null && <AddSubjectModal scheduleKey={key} day={adding} onClose={() => setAdding(null)} onAdd={(name, subjectId) => { const t = addRow(table, adding, name); const at = { day: adding, index: t.days[adding]!.length - 1 }; save(subjectId ? updateRow(t, at, { subjectId }) : t); }} />}
      <div class="tt">
        {table.days.map((day, di) => (
          <div class="ttc" key={di}>
            <div class="hd"><span>{`第 ${DAY[di] ?? di + 1} 天`}</span><span class="small muted">{`${day.length} 科`}</span></div>
            {day.map((r, i) => {
              const at = { day: di, index: i };
              const id = `${di},${i}`;
              const first = di === 0 && i === 0;
              const chinese = r.subjectId === 'chinese' && (key === 'g12' || key === 'g34');
              return (
                <div key={id} class={`ttr${r.samePrev && !first ? ' same' : ''}${drag && drag.day === di && drag.index === i ? ' dragging' : ''}${over === id ? ' over' : ''}`} {...dropProps(at, id)}>
                  <span class="sgrip" draggable title="拖拉改順序" aria-hidden="true"
                    onDragStart={(e) => { setDrag(at); e.dataTransfer?.setData('text/plain', id); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}>⠿</span>
                  <span class="sn">{slotName(slotAt(di, i))}</span>
                  <span class="nm" aria-label="科目名稱">{r.name}</span>
                  <span class="dur" aria-label="時長（分鐘）"><b>{r.minutes ?? '—'}</b><span>分</span></span>
                  <span class="ops">
                    <button type="button" class="btn btn-sm btn-ghost" aria-label="上移" onClick={() => save(moveRow(table, at, -1))}>↑</button>
                    <button type="button" class="btn btn-sm btn-ghost" aria-label="下移" onClick={() => save(moveRow(table, at, 1))}>↓</button>
                    <button type="button" class="btn btn-sm btn-danger" aria-label={`刪除${r.name}`} onClick={() => save(removeRow(table, at))}>×</button>
                  </span>
                  <span class="sub">
                    <label><input type="checkbox" checked={!!r.samePrev && !first} disabled={first} onChange={(e) => save(updateRow(table, at, { samePrev: e.currentTarget.checked || undefined }))} />與上一科同節</label>
                    <label>開始時間（選填）<input class="input" type="time" value={r.start ?? ''} onChange={(e) => save(updateRow(table, at, { start: e.currentTarget.value || undefined }))} /></label>
                    {endTimeOf(r.start, r.minutes) && <span class="small muted">結束（自動）{endTimeOf(r.start, r.minutes)}</span>}
                    {chinese && <span class="badge b-acc">國文：整個一起標</span>}
                    {r.subjectId === 'en-listen' && key === 'g12' && <span class="badge">英聽固定排第一天最後一節</span>}
                  </span>
                </div>
              );
            })}
            {day.length === 0 && <div class="small muted" style="padding:8px 0">沒有考科</div>}
            <div class={`end${over === `${di},end` ? ' over' : ''}`} {...dropProps({ day: di, index: day.length }, `${di},end`)} />
            <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">
              <Button small onClick={() => setAdding(di)}>＋ 新增考科</Button>
              {di > 0 && day.length > 0 && <Button small onClick={() => save(moveDayToFirst(table, di))}>把這一天的考科全部移到第 1 天</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
