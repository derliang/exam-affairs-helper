/**
 * G37 首次使用精靈（稿 v2.50 §二、§三）：5 步＋總覽。
 * 每步先顯示預設值，可「用預設並下一步」；最後總覽逐項看過才完成，沒有整個精靈一鍵略過。
 * 步驟 ② 沒有預設（名單只有使用者有），空名單可「稍後匯入」並就地匯入（承 G8、G10／G18）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Division, LabelPaper, ScheduleKey } from '../../data';
import { SCHEDULE_KEYS, isDefaultSchedule, scheduleOf } from '../../core/periods';
import { Alert, Badge, Button, Modal, PageHead, Seg, StepNav, type StepState } from '../components';
import { RoomList } from '../components/RoomList';
import {
  DIV_LABEL, WIZARD_STEPS, ensureClassRooms, stepLines, finishWizard, markSeen, setWizardChoice, skipWizard, stepMark, stepProblems, wizardComplete, wizardDivision,
  wizardDivisions, wizardSeen, wizardYear, type WizardDivision, type WizardStep,
} from '../env';
import { DEFAULT_SEAT_HEADER, headerTemplates } from '../header';
import { relabelRosterYear } from '../rosterYears';
import { schoolYear, type Doc } from '../store';
import { RosterIO } from './RosterIO';

export type WizardSettingsTab = 'roster' | 'classes' | 'school' | 'rooms' | 'sched';
export const OVERVIEW = 6;
const DIV_OPTS: { value: WizardDivision; label: string }[] = [{ value: 'senior', label: '高中部' }, { value: 'junior', label: '國中部' }, { value: 'both', label: '兩個都用' }];

export function EnvWizard(p: {
  doc: Doc; step: number; now?: () => Date;
  onStep: (n: number) => void; onChange: (d: Doc) => void;
  /** 跳去共用設定；回來用「← 回到 首次設定 第 N 步」，該步會依新設定重新檢查 */
  onGoSettings: (tab: WizardSettingsTab, division: Division) => void;
  onFinish: () => void;
}) {
  const now = p.now ?? (() => new Date());
  const [skipAsk, setSkipAsk] = useState(false);
  const step = Math.min(Math.max(p.step, 1), OVERVIEW);
  const divs = wizardDivisions(p.doc);
  const seen = wizardSeen(p.doc);
  const stateOf = (n: WizardStep): StepState => (n === step ? 'cur' : stepMark(p.doc, n) === 'done' ? 'done' : stepMark(p.doc, n) === 'later' ? 'stale' : 'todo');
  const steps = [...WIZARD_STEPS.map((s) => ({ no: s.no as number, name: s.name, blurb: s.blurb, state: stateOf(s.no) })), { no: OVERVIEW, name: '總覽與完成', blurb: '逐項看過再完成', state: (step === OVERVIEW ? 'cur' : 'todo') as StepState }];
  const next = (d: Doc, n: WizardStep) => { p.onChange(markSeen(d, n)); p.onStep(n + 1); };
  const prev = step > 1 ? <Button onClick={() => p.onStep(step - 1)}>‹ 上一步</Button> : null;
  const later = <Button onClick={() => setSkipAsk(true)}>稍後再設定</Button>;

  const body = (() => {
    if (step === 1) return <Step1 doc={p.doc} now={now} onApply={(d) => next(d, 1)} later={later} />;
    if (step === 2) return <Step2 doc={p.doc} divs={divs} onChange={p.onChange} onGoSettings={p.onGoSettings} prev={prev} later={later} onNext={(d) => next(d, 2)} />;
    if (step === 3) return <Step3 doc={p.doc} onGoSettings={p.onGoSettings} prev={prev} later={later} onNext={(d) => next(d, 3)} />;
    if (step === 4) return <Step4 doc={p.doc} divs={divs} onChange={p.onChange} onGoSettings={p.onGoSettings} prev={prev} later={later} onNext={(d) => next(d, 4)} />;
    if (step === 5) return <Step5 doc={p.doc} onChange={p.onChange} onGoSettings={p.onGoSettings} prev={prev} later={later} onNext={(d) => next(d, 5)} />;
    return <Overview doc={p.doc} divs={divs} onStep={p.onStep} prev={prev} onFinish={() => { p.onChange(finishWizard(p.doc, now())); p.onFinish(); }} />;
  })();

  return (
    <section>
      <PageHead title="首次設定" badge="先把環境設好" />
      <div class="ws">
        <aside class="side"><StepNav steps={steps} onGo={p.onStep} /></aside>
        <div class="stack" style="min-width:0">
          {step < OVERVIEW && seen.length === 0 && step === 1 && (
            <Alert tone="info" noIcon><b>選好資料夾了。先花約 3 分鐘確認環境。</b>節次表、教室、班級、標籤紙張這些設定，之後每一場考試都會用；現在看過一次，以後安排考試就不會用到你沒看過的預設值。</Alert>
          )}
          {body}
        </div>
      </div>
      {skipAsk && (
        <Modal title="先略過首次設定？" onClose={() => setSkipAsk(false)} actions={<><Button onClick={() => setSkipAsk(false)}>留在首次設定</Button><Button kind="primary" onClick={() => { setSkipAsk(false); p.onChange(skipWizard(p.doc)); p.onFinish(); }}>先略過，稍後再做</Button></>}>
          <p>可以。但程式會用內建預設值（節次表四份、依名單帶出的教室、標籤紙張）排考試，而你還沒看過它們。</p>
          <p style="margin-top:8px"><b>略過後：</b></p>
          <ul class="plain">
            <li>列表頁頂端會一直有「環境尚未確認」橫幅；新增考試時，「本次使用的環境」必須按「確認使用」才能建立。</li>
            <li>已填的進度會保存，隨時可從橫幅或「共用設定」回來接著做。</li>
          </ul>
        </Modal>
      )}
    </section>
  );
}

