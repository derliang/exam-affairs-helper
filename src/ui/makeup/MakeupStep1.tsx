import { Alert, Button, Seg, Switch } from '../components';
import { fmtTime, GRADE_ORDER, GRADE_TEXT, type GradeKey } from '../../core/makeup';
import type { Doc } from '../store';
import {
  addDay, addGroup, checkMakeupName, dateLabel, derive, parseTime, patchGroup, removeDay, removeGroup, setDayLabel, setGradeGroup, settingsIssues, termText,
  type MakeupSession,
} from './model';

export interface MakeupStepProps { doc: Doc; s: MakeupSession; onChange: (m: MakeupSession) => void }

const num = (v: string): number | null => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null; };

/** ① 補考設定（S-2；F-1～F-6）：場次名稱與學期、考日（可多日）、年級對應群組與時長、提前開考判斷、產出選項 */
export function MakeupStep1(p: MakeupStepProps) {
  const { s } = p;
  const { days, groups, early } = s.settings;
  const d = derive(s);
  const issues = settingsIssues(s, d.grades);
  const nameChk = checkMakeupName(p.doc, s.name, s.id);
  const set = (f: Partial<MakeupSession>) => p.onChange({ ...s, ...f });
  const setSettings = (f: Partial<MakeupSession['settings']>) => p.onChange({ ...s, settings: { ...s.settings, ...f } });
  const gradeHome = (g: GradeKey) => groups.find((x) => x.grades.includes(g));
  return (
    <section class="stack" aria-label="補考設定">
      <div class="card stephead"><div><h2>① 補考設定</h2><p class="small muted">學期、考日、各年級在哪一天考、每節多長。教室與時長會帶入下一次補考。</p></div></div>

      <div class="card stack"><div class="lab">場次</div>
        <div class="newgrid">
          <div class={`field${nameChk.ok ? '' : ' err'}`}><label for="mk-name">補考名稱</label>
            <input id="mk-name" class="input" value={s.name} aria-invalid={!nameChk.ok} onInput={(e) => set({ name: e.currentTarget.value })} />
            <span class={nameChk.ok ? 'hint' : 'field-msg'}>{nameChk.ok ? '資料夾名稱不會跟著改，可以隨時改這個顯示名稱' : nameChk.message}</span></div>
          <div class="field"><label for="mk-year">學年度</label>
            <input id="mk-year" class="input" inputMode="numeric" value={String(s.schoolYear)} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null && n >= 90 && n <= 200) set({ schoolYear: n }); }} />
            <span class="hint">民國年，例如 115</span></div>
          <div class="field newgrid-wide"><span class="label" id="mk-term-l">學期</span>
            <Seg label="學期" value={s.semester} onChange={(v) => set({ semester: v })} options={[{ value: 'first', label: termText('first') }, { value: 'second', label: termText('second') }]} /></div>
        </div>
      </div>

      <div class="card stack"><div class="lab">考日（可設多日）</div>
        <p class="small muted">高三、初三下學期可以提早考，也可能某個年級單獨一天；每個年級在下面「考程群組」指定它在哪一天。</p>
        {days.map((day, i) => (
          <div class="row" key={day.id}>
            <span class="badge b-acc">{'一二三四五六七八九十'[i] ?? i + 1}</span>
            <label class="field" style="min-width:160px"><span class="label">日期（選了會自動寫成「1/23（六）」）</span>
              <input class="input" type="date" aria-label={`考日 ${i + 1} 日期`} onChange={(e) => { const l = dateLabel(e.currentTarget.value); if (l) p.onChange(setDayLabel(s, day.id, l)); }} /></label>
            <label class="field" style="min-width:180px"><span class="label">顯示名稱</span>
              <input class="input" aria-label={`考日 ${i + 1} 名稱`} value={day.label} onInput={(e) => p.onChange(setDayLabel(s, day.id, e.currentTarget.value))} /></label>
            <Button small kind="danger" disabled={days.length <= 1} onClick={() => p.onChange(removeDay(s, day.id))}>刪除這一天</Button>
          </div>
        ))}
        <div><Button onClick={() => p.onChange(addDay(s))}>＋ 新增考日</Button></div>
      </div>

      <div class="card stack"><div class="lab">考程群組：哪些年級同一天、同一套時間</div>
        <p class="small muted">預設高中、初中各一組（高中每節 50 分、初中 45 分、休息 10 分，8:00 開考）。高三要提早、或某年級單獨一天，就另開一組。一個年級只能在一個群組。</p>
        {groups.map((g) => (
          <div class="card stack" key={g.id} style="background:var(--surface-2,transparent)">
            <div class="row" style="justify-content:space-between">
              <label class="field" style="min-width:140px"><span class="label">群組名稱</span>
                <input class="input" aria-label="群組名稱" value={g.label} onInput={(e) => p.onChange(patchGroup(s, g.id, { label: e.currentTarget.value }))} /></label>
              <label class="field"><span class="label">考日</span>
                <select class="input" aria-label={`${g.label} 考日`} value={g.dayId} onChange={(e) => p.onChange(patchGroup(s, g.id, { dayId: e.currentTarget.value }))}>
                  {days.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
                </select></label>
              <label class="field"><span class="label">開始時間</span>
                <input class="input" type="time" aria-label={`${g.label} 開始時間`} value={fmtTime(g.start)} onChange={(e) => { const t = parseTime(e.currentTarget.value); if (t !== null) p.onChange(patchGroup(s, g.id, { start: t })); }} /></label>
              <label class="field"><span class="label">每節（分）</span>
                <input class="input" type="number" min={10} max={180} style="width:90px" aria-label={`${g.label} 每節分鐘`} value={g.periodMin} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null) p.onChange(patchGroup(s, g.id, { periodMin: n })); }} /></label>
              <label class="field"><span class="label">休息（分）</span>
                <input class="input" type="number" min={0} max={60} style="width:90px" aria-label={`${g.label} 節間休息`} value={g.breakMin} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null) p.onChange(patchGroup(s, g.id, { breakMin: n })); }} /></label>
            </div>
            <div class="field"><span class="label">這一組包含的年級</span>
              <div class="roundgrid" role="group" aria-label={`${g.label} 包含的年級`}>
                {GRADE_ORDER.map((gr) => {
                  const on = g.grades.includes(gr);
                  const other = gradeHome(gr);
                  return <button type="button" key={gr} class="rbtn" aria-pressed={on} title={!on && other ? `目前在「${other.label}」，按了會移過來` : undefined} onClick={() => p.onChange(setGradeGroup(s, gr, on ? null : g.id))}>{GRADE_TEXT[gr]}</button>;
                })}
              </div>
            </div>
            <div class="row" style="justify-content:space-between">
              <span class="small muted">節次：{fmtTime(g.start)} 起，每節 {g.periodMin} 分、休息 {g.breakMin} 分</span>
              <Button small kind="danger" onClick={() => p.onChange(removeGroup(s, g.id))}>刪除這一組</Button>
            </div>
          </div>
        ))}
        <div><Button onClick={() => p.onChange(addGroup(s))}>＋ 新增群組</Button></div>
      </div>

      <div class="card stack"><div class="lab">提前開考與獨立節（暫定值，可改）</div>
        <p class="small muted">多科生各科考試時間加總「超過」門檻，系統建議他提前到特別教室開考；總作答時間不能超過上限。獨立節門檻：某科人數達到才單獨一節，其餘併入最後一節（綜合節）。</p>
        <div class="row">
          <label class="field"><span class="label">建議提前開考門檻（分）</span>
            <input class="input" type="number" style="width:120px" aria-label="建議提前開考門檻" value={early.suggestOverMin} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null && n >= 0) setSettings({ early: { ...early, suggestOverMin: n } }); }} /></label>
          <label class="field"><span class="label">總作答上限（分）</span>
            <input class="input" type="number" style="width:120px" aria-label="總作答上限" value={early.capMin} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null && n >= 0) setSettings({ early: { ...early, capMin: n } }); }} /></label>
          <label class="field"><span class="label">獨立節最少人數</span>
            <input class="input" type="number" style="width:120px" aria-label="獨立節最少人數" value={s.settings.independentMin ?? 10} onInput={(e) => { const n = num(e.currentTarget.value); if (n !== null && n >= 1) setSettings({ independentMin: n }); }} /></label>
        </div>
      </div>

      <div class="card stack"><div class="lab">產出選項</div>
        <Switch label="產生座位表（參考用，建議開，檢核每人都有座位）" ariaLabel="產生座位表" checked={s.seatMap} onChange={(v) => set({ seatMap: v })} />
        <Switch label="產生座位標籤（參考用，預設不產生）" ariaLabel="產生座位標籤" checked={s.labels} onChange={(v) => set({ labels: v })} />
      </div>

      {issues.length > 0
        ? <Alert tone="warn"><b>這一步還有 {issues.length} 件事要處理：</b><ul style="margin:6px 0 0 18px">{issues.map((i, k) => <li key={k}>{i.text}</li>)}</ul></Alert>
        : <Alert tone="ok">考日與群組設定完整。</Alert>}
    </section>
  );
}
