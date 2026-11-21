import { useEffect, useState } from 'preact/hooks';
import type { ExamKind, Semester } from '../../data';
import { Alert, Button, PageHead } from '../components';
import { checkExamName } from '../flow';
import { confirmEnv, envReport } from '../env';
import { EnvCard } from './EnvCard';
import { ExamDatesFields, packDates } from './ExamDatesFields';
import { defaultSemester, newExam, nextRound, previousExam, schoolYear, suggestExamName, type Doc } from '../store';

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const TYPES: { kind: ExamKind; level: string; title: string; subj: string }[] = [
  { kind: 'gsat', level: '高中部', title: '學測模擬考', subj: '國、英、數（第 3 次起分數 A、數 B）、自然、社會' },
  { kind: 'ast', level: '高中部', title: '分科模擬考', subj: '數學甲、數學乙、物理、化學、生物、歷史、地理、公民與社會；每科都是選考，國英不加考' },
  { kind: 'bcct', level: '國中部', title: '會考模擬考', subj: '國文、英語閱讀、英語聽力、數學、社會、自然、寫作測驗（固定七科），不分文理組、沒有選考' },
];

/** 新增模擬考整頁三段式：1 選類型、2 基本資料、3 預設設定（沿用上一次同類型） */
/**
 * #344：新增頁還沒建立前的草稿（類型與已填欄位）。去共用設定改環境再回來時由 App 帶回，不重設。
 * 「…Edited」記使用者是否自己改過，沒改過的欄位換類型時仍跟著推算。
 */
export interface NewExamDraft {
  kind: ExamKind; name: string; edited: boolean; semester: Semester; semEdited: boolean;
  yearText: string; round: number; roundEdited: boolean;
}

export function NewExam(p: {
  doc: Doc; onCancel: () => void; onCreate: (d: Doc, examId: string) => void; now?: () => Date;
  /** #344：上次離開時的草稿（從共用設定「← 回到」時帶回）；沒有就從預設開始 */
  draft?: NewExamDraft | undefined;
  /** #344：草稿每次變動都回報，讓 App 在離開本頁後仍保留 */
  onDraft?: (d: NewExamDraft) => void;
  /** G37：按「確認使用」把環境快照存進共用設定 */
  onEnv?: (d: Doc) => void;
  /** G37：跳去共用設定修改環境（有「← 回到」導覽） */
  onGoSettings?: (tab: 'roster' | 'classes' | 'school' | 'rooms' | 'sched', division: 'senior' | 'junior') => void;
}) {
  const now = p.now ?? (() => new Date());
  const d0 = p.draft;
  const [kind, setKind] = useState<ExamKind>(d0?.kind ?? 'gsat');
  const [name, setName] = useState(() => d0?.name ?? suggestExamName(p.doc, 'gsat', now()));
  // 使用者沒自己改過名稱時，換類型就跟著換建議名稱
  const [edited, setEdited] = useState(d0?.edited ?? false);
  const [semester, setSemester] = useState<Semester>(d0?.semester ?? defaultSemester('gsat'));
  // 使用者沒自己改過學期時，換類型就跟著換預設學期（D91）
  const [semEdited, setSemEdited] = useState(d0?.semEdited ?? false);
  // 學年度預設依今天算，可改（補登過去學年的考試，#211）；使用者沒改過就不鎖定
  const [yearText, setYearText] = useState(() => d0?.yearText ?? String(schoolYear(now())));
  // 次別（G3）：學測、分科在這裡決定；沒自己改過就跟著類型與學年度推算
  const [round, setRound] = useState(() => d0?.round ?? nextRound(p.doc, 'gsat', now()));
  const [roundEdited, setRoundEdited] = useState(d0?.roundEdited ?? false);
  useEffect(() => {
    p.onDraft?.({ kind, name, edited, semester, semEdited, yearText, round, roundEdited });
  }, [kind, name, edited, semester, semEdited, yearText, round, roundEdited]);
  const [day1, setDay1] = useState(''); // #389：考試日期（選填）
  const [day2, setDay2] = useState('');
  const [err, setErr] = useState('');
  const check = checkExamName(p.doc, name);
  const prev = previousExam(p.doc, kind);
  const isJ = kind === 'bcct';
  const yearNum = Number(yearText);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 90 && yearNum <= 200;
  const hasRound = kind !== 'bcct';
  // G37：環境確認是步驟 1 的門——沒確認（琥珀）或缺必要設定（紅）都不能建立
  const envRep = envReport(p.doc, kind, hasRound ? round : undefined);
  const envOk = envRep.state === 'confirmed';
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
    if (!check.ok || !yearOk || !envOk) return;
    const t = now();
    const year = Number(yearText);
    const r = newExam(p.doc, kind, name, t, { semester, year, ...(kind === 'gsat' ? { round } : {}), ...(prev ? { prev } : {}), ...(packDates(day1, day2) ? { examDates: packDates(day1, day2)! } : {}) });
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
              const k = t.kind;
              const on = kind === k;
              return (
                <button type="button" key={t.title} class="tcard" aria-pressed={on} onClick={() => pick(k)}>
                  <span class="lv">{t.level}</span><strong>{t.title}</strong><span class="subj">{t.subj}</span>
                  {on ? <span class="tick badge b-acc">已選</span> : null}
                </button>
              );
            })}
          </div>
          <p class="small muted">高中部：學測、分科；國中部：會考。補考不在這裡新增，請從上方導覽列的「補考」進入。</p>

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
            <ExamDatesFields day1={day1} day2={day2} onChange={(a, b) => { setDay1(a); setDay2(b); }} />
            <div class="field"><span class="label">對象</span>
              <div class="input" style="display:flex;align-items:center">{isJ ? '國三' : '高三'}</div>
              <span class="hint">由類型決定</span></div>
          </div>
        </div>

        <EnvCard doc={p.doc} kind={kind} round={hasRound ? round : undefined}
          onConfirm={() => p.onEnv?.(confirmEnv(p.doc, kind, hasRound ? round : undefined, now()))}
          {...(p.onGoSettings ? { onGoSettings: (tab: 'roster' | 'classes' | 'school' | 'rooms' | 'sched') => p.onGoSettings!(tab, isJ ? 'junior' : 'senior') } : {})} />

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
          {!envOk && <span class="small muted" role="status">先確認上面「本次使用的環境」才能建立</span>}
          <Button kind="primary" disabled={!check.ok || !yearOk || !envOk} onClick={submit}>建立並開始</Button>
        </div>
      </div>
    </section>
  );
}
