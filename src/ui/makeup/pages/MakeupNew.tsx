/** S-1「新增場次」：名稱、學年度（依今天推算）、學期；有上一次補考就沿用教室與時長（F-6） */
import { useState } from 'preact/hooks';
import { Alert, Button, PageHead } from '../../components';
import { SEMESTER_TEXT, defaultMakeupName, schoolYearOf, semesterOf, type MakeupSemester, type MakeupSession } from '../session';

export function MakeupNew(p: {
  now: Date;
  /** 沿用來源（最近一次有設教室的補考）；沒有就不顯示沿用提示 */
  prev: MakeupSession | undefined;
  onCancel: () => void;
  onCreate: (o: { name: string; year: number; semester: MakeupSemester }) => void;
}) {
  const [year, setYear] = useState(String(schoolYearOf(p.now)));
  const [semester, setSemester] = useState<MakeupSemester>(semesterOf(p.now));
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const y = Number(year.trim());
  const auto = Number.isInteger(y) ? defaultMakeupName(y, semester) : '';
  const create = () => {
    if (!Number.isInteger(y) || y < 90 || y > 200) { setErr('學年度要是民國年（例如 115）'); return; }
    p.onCreate({ name: name.trim() || defaultMakeupName(y, semester), year: y, semester });
  };
  return (
    <section class="stack">
      <PageHead title="新增補考場次" badge="補考模式" />
      <div class="card stack">
        <div class="field"><label for="mk-name">場次名稱</label>
          <input id="mk-name" class="input" placeholder={auto} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <span class="hint">不填就用「{auto || '○ 學年第 ○ 學期補考'}」。</span></div>
        <div class={`field${err ? ' err' : ''}`}><label for="mk-year">學年度</label>
          <input id="mk-year" class="input" inputMode="numeric" value={year} onInput={(e) => { setYear(e.currentTarget.value); setErr(''); }} />
          <span class={err ? 'field-msg' : 'hint'}>{err || `學年度依今天的日期推算（${schoolYearOf(p.now)}），可改。`}</span></div>
        <div class="field"><span class="label">學期</span>
          <div class="termcards" role="group" aria-label="學期">
            {(['first', 'second', 'summer'] as const).map((v) => (
              <button type="button" key={v} class="tcard term" aria-pressed={semester === v} onClick={() => setSemester(v)}><strong>{SEMESTER_TEXT[v]}</strong>{semester === v && <span class="tick badge b-acc">已選</span>}</button>
            ))}
          </div></div>
        {p.prev
          ? <Alert tone="info">已沿用上一次補考「<b>{p.prev.name}</b>」的教室（{p.prev.rooms.length} 間）、座位與每節時長。日期、考日對應與名單不會帶入，全部都能再改。</Alert>
          : <Alert tone="info">這是第一個補考場次：教室與時長從預設開始，之後的場次會自動沿用。</Alert>}
        <div class="row"><Button onClick={p.onCancel}>取消</Button><Button kind="primary" onClick={create}>建立並開始 ①</Button></div>
      </div>
    </section>
  );
}
