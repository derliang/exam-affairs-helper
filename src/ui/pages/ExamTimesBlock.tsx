/**
 * 第 1 步「考試日期與各節時間」區塊（#389、D169、D177；稿 v2.79，使用者 2026-11-20 審通過）。
 * 「修改各節開始時間」就地展開時間表（不再跳共用設定）。方案 B：每天填「第一節開始」＋「節間休息」，其餘自動接上，個別時段可手動改。
 * 編輯立刻生效、可從上方「復原」回來，沒有儲存鈕。只影響顯示，不影響排座。
 */
import { useRef, useState } from 'preact/hooks';
import type { DayTimes, ExamConfig, PeriodTable } from '../../data';
import { DEFAULT_BREAK, rangeText, setBreak, setFirst, setManual, slotTimes, timeIssues, type SlotTime } from '../../core/examTimes';
import { dayName, numberRows } from '../../core/periods';
import { applySchedule, parseScheduleDocx, type ScheduleApply } from '../../import/scheduleDocx';
import { Alert, Badge, Button, ConfirmButton, Stepper } from '../components';
import { dateRangeText, shortDate } from '../examDates';
import { confirmCopy } from '../flow';

const slotLabel = (t: SlotTime, rows: string[]): string => `時段${['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][t.slot] ?? t.slot}${rows[0] ? `　${rows.join('、')}` : ''}`;

