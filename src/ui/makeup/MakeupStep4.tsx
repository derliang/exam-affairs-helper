import { Alert, Badge, EmptyState } from '../components';
import { classSubjectMatrix, notifiedSummary, subjectCountDistribution, type TrackLabel } from '../../core/makeup';
import { derive, rosterOf, setClassTrackLabel, toggleSplitSubject } from './model';
import type { MakeupStepProps } from './MakeupStep1';

/** ④ 人數統計（S-5；F-17～F-19）：班級×科目矩陣（初中、高中分開、選組拆分）、另行通知清單、多科生科數分布 */
export function MakeupStep4(p: MakeupStepProps) {
  const { s } = p;
  const d = derive(s);
  const roster = rosterOf(s);
  if (!roster || roster.included.length + roster.notified.length === 0) {
    return (
      <section class="stack" aria-label="人數統計">
        <div class="card stephead"><div><h2>④ 人數統計</h2></div></div>
        <EmptyState title="還沒有可統計的名單">先到 ② 匯入名單並處理完問題列。</EmptyState>
      </section>
    );
  }
  const matrices = classSubjectMatrix(d.entries);
  const nt = notifiedSummary(roster);
  const dist = subjectCountDistribution(d.entries);
  const rawSubjects = [...new Set(roster.included.map((r) => r.subjectName))].sort();
  const classes = [...new Set(roster.included.map((r) => r.oldClass))].sort();
  const split = s.settings.trackSplit;
  const matrixTotal = matrices.reduce((n, m) => n + m.total, 0);
  const distSum = dist.rows.reduce((n, r) => n + r.subjects * r.students, 0);
  return (
    <section class="stack" aria-label="人數統計">
      <div class="card stephead"><div><h2>④ 人數統計</h2><p class="small muted">人次＝一位學生的一個科目算一人次。每個合計都附對帳等式。</p></div></div>

      {unresolvedNote(roster.unresolved.length)}

      {matrices.map((m) => (
        <div class="card stack" key={m.division}><div class="lab">{m.division === 'senior' ? '高中部' : '初中部'}：班級 × 科目（人次）</div>
          <div class="scroll"><table class="t compact nw" aria-label={`${m.division === 'senior' ? '高中部' : '初中部'}班級科目矩陣`}>
            <thead><tr><th>班級</th>{m.subjects.map((x) => <th key={x}>{x}</th>)}<th>合計</th></tr></thead>
            <tbody>
              {m.classes.map((c) => <tr key={c}><td>{c}</td>{m.subjects.map((x) => <td key={x}>{m.cells[c]?.[x] ?? ''}</td>)}<td><b>{m.classTotals[c]}</b></td></tr>)}
              <tr><th>各科合計</th>{m.subjects.map((x) => <th key={x}>{m.subjectTotals[x]}</th>)}<th>{m.total}</th></tr>
            </tbody></table></div>
          <p class="small">各班合計加總 ＝ 各科合計加總 ＝ <b>{m.total}</b> 人次 <Badge tone="ok">✓</Badge></p>
        </div>
      ))}
      <p>全部人次：<b>{matrixTotal}</b> ＝ 納入排程的名單列數 <b>{roster.included.length}</b> {matrixTotal === roster.included.length ? <Badge tone="ok">✓ 對得起來</Badge> : <Badge tone="danger">✕ 不一致</Badge>}</p>

      <div class="card stack"><div class="lab">選組科目拆開（文組／理組分開統計與排考）</div>
        <p class="small muted">勾選要依文理組拆成兩份卷的科目（例如歷史、物理），再指定每個班是文組或理組；沒指定的班不拆。改了之後考程會回到系統建議。</p>
        <div class="roundgrid" role="group" aria-label="要拆開的科目">
          {rawSubjects.map((x) => { const on = split?.subjects.includes(x) ?? false; return <button type="button" key={x} class="rbtn" aria-pressed={on} onClick={() => p.onChange(toggleSplitSubject(s, x, !on))}>{x}</button>; })}
        </div>
        {(split?.subjects.length ?? 0) > 0 && (
          <div class="row">
            {classes.map((c) => (
              <label class="field" key={c}><span class="label">{c}</span>
                <select class="input" style="width:110px" aria-label={`${c} 文理組`} value={split?.trackOfClass[c] ?? ''} onChange={(e) => { const v = e.currentTarget.value; p.onChange(setClassTrackLabel(s, c, v === '' ? null : (v as TrackLabel))); }}>
                  <option value="">不指定</option><option value="文組">文組</option><option value="理組">理組</option></select></label>
            ))}
          </div>
        )}
      </div>

      <div class="card stack"><div class="lab">另行通知科目（科屬性 1，不排考程）</div>
        {nt.total === 0 ? <p class="muted">沒有另行通知的科目。</p> : (
          <>
            <div class="scroll"><table class="t compact nw"><thead><tr><th>科目</th><th>人次</th></tr></thead>
              <tbody>{Object.entries(nt.bySubject).sort((a, b) => b[1] - a[1]).map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}</tbody></table></div>
            <p class="small">合計 <b>{nt.total}</b> 人次；其中 <b>{nt.notifiedOnly.length}</b> 位學生只有另行通知科目（不會出現在考程）。</p>
          </>
        )}
      </div>

      <div class="card stack"><div class="lab">多科生科數分布（決定提前開考的依據）</div>
        <div class="scroll"><table class="t compact nw"><thead><tr><th>科數</th><th>學生數</th><th>人次</th></tr></thead>
          <tbody>{dist.rows.map((r) => <tr key={r.subjects}><td>{r.subjects} 科</td><td>{r.students}</td><td>{r.subjects * r.students}</td></tr>)}
            <tr><th>合計</th><th>{dist.students}</th><th>{distSum}</th></tr></tbody></table></div>
        <p class="small">科數 × 人數加總 ＝ <b>{distSum}</b> ＝ 人次 <b>{dist.entries}</b> {distSum === dist.entries ? <Badge tone="ok">✓</Badge> : <Badge tone="danger">✕</Badge>}</p>
      </div>
    </section>
  );
}

function unresolvedNote(n: number) {
  return n > 0 ? <Alert tone="warn">②還有 {n} 筆問題列沒處理，下面的統計還不含這些列。</Alert> : null;
}
