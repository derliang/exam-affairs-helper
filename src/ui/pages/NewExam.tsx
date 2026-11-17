import { useState } from 'preact/hooks';
import type { ExamKind, Semester } from '../../data';
import { Alert, Button, PageHead } from '../components';
import { checkExamName } from '../flow';
import { defaultSemester, newExam, nextRound, previousExam, schoolYear, suggestExamName, type Doc } from '../store';

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const TYPES: { kind: ExamKind; level: string; title: string; subj: string; soon?: boolean }[] = [
  { kind: 'gsat', level: '高中部', title: '學測模擬考', subj: '國、英、數（第 3 次起分數 A、數 B）、自然、社會' },
  { kind: 'ast', level: '高中部', title: '分科模擬考', subj: '數學甲、數學乙、物理、化學、生物、歷史、地理、公民與社會；每科都是選考，國英不加考' },
  { kind: 'bcct', level: '國中部', title: '會考模擬考', subj: '國文、英語閱讀、英語聽力、數學、社會、自然、寫作測驗（固定七科），不分文理組、沒有選考' },
];

/** 新增模擬考整頁三段式：1 選類型、2 基本資料、3 預設設定（沿用上一次同類型） */
export function NewExam(p: { doc: Doc; onCancel: () => void; onCreate: (d: Doc, examId: string) => void; now?: () => Date }) {
  const now = p.now ?? (() => new Date());
  const [kind, setKind] = useState<ExamKind>('gsat');
  const [name, setName] = useState(() => suggestExamName(p.doc, 'gsat', (p.now ?? (() => new Date()))()));
  // 使用者沒自己改過名稱時，換類型就跟著換建議名稱
  const [edited, setEdited] = useState(false);
  const [semester, setSemester] = useState<Semester>(defaultSemester('gsat'));
  // 使用者沒自己改過學期時，換類型就跟著換預設學期（D91）
  const [semEdited, setSemEdited] = useState(false);
  // 學年度預設依今天算，可改（補登過去學年的考試，#211）；使用者沒改過就不鎖定
  const [yearText, setYearText] = useState(() => String(schoolYear(now())));
  // 次別（G3）：學測、分科在這裡決定；沒自己改過就跟著類型與學年度推算
  const [round, setRound] = useState(() => nextRound(p.doc, 'gsat', (p.now ?? (() => new Date()))()));
  const [roundEdited, setRoundEdited] = useState(false);
  const [err, setErr] = useState('');
  const check = checkExamName(p.doc, name);
  const prev = previousExam(p.doc, kind);
  const isJ = kind === 'bcct';
  const yearNum = Number(yearText);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 90 && yearNum <= 200;
  const hasRound = kind !== 'bcct';
  const rounds = Array.from({ length: Math.max(4, round) }, (_, i) => i + 1);
  const onYear = (v: string) => {
    setYearText(v);
    const y = Number(v);
    if (Number.isInteger(y) && y >= 90 && y <= 200) {
      const r = roundEdited ? round : nextRound(p.doc, kind, now(), y);
      if (!roundEdited) setRound(r);
      if (!edited) setName(suggestExamName(p.doc, kind, now(), y, hasRound ? r : undefined));
    }
  };
  const onRound = (r: number) => {
    setRound(r); setRoundEdited(true);
    if (!edited) setName(suggestExamName(p.doc, kind, now(), yearNum, r));
  };

  const pick = (k: ExamKind) => {
    setKind(k); setErr('');
    const r = roundEdited ? round : nextRound(p.doc, k, now(), yearNum);
    if (!roundEdited) setRound(r);
    if (!edited) setName(suggestExamName(p.doc, k, now(), yearNum, k === 'bcct' ? undefined : r));
    if (!semEdited) setSemester(defaultSemester(k));
  };
  const submit = () => {
    if (!check.ok || !yearOk) return;
    const t = now();
    const year = Number(yearText);
    const r = newExam(p.doc, kind, name, t, { semester, year, ...(kind === 'gsat' ? { round } : {}), ...(prev ? { prev } : {}) });
    if (!r.ok) { setErr(r.error); return; }
    p.onCreate(r.doc, r.doc.exams[r.doc.exams.length - 1]!.id);
  };

  return (
    <section>
      <PageHead crumbs={[{ label: '模擬考列表', onClick: p.onCancel }]} title="新增模擬考" />
      <div class="stack" style="max-width:860px">
        <p class="muted">先選類型，類型決定科目表、組別對照表和標示規則。</p>

        <div class="card stack"><div class="lab">1　選類型</div>
          <div class="typegrid">
            {TYPES.map((t) => {
              const on = !t.soon && kind === t.kind;
              return (
                <button type="button" key={t.kind} class="tcard" aria-pressed={on} disabled={t.soon} aria-disabled={t.soon} onClick={() => pick(t.kind)}>
                  <span class="lv">{t.level}</span><strong>{t.title}</strong><span class="subj">{t.subj}</span>
                  {t.soon ? <span class="tick badge b-soon">尚未開放</span> : on ? <span class="tick badge b-acc">已選</span> : null}
                </button>
              );
            })}
          </div>
          <p class="small muted">高中部：學測、分科；國中部：會考。</p>

        <div class="psec"><div class="lab">2　基本資料</div>
          {/* G17：兩欄對齊——「學年度｜學期」「名稱｜對象」各一列，「次別」整列、說明在格子下方跨整行；手機單欄 */}
          <div class="newgrid">
            <div class={`field${yearOk ? '' : ' err'}`}><label for="exam-year">學年度</label>
              <input id="exam-year" class="input" inputMode="numeric" value={yearText} aria-invalid={!yearOk} onInput={(e) => onYear(e.currentTarget.value)} />
              <span class={yearOk ? 'hint' : 'field-msg'}>{yearOk ? '預設依今天的日期（8 月起算新學年）；補登過去學年的考試可改，例如 114' : '請填民國年，例如 114'}</span></div>
            <div class="field"><label for="exam-term">學期</label>
              <div class="termcards" role="group" aria-label="學期" id="exam-term">
                {([['first', '上學期'], ['second', '下學期']] as const).map(([v, l]) => (
                  <button type="button" key={v} class="tcard term" aria-pressed={semester === v} onClick={() => { setSemester(v); setSemEdited(true); }}>
                    <strong>{l}</strong>{semester === v && <span class="tick badge b-acc">已選</span>}
                  </button>
                ))}
              </div>
              <span class="hint">學測預設上學期、分科預設下學期（切換類型時自動帶入，仍可自己改）</span></div>
            {hasRound && (
              <div class="field newgrid-wide"><span class="label" id="round-label">次別（第幾次）</span>
                <div class="roundgrid" role="group" aria-labelledby="round-label">
                  {rounds.map((n) => (
                    <button type="button" key={n} class="rbtn" aria-pressed={round === n} onClick={() => onRound(n)}>第{CN[n] ?? n}次</button>
                  ))}
                </div>
                <span class="hint">{kind === 'gsat' ? '第 1、2 次數學是單一科，第 3 次起分為數學A、數學B；建立後可在第 1 步「修改基本資料」更改' : '分科每次考的科目都一樣，次別只用在名稱'}</span></div>
            )}
            <div class={`field${!check.ok ? ' err' : ''}`}><label for="exam-name">模擬考名稱</label>
              <input id="exam-name" class="input" value={name} aria-invalid={!check.ok} onInput={(e) => { setName(e.currentTarget.value); setEdited(true); }} />
              <span class={check.ok ? 'hint' : 'field-msg'}>{check.ok ? '資料夾名稱會用這個名稱' : check.message}</span></div>
            <div class="field"><span class="label">對象</span>
              <div class="input" style="display:flex;align-items:center">{isJ ? '國三' : '高三'}</div>
              <span class="hint">由類型決定</span></div>
          </div>
        </div>

        <div class="psec"><div class="lab">3　預設設定</div>
          {prev
            ? <Alert tone="info" noIcon><b>會帶入「{prev.name}」的設定</b>：學生名單、教室、{isJ ? '' : '標示與抽離規則、'}名稱以外的選項。每一步都能再改，改了不影響舊的模擬考。</Alert>
            : <Alert tone="warn">還沒有同類型的模擬考，所有步驟從空白開始。</Alert>}
          {isJ && <Alert tone="info">會考不需要標示與抽離，步驟④會顯示「不需要」。</Alert>}
        </div>
        </div>

        {err && <Alert tone="danger">{err}</Alert>}
        <div class="btnrow" style="justify-content:flex-end">
          <Button onClick={p.onCancel}>取消</Button>
          <Button kind="primary" disabled={!check.ok || !yearOk} onClick={submit}>建立並開始</Button>
        </div>
      </div>
    </section>
  );
}
