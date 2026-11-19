/** S-5 ④ 人數統計：班級×科目矩陣（高中、初中分開，選組拆分）、另行通知清單、多科生科數分布（F-17～F-19） */
import { Alert, Badge, EmptyState, More, Seg } from '../../components';
import type { ClassSubjectMatrix, TrackLabel } from '../../../core/makeup';
import { baseOf, planOf } from '../pipeline';
import type { MakeupSession } from '../session';

const DIV_TEXT = { senior: '高中部', junior: '初中部' } as const;

function Matrix(p: { m: ClassSubjectMatrix }) {
  const { m } = p;
  const sum = m.classes.reduce((n, c) => n + (m.classTotals[c] ?? 0), 0);
  return (
    <div class="card stack">
      <div class="lab">{DIV_TEXT[m.division]}　班級 × 科目</div>
      <div class="rtw"><table class="t compact rt-t rt-mx">
        <thead><tr><th>班級</th>{m.subjects.map((x) => <th key={x}>{x}</th>)}<th>班總計</th></tr></thead>
        <tbody>
          {m.classes.map((c) => (
            <tr key={c}>
              <td class="ti" data-label="班級">{c}</td>
              {m.subjects.map((x) => <td key={x} data-label={x}>{m.cells[c]?.[x] ?? '·'}</td>)}
              <td class="tot" data-label="班總計"><b>{m.classTotals[c]}</b></td>
            </tr>
          ))}
          <tr>
            <td class="ti" data-label="班級"><b>各科總計</b></td>
            {m.subjects.map((x) => <td key={x} class="tot" data-label={x}><b>{m.subjectTotals[x]}</b></td>)}
            <td class="tot" data-label="班總計"><b>{m.total}</b></td>
          </tr>
        </tbody>
      </table></div>
      <p class="small"><Badge tone={sum === m.total ? 'ok' : 'danger'}>{sum === m.total ? '✓' : '✕'}</Badge> 各班加總 {sum}　＝　各科加總 {m.total}</p>
    </div>
  );
}

/** F-17 選組拆分：挑要拆的科目、指定每班是文組或理組 */
function TrackSplitCard(p: { s: MakeupSession; subjects: string[]; classes: string[]; onChange: (s: MakeupSession) => void }) {
  const { s } = p;
  const split = s.trackSplit ?? { subjects: [], trackOfClass: {} };
  // 拆分會改變科目鍵，使用者調整過的考程作廢，回到系統建議
  const apply = (next: typeof split) => { const { plan: _p, ...rest } = s; void _p; p.onChange({ ...rest, trackSplit: next }); };
  const toggle = (x: string) => apply({ ...split, subjects: split.subjects.includes(x) ? split.subjects.filter((y) => y !== x) : [...split.subjects, x] });
  const setTrack = (c: string, v: TrackLabel | '') => {
    const t = { ...split.trackOfClass };
    if (v) t[c] = v; else delete t[c];
    apply({ ...split, trackOfClass: t });
  };
  const missing = split.subjects.length > 0 ? p.classes.filter((c) => !split.trackOfClass[c]) : [];
  return (
    <More title={`選組拆分${split.subjects.length ? `（已拆：${split.subjects.join('、')}）` : '（歷史、地理、物理…依文組／理組各自一份卷）'}`} open={split.subjects.length > 0}>
      <div class="stack">
        <p class="small muted">選組科目拆開：例如歷史〔文組〕與歷史〔理組〕各自一份卷、各自統計。沒指定文理組的班級不拆。</p>
        <div class="row" role="group" aria-label="要拆分的科目">
          {p.subjects.map((x) => <button type="button" key={x} class={`rt-chip${split.subjects.includes(x) ? ' on' : ''}`} aria-pressed={split.subjects.includes(x)} onClick={() => toggle(x)}>{split.subjects.includes(x) ? '✓ ' : ''}{x}</button>)}
        </div>
        {split.subjects.length > 0 && (
          <>
            <div class="rtw"><table class="t compact rt-t rt-a">
              <thead><tr><th>班級</th><th>文組或理組</th></tr></thead>
              <tbody>{p.classes.map((c) => (
                <tr key={c}><td class="ti" data-label="班級">{c}</td>
                  <td data-label="文組或理組"><Seg<string> label={`${c}文理組`} value={split.trackOfClass[c] ?? ''} onChange={(v) => setTrack(c, v as TrackLabel | '')}
                    options={[{ value: '文組', label: '文組' }, { value: '理組', label: '理組' }, { value: '', label: '不拆' }]} /></td></tr>
              ))}</tbody>
            </table></div>
            {missing.length > 0 && <Alert tone="warn">還沒指定文理組的班級（{missing.join('、')}）的這幾科不會拆開。</Alert>}
          </>
        )}
      </div>
    </More>
  );
}

