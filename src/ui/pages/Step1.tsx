import { useEffect, useState } from 'preact/hooks';
import type { ExamConfig, Semester, Subject } from '../../data';
import { Alert, Badge, Button, ConfirmButton, Modal, More, Seg, StepHead, Stepper } from '../components';
import { ExamDatesFields, packDates } from './ExamDatesFields';
import { ExamTimesBlock } from './ExamTimesBlock';
import { scheduleKeyOf, scheduleOf } from '../../core/periods';
import { carryMode, carryRows, carrySource, resumeCarry, stopCarry } from '../carry';
import { confirmCopy } from '../flow';
import { updateExam, examLabel, examYear, KIND_LABEL, type Doc } from '../store';
import { defaultSubjects, isCustomized, mathSplit, removeSubject, saveSubject, subjectTags, subjectWho, WHO_LABEL, type SubjectWho } from '../subjects';

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** ① 考試設定：基本資料卡、考科表卡（含「誰要考」）、沿用上次設定卡（原型 v1） */
export function Step1(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void; openBasic?: boolean; openTimes?: boolean; onToSched?: () => void }) {
  const { exam, doc } = p;
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [basic, setBasic] = useState(!!p.openBasic);
  useEffect(() => { if (p.openTimes) document.getElementById('x-times')?.scrollIntoView?.({ block: 'start' }); }, []);
  const set = (patch: Partial<ExamConfig>) => {
    const r = updateExam(doc, exam.id, patch);
    if (r.ok) { setErr(''); p.onChange(r.doc); } else setErr(r.error);
  };
  const fixed = exam.kind === 'bcct';
  const gsat = exam.kind === 'gsat';
  const round = exam.round ?? 1;
  const custom = isCustomized(exam.subjects);
  const prev = carrySource(doc, exam);
  const mode = carryMode(doc, exam);

  return (
    <section class="stack">
      <StepHead title="① 考試設定" />

      <div class="card stack">
        {/* G3：類型、學期、學年度、次別在新增時已設定；這裡只留唯讀摘要，要改開小視窗 */}
        <div class="row basicbar" style="justify-content:space-between">
          <div>
            <div class="lab">基本資料（新增時已設定）</div>
            <p id="x-basic"><b>{exam.name}</b>　{examYear(exam)} 學年・{exam.semester === 'second' ? '下' : '上'}學期・<Badge>{examLabel(exam)}</Badge>{gsat ? ` 第${CN[round] ?? round}次` : ''}・{exam.division === 'senior' ? '高三' : '國三'}</p>
            <p class="small muted">只確認考科；類型、學期、次別在新增時已設定。</p>
          </div>
          <Button onClick={() => setBasic(true)}>修改基本資料</Button>
        </div>
        {/* #473、D177：考試日期與各節時間放在第 1 步最上面；各節時間就地展開設定（稿 v2.79） */}
        <ExamTimesBlock exam={exam} table={scheduleOf(doc.settings, scheduleKeyOf(exam.kind, exam.round))} open={!!p.openTimes} onChange={(dayTimes) => set({ dayTimes })} onEditDates={() => setBasic(true)} />
        {err && <Alert tone="danger">{err}</Alert>}

      {/* 稿 v2.31：三張卡合成一張卡，區塊內上下分區：基本資料（含次別）／考科表／沿用上次 */}
      <div class="psec">
        <div class="row" style="justify-content:space-between">
          <div><h3>本次考科</h3>{!fixed && <p class="small muted">依類型與次別自動帶出，可以新增、編輯、刪除</p>}</div>
          {!fixed && (
            <div class="row">
              {custom && <ConfirmButton kind="default" copy={confirmCopy.resetSubjects()} onConfirm={() => set({ subjects: defaultSubjects(exam.kind, exam.round) })}>還原本次考科</ConfirmButton>}
              <Button onClick={() => setEditing({ id: null })}>新增考科</Button>
            </div>
          )}
        </div>
        {fixed && <Alert tone="info"><b>會考科目固定為七科</b>：國文、英語閱讀、英語聽力、數學、社會、自然、寫作測驗，不能新增、刪除或修改。</Alert>}
        {gsat && <More title="說明：這個類型的考科規則">第 1、2 次：數學、英聽；第 3、4 次：數 A、數 B（無英聽）。{mathSplit(round) ? `目前第${CN[round] ?? round}次，數學分為數學A、數學B。` : ''}</More>}
        {custom && <Alert tone="warn">考科表已自訂：切換次別不會重設考科；④ 的組別對照表要重新確認。</Alert>}
        <div class="rtw"><table class="t compact subj-t rt-t rt-a">
          <thead><tr><th>科目</th><th>誰要考</th><th /></tr></thead>
          <tbody>
            {exam.subjects.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b>{subjectTags(exam.kind, s).map((t) => <> <Badge key={t.text} {...(t.tone === 'warn' ? { tone: 'warn' as const } : {})}>{t.text}</Badge></>)}</td>
                <td>{WHO_LABEL[subjectWho(exam.kind, s)]}</td>
                <td>{fixed
                  ? <div class="row" style="justify-content:flex-end"><Badge>固定</Badge></div>
                  : <div class="row" style="flex-wrap:nowrap;justify-content:flex-end">
                    <Button small onClick={() => setEditing({ id: s.id })}>編輯</Button>
                    <ConfirmButton small copy={confirmCopy.deleteSubject(s.name)} onConfirm={() => set({ subjects: removeSubject(exam.subjects, s.id) })}>刪除</ConfirmButton>
                  </div>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <More title="說明：「誰要考」怎麼決定">{fixed ? '會考每科都考，沒有選考。' : '「依組別代碼決定」的科目，在步驟④用組別對照表設定誰考、誰不考。'}</More>
      </div>

      <div class="psec">
        <div><h3>沿用上次的設定</h3><p class="small muted">新增時自動帶入，不用手動複製</p></div>
        {mode === 'off' && (
          <Alert tone="warn" action={prev && <Button small onClick={() => p.onChange(resumeCarry(doc, exam))}>恢復沿用</Button>}>
            <b>已改為不沿用</b>：{exam.division === 'junior' ? '② 到 ⑤' : '② 到 ④'} 都從空白開始，需要重新匯入名單、設定教室與規則。
          </Alert>
        )}
        {mode === 'none' && <Alert tone="warn">還沒有更早的「{KIND_LABEL[exam.kind].replace(/（.*）/, '')}」可以沿用，{exam.division === 'junior' ? '② 到 ⑤' : '② 到 ④'} 從空白開始。</Alert>}
        {mode === 'on' && prev && (
          <>
            <Alert tone="info" action={<Button small onClick={() => p.onChange(stopCarry(doc, exam))}>不沿用，從空白開始</Button>}>
              已自動帶入「<b>{prev.name}</b>」的設定，每一步都能再改，改了不影響「{prev.name}」。
            </Alert>
            <More title={`查看沿用內容（${exam.division === 'junior' ? '② 到 ⑤' : '② 到 ④'} 各步的狀態）`}><div class="rtw"><table class="t compact rt-t">
              <thead><tr><th>步驟</th><th>狀態</th><th>內容</th></tr></thead>
              <tbody>
                {carryRows(doc, exam, prev).map((r) => (
                  <tr key={r.step}><td class="ti" data-label="步驟">{r.step}</td><td data-label="狀態"><Badge {...(r.tone === 'ok' || r.tone === 'warn' ? { tone: r.tone } : {})}>{r.badge}</Badge></td><td data-label="內容" class="wide">{r.text}</td></tr>
                ))}
              </tbody>
            </table></div></More>
          </>
        )}
      </div>
      </div>

      {basic && <BasicModal exam={exam} onClose={() => setBasic(false)} onSave={(patch) => { set(patch); setBasic(false); }} />}
      {editing && <SubjectModal exam={exam} id={editing.id} onClose={() => setEditing(null)}
        onSave={(list) => { set({ subjects: list }); setEditing(null); }} />}
    </section>
  );
}

/** 修改基本資料（G3）：欄位同新增頁；類型建立後不可改。改次別時沿用「考科表沒自訂過就重新帶入」的規則 */
function BasicModal(p: { exam: ExamConfig; onClose: () => void; onSave: (patch: Partial<ExamConfig>) => void }) {
  const { exam } = p;
  const gsat = exam.kind === 'gsat';
  const [name, setName] = useState(exam.name);
  const [year, setYear] = useState(String(examYear(exam)));
  const [semester, setSemester] = useState<Semester>(exam.semester);
  const [round, setRound] = useState(exam.round ?? 1);
  const [day1, setDay1] = useState(exam.examDates?.[0] ?? '');
  const [day2, setDay2] = useState(exam.examDates?.[1] ?? '');
  const [err, setErr] = useState('');
  const rounds = Array.from({ length: Math.max(4, round) }, (_, i) => i + 1);
  const save = () => {
    const y = Number(year.trim());
    if (!Number.isInteger(y) || y < 90 || y > 200) { setErr('學年度要是民國年（例如 114）'); return; }
    const oldRound = exam.round ?? 1;
    p.onSave({
      name, schoolYear: y, semester, examDates: packDates(day1, day2),
      ...(gsat ? { round, ...(round !== oldRound && !isCustomized(exam.subjects) ? { subjects: defaultSubjects(exam.kind, round) } : {}) } : {}),
    });
  };
  return (
    <Modal title="修改基本資料" onClose={p.onClose}
      actions={<><Button onClick={p.onClose}>取消</Button><Button kind="primary" onClick={save}>儲存</Button></>}>
      <div class="stack">
        <div class="field"><label for="b-name">模擬考名稱</label>
          <input id="b-name" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <span class="hint">子資料夾名稱同步更換</span></div>
        <div class={`field${err ? ' err' : ''}`}><label for="b-year">學年度</label>
          <input id="b-year" class="input" inputMode="numeric" value={year} onInput={(e) => { setYear(e.currentTarget.value); setErr(''); }} />
          {err && <span class="field-msg">{err}</span>}</div>
        <div class="field"><span class="label">學期</span>
          <div class="termcards" role="group" aria-label="學期">
            {([['first', '上學期'], ['second', '下學期']] as const).map(([v, l]) => (
              <button type="button" key={v} class="tcard term" aria-pressed={semester === v} onClick={() => setSemester(v)}><strong>{l}</strong>{semester === v && <span class="tick badge b-acc">已選</span>}</button>
            ))}
          </div></div>
        <ExamDatesFields day1={day1} day2={day2} onChange={(a, b) => { setDay1(a); setDay2(b); }} />
        {gsat && (
          <div class="field"><span class="label">次別</span>
            <Seg<string> label="次別" value={String(round)} onChange={(v) => setRound(Number(v))} options={rounds.map((n) => ({ value: String(n), label: `第${CN[n] ?? n}次` }))} />
            <Stepper label="次別" value={round} min={1} max={20} onChange={setRound} />
            <span class="hint">改次別時，考科表沒自訂過會重新帶入；④ 會標為過期。</span></div>
        )}
        <div class="field"><span class="label">類型與對象</span>
          <div class="input" style="display:flex;align-items:center;gap:8px;background:var(--surface)"><Badge>{examLabel(exam)}</Badge>{exam.division === 'senior' ? '高三' : '國三'}</div>
          <span class="hint">建立後不可更改類型</span></div>
      </div>
    </Modal>
  );
}

/** 新增／編輯一科：名稱＋誰要考（原型「編輯」開視窗） */
function SubjectModal(p: { exam: ExamConfig; id: string | null; onClose: () => void; onSave: (list: Subject[]) => void }) {
  const cur = p.id ? p.exam.subjects.find((s) => s.id === p.id) : undefined;
  const [name, setName] = useState(cur?.name ?? '');
  const [who, setWho] = useState<SubjectWho>(cur ? subjectWho(p.exam.kind, cur) : 'all');
  const [err, setErr] = useState('');
  const save = () => {
    const r = saveSubject(p.exam.kind, p.exam.subjects, p.id, name, who);
    if (r.ok) p.onSave(r.list); else setErr(r.error);
  };
  return (
    <Modal title={p.id ? '編輯考科' : '新增考科'} onClose={p.onClose}
      actions={<><Button onClick={p.onClose}>取消</Button><Button kind="primary" onClick={save}>儲存</Button></>}>
      <div class="stack">
        <div class={`field${err ? ' err' : ''}`}><label for="sj-name">科目名稱</label>
          <input id="sj-name" class="input" placeholder="輸入考科名稱" value={name} onInput={(e) => { setName(e.currentTarget.value); setErr(''); }} />
          <span class={err ? 'field-msg' : 'hint'}>{err || '必填；改過的科目會標「已自訂」'}</span></div>
        <div class="field"><label for="sj-who">誰要考</label>
          <select id="sj-who" class="input" value={who} onChange={(e) => setWho(e.currentTarget.value as SubjectWho)}>
            <option value="all">{WHO_LABEL.all}</option><option value="group">{WHO_LABEL.group}</option>
          </select>
          <span class="hint">「依組別代碼決定」的科目，在步驟④設定誰考、誰不考</span></div>
      </div>
    </Modal>
  );
}