const Actions = (p: { prev: ComponentChildren; later: ComponentChildren; children: ComponentChildren }) => <div class="btnrow" style="justify-content:space-between;flex-wrap:wrap">{p.prev ?? <span />}<span class="row">{p.later}{p.children}</span></div>;

// ① 學年度與部別
function Step1(p: { doc: Doc; now: () => Date; onApply: (d: Doc) => void; later: ComponentChildren }) {
  const def = schoolYear(p.now());
  const [year, setYear] = useState(wizardYear(p.doc, p.now()));
  const [division, setDivision] = useState<WizardDivision>(wizardDivision(p.doc));
  const years = Array.from(new Set([def - 1, def, def + 1, year])).sort();
  const changed = year !== def || division !== 'senior';
  const apply = () => {
    let d = setWizardChoice(p.doc, { year, division });
    // 名單還是空的就把名單年度標成這一年，之後匯入的名單就屬於這個學年度
    const empty = d.rosters.senior.length === 0 && d.rosters.junior.length === 0 && !d.otherYears;
    if (empty && d.rosterYear !== year) { const r = relabelRosterYear(d, year, p.now()); if (r.ok) d = r.doc; }
    p.onApply(d);
  };
  return (
    <div class="card stack" data-step="1">
      <h3>步驟 1　學年度與部別</h3>
      <div class="field"><span class="label">學年度 <Badge tone="info">預設值：{def} 學年度</Badge></span>
        <Seg label="學年度" value={String(year)} options={years.map((y) => ({ value: String(y), label: `${y} 學年度` }))} onChange={(v) => setYear(Number(v))} />
        <span class="hint">依今天日期帶入（8 月起算新學年度），可改</span></div>
      <div class="field"><span class="label">部別 <Badge tone="info">預設值：高中部</Badge></span>
        <Seg label="部別" value={division} options={DIV_OPTS} onChange={(v) => setDivision(v)} />
        <span class="hint">決定後面顯示哪些班級、節次表（學測、分科用高中部；會考用國中部）</span></div>
      <p class="small muted">這一步的預設值＝今天日期推出的學年度＋高中部。</p>
      <Actions prev={null} later={p.later}><Button kind="primary" onClick={apply}>{changed ? '確認並下一步' : '用預設並下一步'}</Button></Actions>
    </div>
  );
}

type SubProps = { doc: Doc; onGoSettings: (tab: WizardSettingsTab, division: Division) => void; prev: ComponentChildren; later: ComponentChildren; onNext: (d: Doc) => void };