export function MkStep4(p: { s: MakeupSession; onChange: (s: MakeupSession) => void }) {
  const { s } = p;
  const b = baseOf(s);
  const r = b.roster;
  if (!s.parse || r.included.length + r.notified.length === 0) {
    return (
      <section class="stack">
        <div class="card stephead"><div><h2>④ 人數統計</h2><p class="small muted">班級 × 科目、另行通知清單、多科生科數分布。</p></div></div>
        <EmptyState title="還沒有名單可以統計">先到 ② 匯入補考名單；匯入並處理完問題列後，這裡會即時顯示各班各科人數。</EmptyState>
      </section>
    );
  }
  const sumM = b.matrices.reduce((n, m) => n + m.total, 0);
  const nb = b.notified;
  const subjectNames = [...new Set(r.included.map((x) => x.subjectName))].sort();
  const classNames = [...new Set(r.included.map((x) => x.oldClass))].sort(new Intl.Collator('zh-Hant', { numeric: true }).compare);
  const early = planOf(s).plan.groups.reduce((n, g) => n + g.early.length, 0);
  const perMin = s.periodMin.senior;
  const sumDist = b.dist.rows.reduce((n, x) => n + x.subjects * x.students, 0);
  return (
    <section class="stack">
      <div class="card stephead"><div><h2>④ 人數統計</h2><p class="small muted">班級 × 科目、另行通知清單、多科生科數分布。</p></div></div>
      {r.unresolved.length > 0 && <Alert tone="warn">② 還有 {r.unresolved.length} 筆問題列沒處理，統計暫時不含這些列。</Alert>}
      <TrackSplitCard s={s} subjects={subjectNames} classes={classNames} onChange={p.onChange} />
      {b.matrices.map((m) => <Matrix key={m.division} m={m} />)}
      <Alert tone={sumM === r.included.length ? 'ok' : 'danger'}>{sumM === r.included.length ? '✓' : '✕'} 與 C-1 納入人次一致：矩陣合計 {sumM}　＝　納入 {r.included.length}</Alert>

      <div class="card stack">
        <div class="lab">另行通知科目 <Badge tone="warn">暫定 U-1</Badge></div>
        <p class="small muted">科屬性＝1（文化基本教材、生命教育、生涯規劃等）：只統計，不排考程，但必須列出供對帳（D114）。</p>
        {nb.total === 0 ? <p class="small">沒有另行通知科目。</p> : (
          <div class="rtw"><table class="t compact rt-t rt-a">
            <thead><tr><th>科目</th><th>人次</th></tr></thead>
            <tbody>
              {Object.entries(nb.bySubject).sort((a, c) => c[1] - a[1]).map(([k, n]) => <tr key={k}><td class="ti" data-label="科目">{k}</td><td data-label="人次">{n}</td></tr>)}
              <tr><td class="ti" data-label="科目"><b>合計</b></td><td data-label="人次"><b>{nb.total}</b></td></tr>
            </tbody>
          </table></div>
        )}
        <p class="small"><Badge tone={nb.total === r.notified.length ? 'ok' : 'danger'}>{nb.total === r.notified.length ? '✓' : '✕'}</Badge> ＝ C-1 的「另行通知」{r.notified.length}　　其中 {nb.notifiedOnly.length} 位學生只有另行通知科目（不會出現在考程）。</p>
      </div>

      <div class="card stack">
        <div class="lab">多科生科數分布</div>
        <p class="small muted">這是決定提前開考的依據：每科以 {perMin} 分計，4 科＝{4 * perMin} 分，超過你在 ① 設的 {s.early.suggestOverMin} 分就建議提前。</p>
        <div class="stats">
          {b.dist.rows.map((x) => (
            <div key={x.subjects}><small>{x.subjects} 科{x.subjects * perMin > s.early.suggestOverMin ? ' ⚑ 建議提前' : ''}</small><strong>{x.students}</strong><small>人</small></div>
          ))}
        </div>
        <p class="small"><Badge tone={sumDist === b.dist.entries ? 'ok' : 'danger'}>{sumDist === b.dist.entries ? '✓' : '✕'}</Badge> Σ（科數 × 人數）＝ {sumDist}　＝　人次 {b.dist.entries}　　系統目前建議提前開考 {early} 位。</p>
      </div>
    </section>
  );
}
