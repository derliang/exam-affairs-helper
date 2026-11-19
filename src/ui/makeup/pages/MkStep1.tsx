/** S-2 ① 補考設定：學期、多考日與年級對應（F-1～F-3）、提前開考判斷（F-4、U-2）、產出選項（F-5、U-5） */
import { Alert, Badge, Button, Seg, Stepper, Switch } from '../../components';
import { DEFAULT_BREAK_MIN, DEFAULT_EARLY_RULE, DEFAULT_PERIOD_MIN, GRADE_ORDER, GRADE_TEXT, fmtTime, type GradeKey } from '../../../core/makeup';
import { todayTaipei } from '../../examDates';
import { baseOf } from '../pipeline';
import { SEMESTER_TEXT, addDay, dayLabel, removeDay, settingIssues, type MakeupSemester, type MakeupSession } from '../session';

const toMin = (v: string): number => { const m = /^(\d{1,2}):(\d{2})$/.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN; };

export function MkStep1(p: { s: MakeupSession; onChange: (s: MakeupSession) => void; today?: string }) {
  const { s } = p;
  const b = baseOf(s);
  const issues = settingIssues(s, p.today ?? todayTaipei(), b.grades);
  const set = (patch: Partial<MakeupSession>) => p.onChange({ ...s, ...patch });
  // 考日或對應改了，群組跟著變：使用者調整過的考程作廢，回到系統建議（⑤ 會說明）
  const setSched = (patch: Partial<MakeupSession>) => { const { plan: _p, ...rest } = s; void _p; p.onChange({ ...rest, ...patch }); };
  const setDay = (id: string, patch: Partial<MakeupSession['days'][number]>) => setSched({ days: s.days.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const dayIssue = (id: string) => issues.filter((i) => i.dayId === id);
  const carried = s.carriedFrom !== undefined;
  const uncarry = () => { const { carriedFrom: _c, ...rest } = s; void _c; p.onChange({ ...rest, rooms: [], roomOff: [], periodMin: { ...DEFAULT_PERIOD_MIN }, breakMin: DEFAULT_BREAK_MIN, early: { ...DEFAULT_EARLY_RULE }, options: { seatChart: true, labels: false } }); };
  return (
    <section class="stack">
      <div class="card stephead"><div><h2>① 補考設定</h2><p class="small muted">先決定哪幾天考、哪些年級在哪一天、每節多久。其餘後面再調。</p></div></div>
      {carried && (
        <Alert tone="info" action={<Button small onClick={uncarry}>不沿用</Button>}>
          已帶入上一次補考的教室與每節時長；日期、考日對應與名單沒有帶入。下面全部都能改。
        </Alert>
      )}

      <div class="card stack">
        <div class="lab">學期</div>
        <div class="field"><label for="mk1-name">場次名稱</label>
          <input id="mk1-name" class="input" value={s.name} onInput={(e) => set({ name: e.currentTarget.value })} /></div>
        <div class="field"><label for="mk1-year">學年度</label>
          <input id="mk1-year" class="input" inputMode="numeric" value={String(s.year)} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 90 && n <= 200) set({ year: n }); }} />
          <span class="hint">依建立日期推算，可改。</span></div>
        <div class="field"><span class="label">學期</span>
          <Seg<MakeupSemester> label="學期" value={s.semester} options={(['first', 'second', 'summer'] as const).map((v) => ({ value: v, label: SEMESTER_TEXT[v] }))} onChange={(v) => set({ semester: v })} /></div>
      </div>

      <div class="card stack">
        <div><div class="lab">考日與年級</div><p class="small muted">可設多個考日；每個年級指定在哪一天考（高三、初三常提早，也可能某年級單獨一天）。</p></div>
        {s.days.map((d, i) => {
          const gs = GRADE_ORDER.filter((g) => s.gradeDay[g] === d.id);
          return (
            <div class="psec stack" key={d.id}>
              <div class="row" style="justify-content:space-between"><h3>考日 {i + 1}</h3>
                {s.days.length > 1 && <Button small kind="danger" onClick={() => setSched(removeDay(s, d.id))}>移除</Button>}</div>
              <div class="row" style="align-items:flex-start">
                <div class={`field${dayIssue(d.id).some((x) => x.kind === 'day-past') ? ' err' : ''}`}><label for={`mk1-date-${d.id}`}>日期</label>
                  <input id={`mk1-date-${d.id}`} class="input" type="date" value={d.date} onInput={(e) => setDay(d.id, { date: e.currentTarget.value })} />
                  {dayIssue(d.id).map((x) => <span key={x.kind} class={x.kind === 'day-empty' ? 'hint' : 'field-msg'}>{x.kind === 'day-past' ? '✕ ' : ''}{x.text}</span>)}</div>
                <div class="field"><label for={`mk1-start-${d.id}`}>開始時間</label>
                  <input id={`mk1-start-${d.id}`} class="input" type="time" value={fmtTime(d.start)} onInput={(e) => { const m = toMin(e.currentTarget.value); if (Number.isFinite(m)) setDay(d.id, { start: m }); }} /></div>
              </div>
              <p class="small muted">這一天考的年級：{gs.length ? gs.map((g) => GRADE_TEXT[g]).join('、') : '還沒有年級'}（{dayLabel(d, i)}）</p>
            </div>
          );
        })}
        <div><Button onClick={() => setSched(addDay(s))}>＋ 新增考日</Button></div>

        <div class="psec stack">
          <h3>年級 → 考日</h3>
          <div class="rtw"><table class="t compact rt-t rt-a">
            <thead><tr><th>年級</th><th>考試日期</th></tr></thead>
            <tbody>
              {GRADE_ORDER.map((g: GradeKey) => {
                const missing = issues.some((i) => i.grade === g);
                return (
                  <tr key={g} class={missing ? 'bad' : ''}>
                    <td class="ti" data-label="年級"><b>{GRADE_TEXT[g]}</b>{b.grades.includes(g) && <> <Badge>名單有</Badge></>}</td>
                    <td data-label="考試日期">
                      <select class="input" aria-label={`${GRADE_TEXT[g]}考試日期`} value={s.gradeDay[g] ?? ''}
                        onChange={(e) => setSched({ gradeDay: { ...s.gradeDay, [g]: e.currentTarget.value } })}>
                        <option value="">— 尚未指定 —</option>
                        {s.days.map((d, i) => <option key={d.id} value={d.id}>{d.date ? `${dayLabel(d, i)}　` : ''}考日 {i + 1}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {issues.filter((i) => i.kind === 'grade-unassigned').map((i) => <Alert key={i.grade} tone="danger">{i.text}</Alert>)}
        </div>
      </div>

      <div class="card stack">
        <div class="lab">每節時長與休息</div>
        <div class="row">
          <div class="field"><span class="label">高中部每節（分鐘）</span><Stepper label="高中部每節" min={10} max={180} value={s.periodMin.senior} onChange={(n) => setSched({ periodMin: { ...s.periodMin, senior: n } })} /></div>
          <div class="field"><span class="label">初中部每節（分鐘）</span><Stepper label="初中部每節" min={10} max={180} value={s.periodMin.junior} onChange={(n) => setSched({ periodMin: { ...s.periodMin, junior: n } })} /></div>
          <div class="field"><span class="label">節間休息（分鐘）</span><Stepper label="節間休息" min={0} max={60} value={s.breakMin} onChange={(n) => setSched({ breakMin: n })} /></div>
        </div>
        <p class="small muted">預設高中 50 分、初中 45 分、休息 10 分；106-1 初二曾用 15 分，可改。節數不綁年級：由 ⑤ 依各科人數建議，你可以調整。</p>
      </div>

      <div class="card stack">
        <div><div class="lab">提前開考的判斷 <Badge tone="warn">暫定 U-2</Badge></div><p class="small muted">預設值由施工提案，這裡先用暫定值，你可以改。</p></div>
        <div class="row">
          <div class="field"><span class="label">各科時間加總超過（分鐘）建議提前開考</span><Stepper label="建議提前開考門檻" min={30} max={600} value={s.early.suggestOverMin} onChange={(n) => setSched({ early: { ...s.early, suggestOverMin: n } })} /></div>
          <div class="field"><span class="label">提前開考的總作答時間上限（分鐘）</span><Stepper label="提前開考上限" min={30} max={600} value={s.early.capMin} onChange={(n) => set({ early: { ...s.early, capMin: n } })} /></div>
        </div>
        <p class="small muted">每科以所屬部別的每節時長計。例：4 科 × 50 ＝ 200 分，超過 150，建議提前；超過上限會在 ⑥ 出警示（C-12）。</p>
      </div>

      <div class="card stack">
        <div><div class="lab">要產生哪些參考文件 <Badge tone="warn">暫定 U-5</Badge></div><p class="small muted">座位表預設產生（用於檢核）、標籤預設不產生。</p></div>
        <div class="row">
          <Switch label="座位表（O-5）" ariaLabel="產生座位表" checked={s.options.seatChart} onText="產生" offText="不產生" onChange={(v) => set({ options: { ...s.options, seatChart: v } })} />
          <Switch label="座位標籤（O-6）" ariaLabel="產生座位標籤" checked={s.options.labels} onText="產生" offText="不產生" onChange={(v) => set({ options: { ...s.options, labels: v } })} />
        </div>
        <p class="small muted">其他文件（O-1～O-4、O-7）固定產生，不在這裡選。</p>
      </div>
    </section>
  );
}