// ② 班級與學生名單：沒有預設（名單只有使用者有）
function Step2(p: SubProps & { divs: Division[]; onChange: (d: Doc) => void }) {
  const problems = stepProblems(p.doc, 2);
  return (
    <div class="card stack" data-step="2">
      <h3>步驟 2　班級與學生名單</h3>
      {p.divs.map((div) => {
        const classes = p.doc.settings.classes.filter((c) => c.division === div).map((c) => ({ c, n: p.doc.rosters[div].filter((s) => s.classNo === c.no).length })).filter((x) => x.n > 0);
        const total = classes.reduce((n, x) => n + x.n, 0);
        return (
          <div key={div} class="stack" data-division={div}>
            {classes.length > 0 ? (
              <>
                <div class="row"><b>{DIV_LABEL[div]}　共 {classes.length} 班、{total} 人</b><Badge tone="ok">✓ 已匯入</Badge></div>
                <div class="scroll" style="overflow-x:auto"><table class="t compact"><thead><tr><th>班級</th><th>班級教室</th><th>人數</th></tr></thead>
                  <tbody>{classes.map((x) => <tr key={x.c.no}><td>{x.c.name}</td><td>{x.c.name}教室</td><td>{x.n}</td></tr>)}</tbody></table></div>
                <div class="btnrow">
                  <Button onClick={() => p.onGoSettings('roster', div)}>修改學生名單 ›</Button>
                  <Button onClick={() => p.onGoSettings('classes', div)}>班級資料 ›</Button>
                </div>
              </>
            ) : (
              <>
                <b>{DIV_LABEL[div]}學生名單</b>
                <RosterIO doc={p.doc} division={div} onChange={p.onChange} variant="zone" />
                <Alert tone="warn">目前沒有{DIV_LABEL[div]}學生名單，所以還沒有班級。班級是從名單讀出來的。可以「稍後再匯入」，但在匯入前無法安排考試（總覽會標琥珀）。</Alert>
              </>
            )}
          </div>
        );
      })}
      <p class="small muted">這一步沒有「用預設」：名單只有你有。班級名稱與班級教室以名單為準，與共用設定是同一份資料。</p>
      <Actions prev={p.prev} later={p.later}>
        <Button kind="primary" onClick={() => p.onNext(p.doc)}>{problems.length ? '稍後匯入，下一步' : '確認並下一步'}</Button>
      </Actions>
    </div>
  );
}

// ③ 節次與時長：科目名稱與每科時長是大考規定（G38，唯讀）；只確認排列
function Step3(p: SubProps) {
  const [key, setKey] = useState<ScheduleKey>('g12');
  const allDefault = SCHEDULE_KEYS.every((x) => isDefaultSchedule(scheduleOf(p.doc.settings, x.key), x.key));
  const t = scheduleOf(p.doc.settings, key);
  const def = isDefaultSchedule(t, key);
  const label = SCHEDULE_KEYS.find((x) => x.key === key)!.label;
  const DAY = ['一', '二', '三', '四'];
  return (
    <div class="card stack" data-step="3">
      <h3>步驟 3　節次與時長</h3>
      <Seg label="節次表" value={key} options={SCHEDULE_KEYS.map((x) => ({ value: x.key, label: x.label }))} onChange={setKey} />
      <div class="row"><b>{label}</b>{def ? <Badge tone="info">內建預設</Badge> : <Badge tone="warn">排列已修改</Badge>}</div>
      <dl class="envsched">
        {t.days.map((d, i) => (
          <div key={i}><dt>第{DAY[i] ?? i + 1}天</dt><dd>{d.map((r) => `${r.name} ${r.minutes ?? ''}`).join('・')} 分鐘</dd></div>
        ))}
      </dl>
      <p class="small muted">科目名稱與時長依大考規定（唯讀）；只有排列可調。{allDefault ? '四份節次表的排列都還是程式內建預設（依正式大考）。' : '有節次表的排列已被修改過，確認是否符合學校的實際安排。'}學校實際把哪科排在哪個時段不同時，才到「節次與時長」調整排列。每場考試依類型與次別自動取對應那一份。</p>
      <div class="btnrow"><Button onClick={() => p.onGoSettings('sched', 'senior')}>調整節次排列 ›</Button></div>
      <Actions prev={p.prev} later={p.later}><Button kind="primary" onClick={() => p.onNext(p.doc)}>{allDefault ? '用預設並下一步' : '確認並下一步'}</Button></Actions>
    </div>
  );
}