export function ExamTimesBlock(p: { exam: ExamConfig; table: PeriodTable; open?: boolean; onChange: (dayTimes: DayTimes[] | undefined) => void; onEditDates: () => void; /** 匯入考程表（2026-11-23）：一次套用日期與各節時間；沒給就不顯示匯入鈕 */ onImport?: (r: { examDates?: string[]; dayTimes?: DayTimes[] }) => void; /** 推算年份用的候選西元年（依序試，星期對得上的先用） */ yearHints?: number[] }) {
  const { exam, table } = p;
  const [open, setOpen] = useState(!!p.open);
  const file = useRef<HTMLInputElement>(null);
  const [imp, setImp] = useState<{ name: string; r?: ScheduleApply; err?: string } | null>(null);
  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      const parsed = await parseScheduleDocx(await f.arrayBuffer());
      const cand = [...new Set([...(exam.examDates?.[0] ? [Number(exam.examDates[0].slice(0, 4))] : []), ...(p.yearHints ?? [new Date().getFullYear()])])];
      setImp({ name: f.name, r: applySchedule(parsed, table, cand) });
    } catch (e) {
      setImp({ name: f.name, err: e instanceof Error ? e.message : '讀不了這個檔案' });
    }
  };
  const dt = exam.dayTimes;
  const times = slotTimes(table, dt);
  const numbered = numberRows(table);
  const issues = timeIssues(table, dt);
  const custom = !!dt && dt.length > 0;
  const dates = dateRangeText(exam);
  const firstShared = times.find((t) => t.source === 'shared')?.start;

  return (
    <div class="stack" id="x-times">
      <div class="row basicbar" style="justify-content:space-between">
        <div>
          <div class="lab">考試日期與各節時間</div>
          <p id="x-dates">考試日期：{dates || <Badge tone="info">未填日期</Badge>}　{custom ? <Badge tone="info">本場自訂</Badge> : <Badge>沿用共用設定</Badge>}</p>
          {!custom && <p class="small muted">各節時間：{firstShared ? `第一個時段 ${firstShared} 起（共用設定「節次與時長」）。` : '共用設定沒有填開始時間。'}要讓這場考試有自己的時間，按右邊。</p>}
        </div>
        <div class="row">
          <Button onClick={p.onEditDates}>修改考試日期</Button>
          {p.onImport && <Button onClick={() => file.current?.click()}>匯入考程表</Button>}
          <Button kind="primary" onClick={() => setOpen(!open)}>{open ? '收合 ▴' : '設定各節時間 ▾'}</Button>
        </div>
      </div>
      {p.onImport && <input ref={file} type="file" accept=".docx" hidden aria-label="選擇考程表 Word 檔（.docx）" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void onFile(f); }} />}
      {imp?.err && <Alert tone="danger" action={<Button small onClick={() => setImp(null)}>關閉</Button>}><b>無法匯入「{imp.name}」</b>　{imp.err}</Alert>}
      {imp?.r && (
        <Alert tone="info" action={<><Button small kind="primary" onClick={() => { p.onImport?.({ ...(imp.r!.examDates ? { examDates: imp.r!.examDates } : {}), ...(imp.r!.dayTimes ? { dayTimes: imp.r!.dayTimes } : {}) }); setImp(null); setOpen(true); }}>套用</Button> <Button small kind="warn" onClick={() => setImp(null)}>取消</Button></>}>
          <b>讀到「{imp.name}」</b>
          {imp.r.lines.length ? imp.r.lines.map((l) => <div key={l}>{l}</div>) : <div>沒有可以套用的考試時段。</div>}
          {imp.r.notes.map((n) => <div class="small" key={n}>注意：{n}</div>)}
          <div class="small muted">按「套用」會取代這場考試目前的日期與各節時間，可從上方「復原」回來。</div>
        </Alert>
      )}
      {open && (
        <>
          <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">
            {table.days.map((rows, day) => {
              const d: DayTimes = dt?.[day] ?? {};
              const mine = times.filter((t) => t.day === day);
              const date = shortDate(exam.examDates?.[day]);
              return (
                <div class="tmcard" key={day}>
                  <h4>{dayName(day)}{date ? `　${date}` : ''}</h4>
                  <div class="tmset">
                    <div class="field"><label for={`tm-first-${day}`}>第一節開始</label>
                      <input id={`tm-first-${day}`} class="input" type="time" value={d.first ?? ''} onInput={(e) => p.onChange(setFirst(dt, day, e.currentTarget.value))} /></div>
                    <div class="field"><span class="label">節間休息（分）</span>
                      <Stepper label="節間休息" min={0} max={120} value={d.breakMin ?? DEFAULT_BREAK} onChange={(n) => p.onChange(setBreak(dt, day, n))} /></div>
                  </div>
                  <div class="rtw">
                    <table class="t compact rt-t rt-a tm-t">
                      <thead><tr><th>時段</th><th>時長</th><th>開始</th><th>結束</th></tr></thead>
                      <tbody>
                        {mine.map((t) => {
                          const names = numbered.filter((r) => r.day === day && r.slot === t.slot).map((r) => r.name);
                          const manual = d.manual?.[String(t.slot)];
                          const bad = issues.some((i) => i.day === day && i.slot === t.slot && i.kind !== 'late');
                          return (
                            <tr key={t.slot} class={bad ? 'bad' : ''}>
                              <td class="ti" data-label="時段">{slotLabel(t, names)}</td>
                              <td data-label="時長">{t.minutes ? `${t.minutes} 分` : '—'}</td>
                              <td class="tm-start" data-label="開始"><div class="tm-sw">
                                <input class="input tm-in" type="time" aria-label={`${dayName(day)}時段${t.slot}開始`} value={t.start ?? ''} onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  p.onChange(setManual(dt, day, t.slot, v && v !== chainedStart(table, dt, day, t.slot) ? v : ''));
                                }} />
                                {manual !== undefined && <> <Badge tone="warn">手動</Badge> <Button small kind="warn" onClick={() => p.onChange(setManual(dt, day, t.slot, ''))}>取消 ✕</Button></>}
                              </div></td>
                              <td class="tm-end" data-label="結束">{t.end ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p class="small muted">「結束」＝開始＋該時段各科時長（同時段多科取最長）。改某一格會標「手動」，後面的時段接在它後面。</p>
                </div>
              );
            })}
          </div>
          {issues.filter((i) => i.kind !== 'late').map((i, k) => <Alert key={`e${k}`} tone="danger"><b>{i.day >= 0 ? `${dayName(i.day)}　` : ''}{i.text}</b></Alert>)}
          {issues.filter((i) => i.kind === 'late').map((i, k) => <Alert key={`l${k}`} tone="warn"><b>{dayName(i.day)}　{i.text}</b>確定的話可以不理它，不影響下載。</Alert>)}
          {custom && (
            <div class="row" style="justify-content:flex-end">
              <ConfirmButton copy={confirmCopy.resetExamTimes()} onConfirm={() => p.onChange(undefined)}>還原為共用時間</ConfirmButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 這個時段若不手動、依「第一節＋休息」自動接上的開始時間（用來判斷使用者改的值是否真的不同） */
function chainedStart(table: PeriodTable, dt: DayTimes[] | undefined, day: number, slot: number): string {
  const without = dt?.map((d, i) => (i === day ? { ...d, manual: { ...(d.manual ?? {}) } } : d));
  if (without?.[day]?.manual) delete without[day]!.manual![String(slot)];
  return rangeText(slotTimes(table, without).find((x) => x.day === day && x.slot === slot)).split(/[–\s]/)[0] ?? '';
}