// ④ 教室：依班級自動帶出班級教室，沒有名單就沒有班級教室
function Step4(p: SubProps & { divs: Division[]; onChange: (d: Doc) => void }) {
  // 使用者 2026-11-18 裁示：進入步驟 4 就依名冊帶出班級教室（同考試 ③ 的 G11），列上的「編輯座位」才有教室可編；已有的教室不動
  useEffect(() => {
    const next = p.divs.reduce((d, div) => ensureClassRooms(d, div), p.doc);
    if (next !== p.doc) p.onChange(next);
  }, [p.divs.join(','), p.doc.rosters]);
  const problems = stepProblems(p.doc, 4);
  const hasRooms = p.doc.settings.classrooms.some((r) => r.kind === 'class');
  return (
    <div class="card stack" data-step="4">
      <h3>步驟 4　教室</h3>
      {p.divs.map((div) => {
        const rows = p.doc.settings.classes.filter((c) => c.division === div).map((c) => ({ c, n: p.doc.rosters[div].filter((s) => s.classNo === c.no).length })).filter((x) => x.n > 0);
        if (!rows.length) {
          return (
            <Alert key={div} tone="danger" action={<Button onClick={() => p.onGoSettings('roster', div)}>匯入學生名單 ›</Button>}>
              <b>{DIV_LABEL[div]}：還沒有學生名單，所以沒有班級教室可帶入。</b>班級教室是依學生名單的班級自動帶出的；請先匯入名單（會回到這一步），或先新增預備教室（但沒有名單就沒有考生可排）。
            </Alert>
          );
        }
        // 與共用設定、考試 ③ 同一個教室清單（D138）：沒有列入開關；每列多一欄學生人數（座位不夠標紅）
        const count = new Map(rows.map((x) => [x.c.name, x.n]));
        return (
          <div key={div} class="stack" data-division={div}>
            <b>{DIV_LABEL[div]}教室</b>
            <RoomList rooms={p.doc.settings.classrooms} paper={p.doc.settings.defaultLabelPaper} division={div} track="none"
              classes={p.doc.settings.classes} exams={p.doc.exams} inUse={(id) => p.doc.exams.some((e) => e.classroomIds.includes(id))}
              onChange={(classrooms) => p.onChange({ ...p.doc, settings: { ...p.doc.settings, classrooms } })}
              extra={(r) => {
                const n = r.kind === 'class' ? count.get(r.name) : undefined;
                return n === undefined ? null : <Badge tone={r.seatCount < n ? 'danger' : 'ok'}>學生 {n} 人{r.seatCount < n ? `・座位不足 ${n - r.seatCount}` : ''}</Badge>;
              }} />
          </div>
        );
      })}
      {problems.filter((m) => !m.includes('還沒有學生名單')).map((m) => <Alert key={m} tone="danger">{m}。</Alert>)}
      {stepLines(p.doc, 4).filter((l) => l.note).map((l) => <Alert key={l.key} tone="info">{l.note}</Alert>)}
      <p class="small muted">班級教室依名冊的班級自動帶出，座位配置取最接近正方且單邊 ≤ 7（G11），可在上面「編輯座位」調整。也可以 <button type="button" class="linkbtn" onClick={() => p.onGoSettings('rooms', p.divs[0]!)}>到共用設定的教室清單 ›</button></p>
      <Actions prev={p.prev} later={p.later}>
        {/* #343：「稍後處理」也先依名冊帶出班級教室，教室清單才有列可以加座位；同名教室沿用，座位配置不動 */}
        {problems.length
          ? <Button kind="primary" onClick={() => p.onNext(p.divs.reduce((d, div) => ensureClassRooms(d, div), p.doc))}>稍後處理，下一步</Button>
          : <Button kind="primary" onClick={() => p.onNext(p.divs.reduce((d, div) => ensureClassRooms(d, div), p.doc))}>{hasRooms ? '確認並下一步' : '用預設並下一步'}</Button>}
      </Actions>
    </div>
  );
}

// ⑤ 學校表頭與標籤紙張：學校名稱必填，沒有預設
function Step5(p: SubProps & { onChange: (d: Doc) => void }) {
  const s = p.doc.settings;
  const set = (patch: Partial<typeof s>) => p.onChange({ ...p.doc, settings: { ...s, ...patch } });
  const blank = !s.schoolName.trim();
  return (
    <div class="card stack" data-step="5">
      <h3>步驟 5　學校表頭與標籤紙張</h3>
      <div class={`field${blank ? ' err' : ''}`}><label for="w-name">學校名稱</label>
        <input id="w-name" class="input" value={s.schoolName} onChange={(e) => set({ schoolName: e.currentTarget.value })} />
        <span class={blank ? 'field-msg' : 'hint'}>學校名稱是印在座位表與標籤表頭的字，不能留空白。</span></div>
      <div class="field"><label for="w-seat">座位表表頭</label>
        <input id="w-seat" class="input" value={headerTemplates(s).seat} onChange={(e) => set({ seatHeader: e.currentTarget.value })} />
        <span class="hint">{'{學年}、{次別}、{類型} 會自動換成這次考試的內容'}（預設：{DEFAULT_SEAT_HEADER}）</span></div>
      <div class="field"><span class="label">標籤預設紙張</span>
        <Seg label="標籤預設紙張" value={s.defaultLabelPaper} options={[{ value: 'B4', label: 'B4（每間最多 56 座）' }, { value: 'A3', label: 'A3（每間最多 56 座）' }]} onChange={(v) => set({ defaultLabelPaper: v as LabelPaper })} />
        <span class="hint">依你手邊的標籤紙選。座位上限會跟著紙張（教室座位不能超過）。</span></div>
      <div class="btnrow"><Button onClick={() => p.onGoSettings('school', 'senior')}>標籤注意事項、更多表頭設定 ›</Button></div>
      <Actions prev={p.prev} later={p.later}>
        {blank ? <Button kind="primary" disabled>確認並下一步</Button> : <Button kind="primary" onClick={() => p.onNext(p.doc)}>確認並下一步</Button>}
      </Actions>
    </div>
  );
}

// 總覽：逐項看過再完成
function Overview(p: { doc: Doc; divs: Division[]; onStep: (n: number) => void; prev: ComponentChildren; onFinish: () => void }) {
  const done = wizardComplete(p.doc);
  const left = WIZARD_STEPS.filter((s) => stepMark(p.doc, s.no) !== 'done').length;
  const summary = (n: WizardStep): string => {
    const m = stepMark(p.doc, n);
    if (m === 'todo') return '還沒看過';
    if (n === 1) return `${wizardYear(p.doc, new Date())} 學年度・${DIV_OPTS.find((o) => o.value === wizardDivision(p.doc))!.label}`;
    if (n === 2) return m === 'later' ? '尚未匯入學生名單；匯入前不能新增考試' : p.divs.map((d) => `${DIV_LABEL[d]} ${p.doc.rosters[d].length} 人`).join('、');
    if (n === 3) return SCHEDULE_KEYS.every((x) => isDefaultSchedule(scheduleOf(p.doc.settings, x.key), x.key)) ? '4 份節次表：用內建預設（你已看過）' : '4 份節次表：有排列已修改';
    if (n === 4) return m === 'later' ? '還沒有班級教室；名單匯入後自動帶出' : '班級教室已備妥';
    return `${p.doc.settings.schoolName || '（學校名稱空白）'}・標籤 ${p.doc.settings.defaultLabelPaper}`;
  };
  return (
    <div class="card stack" data-step="overview">
      <h3>總覽：這些設定之後每場考試都會用</h3>
      {done
        ? <Alert tone="ok">五項都看過了。按「完成設定」，環境就標為「已確認」。</Alert>
        : <Alert tone="warn"><b>還有 {left} 項沒完成，仍可先完成設定。</b>環境會標為「尚未確認」，列表頁頂端保留橫幅，新增考試時也會請你補完。</Alert>}
      <ul class="envrows">
        {WIZARD_STEPS.map((s) => {
          const m = stepMark(p.doc, s.no);
          return (
            <li key={s.no} class={`envrow e-${m === 'done' ? 'ok' : 'warn'}`}>
              <span class="envmk" aria-hidden="true">{m === 'done' ? '✓' : '▲'}</span>
              <span class="envlab">{s.name}</span>
              <span class="envtext">{summary(s.no)}</span>
              <Button small onClick={() => p.onStep(s.no)}>{m === 'done' ? '查看／修改 ›' : '前往補做 ›'}</Button>
            </li>
          );
        })}
      </ul>
      <Actions prev={p.prev} later={null}><Button kind="primary" onClick={p.onFinish}>{done ? '完成設定' : '先完成，稍後補做'}</Button></Actions>
    </div>
  );
}
