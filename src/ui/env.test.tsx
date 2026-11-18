/** G37 首次使用精靈與環境確認（稿 v2.50）：學測、分科、會考的環境摘要、燈號、快照比對、精靈與列表橫幅（全假資料） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createMemoryFS, loadDoc, saveDoc } from '../data';
import type { ExamKind } from '../data';
import { moveRow, withSchedule, scheduleOf } from '../core/periods';
import {
  confirmEnv, ensureClassRooms, envBanner, envReport, finishWizard, markSeen, setWizardChoice, skipWizard, stepMark, stepProblems, wizardComplete, WIZARD_STEPS,
} from './env';
import { Exams } from './pages/Exams';
import { EnvCard } from './pages/EnvCard';
import { EnvWizard } from './pages/EnvWizard';
import { NewExam } from './pages/NewExam';
import { demoDoc, emptyDoc, withDefaults } from './repository';
import type { Doc } from './store';

const NOW = new Date('2026-11-17T02:00:00Z');
const noop = () => undefined;
const KINDS: { kind: ExamKind; round?: number; label: string }[] = [
  { kind: 'gsat', round: 4, label: '學測第 3、4 次' }, { kind: 'ast', label: '分科' }, { kind: 'bcct', label: '會考' },
];
/** 假資料：高三 2 班各 3 人、國三 1 班 2 人；學校名稱有填（demoDoc 的班級教室名稱與班級不同，所以會自動帶出） */
const doc0 = (): Doc => demoDoc();

describe('環境摘要與燈號（學測、分科、會考）', () => {
  for (const k of KINDS) {
    it(`${k.label}：沒確認過＝琥珀 → 確認使用 → 綠；快照存在設定檔`, () => {
      const d = doc0();
      const r0 = envReport(d, k.kind, k.round);
      expect(r0.state).toBe('never');
      expect(r0.tone).toBe('warn');
      expect(r0.lines.map((l) => l.label)).toEqual(['節次表', '班級與人數', '教室與座位', '學校與標籤紙張']);
      expect(r0.lines[0]!.text).toContain(k.label);
      const d1 = confirmEnv(d, k.kind, k.round, NOW);
      expect(d1.settings.env?.confirmedAt).toBe(NOW.toISOString());
      const r1 = envReport(d1, k.kind, k.round);
      expect(r1.state).toBe('confirmed');
      expect(r1.tone).toBe('ok');
      expect(r1.changes).toEqual([]);
    });
  }
  it('會考看國三名單；高三名單空也不影響會考', () => {
    const d = { ...doc0(), rosters: { senior: [], junior: doc0().rosters.junior } };
    expect(envReport(d, 'bcct').lines[1]!.text).toBe('國三 1 班、2 人');
    expect(envReport(d, 'gsat', 1).state).toBe('blocked');
    expect(envReport(d, 'bcct').state).toBe('never');
  });
  it('第 1、2 次與第 3、4 次各用自己那份節次表', () => {
    const d = doc0();
    expect(envReport(d, 'gsat', 1).lines[0]!.key).toBe('sched:g12');
    expect(envReport(d, 'gsat', 3).lines[0]!.key).toBe('sched:g34');
    expect(envReport(d, 'ast').lines[0]!.key).toBe('sched:ast');
    expect(envReport(d, 'bcct').lines[0]!.key).toBe('sched:bcct');
  });
  it('確認「學測」不會順便放行「會考」或其他節次表', () => {
    const d1 = confirmEnv(doc0(), 'gsat', 4, NOW);
    expect(envReport(d1, 'gsat', 4).state).toBe('confirmed');
    expect(envReport(d1, 'gsat', 1).state).toBe('never'); // 第 1、2 次那份節次表還沒確認
    expect(envReport(d1, 'bcct').state).toBe('never');
  });
});

describe('紅燈：缺必要設定不能確認', () => {
  it('名單是空的：沒有班級、也沒有班級教室可帶入，confirmEnv 不動', () => {
    const d = withDefaults({ ...emptyDoc(), settings: { ...emptyDoc().settings, schoolName: '示範高中' } });
    const r = envReport(d, 'gsat', 4);
    expect(r.state).toBe('blocked');
    expect(r.problems.join()).toContain('還沒有學生名單，所以沒有班級教室可帶入');
    expect(confirmEnv(d, 'gsat', 4, NOW)).toBe(d);
  });
  it('學校名稱空白＝紅燈', () => {
    const d = { ...doc0(), settings: { ...doc0().settings, schoolName: '  ' } };
    const r = envReport(d, 'ast');
    expect(r.state).toBe('blocked');
    expect(r.problems.join()).toContain('學校名稱空白');
  });
  // #343 起：單一班級座位比人數少只是提醒；同組（理組）班級教室座位總數不夠才是紅燈。這裡理組只有這間 2 座的教室，3 人排不下
  it('同組班級教室座位總數比學生少＝紅燈', () => {
    const d0 = doc0();
    const d = { ...d0, settings: { ...d0.settings, classrooms: [...d0.settings.classrooms, { id: 'x', name: d0.settings.classes[0]!.name, kind: 'class' as const, rows: 1, depth: 2, seatCount: 2, division: 'senior' as const }] } };
    const r = envReport(d, 'gsat', 4);
    expect(r.state).toBe('blocked');
    expect(r.problems.join()).toContain('高三理組學生 3 人，班級教室座位共 2 個，還差 1 個');
  });
});

describe('確認之後的變動比對（前 → 後）', () => {
  it('改節次排列、匯入名單、改學校、改紙張都會讓琥珀出現並列出前後；再確認回綠', () => {
    let d = confirmEnv(doc0(), 'gsat', 4, NOW);
    // 節次排列（G38：名稱與時長固定，只有排列可改）
    const t = scheduleOf(d.settings, 'g34');
    d = { ...d, settings: withSchedule(d.settings, 'g34', moveRow(t, { day: 0, index: 0 }, 1)) };
    d = { ...d, rosters: { ...d.rosters, senior: [...d.rosters.senior, { classNo: 1, seatNo: 9, name: '示範生甲' }] } };
    d = { ...d, settings: { ...d.settings, schoolName: '別校', defaultLabelPaper: 'A3' } };
    const r = envReport(d, 'gsat', 4);
    expect(r.state).toBe('changed');
    expect(r.tone).toBe('warn');
    expect(r.changes.map((c) => c.label).sort()).toEqual(['學校與標籤紙張', '教室與座位', '班級與人數', '節次表'].sort());
    const school = r.changes.find((c) => c.label === '學校與標籤紙張')!;
    expect(school.before).toContain('範例高中');
    expect(school.after).toContain('別校');
    expect(school.after).toContain('A3');
    expect(r.changes.find((c) => c.label === '班級與人數')!.before).toBe('高三 2 班、5 人');
    expect(envReport(confirmEnv(d, 'gsat', 4, NOW), 'gsat', 4).state).toBe('confirmed');
  });
  it('確認後系統自動帶出班級教室不會讓環境變琥珀', () => {
    const d = confirmEnv(doc0(), 'gsat', 4, NOW);
    const d2 = ensureClassRooms(d, 'senior');
    expect(d2.settings.classrooms.length).toBeGreaterThan(d.settings.classrooms.length);
    expect(envReport(d2, 'gsat', 4).state).toBe('confirmed');
  });
});

describe('舊資料夾、舊存檔不受影響', () => {
  it('沒有 env 欄位＝尚未確認，不報錯、設定其餘欄位不動', () => {
    const d = doc0();
    expect(d.settings.env).toBeUndefined();
    expect(envBanner(d)).toBe('never');
    expect(() => envReport(d, 'gsat', 4)).not.toThrow();
  });
  it('環境快照跟著 settings.json 存取（搬移、重新連結、重開都在）', async () => {
    const fs = createMemoryFS();
    await saveDoc(fs, confirmEnv(doc0(), 'ast', undefined, NOW));
    const { data } = await loadDoc(fs);
    expect(data.settings.env?.confirmedAt).toBe(NOW.toISOString());
    expect(envReport(data, 'ast').state).toBe('confirmed');
  });
});

describe('首次使用精靈與列表橫幅', () => {
  it('五步都看過、沒紅燈 → 總覽可完成 → 環境已確認，橫幅消失', () => {
    let d = ensureClassRooms(doc0(), 'senior');
    expect(wizardComplete(d)).toBe(false);
    for (const s of WIZARD_STEPS) d = markSeen(d, s.no);
    expect(wizardComplete(d)).toBe(true);
    d = finishWizard(d, NOW);
    expect(envBanner(d)).toBe('none');
    expect(envReport(d, 'gsat', 4).state).toBe('confirmed');
    expect(envReport(d, 'ast').state).toBe('confirmed');
    expect(envReport(d, 'bcct').state).toBe('never'); // 部別只選高中部，國三沒確認
  });
  it('選「兩個都用」＝高三、國三都確認', () => {
    let d = setWizardChoice(doc0(), { division: 'both' });
    for (const s of WIZARD_STEPS) d = markSeen(d, s.no);
    d = finishWizard(d, NOW);
    expect(envReport(d, 'bcct').state).toBe('confirmed');
  });
  it('名單空：步驟 2、4 有紅燈，可「稍後匯入」但總覽標待補，不算確認', () => {
    let d = withDefaults({ ...emptyDoc(), settings: { ...emptyDoc().settings, schoolName: '示範高中' } });
    expect(stepProblems(d, 2).length).toBeGreaterThan(0);
    expect(stepProblems(d, 4).join()).toContain('沒有班級教室可帶入');
    for (const s of WIZARD_STEPS) d = markSeen(d, s.no);
    expect(stepMark(d, 2)).toBe('later');
    expect(stepMark(d, 4)).toBe('later');
    expect(wizardComplete(d)).toBe(false);
    d = finishWizard(d, NOW);
    expect(envReport(d, 'gsat', 4).state).toBe('blocked');
  });
  it('略過 → 橫幅「你先略過了首次設定」；沒略過沒確認 → 「我們還沒確認過環境」；確認後設定變動 → 「有變動」', () => {
    expect(envBanner(skipWizard(doc0()))).toBe('skipped');
    expect(envBanner(doc0())).toBe('never');
    let d = confirmEnv(doc0(), 'gsat', 4, NOW);
    expect(envBanner(d)).toBe('none');
    d = { ...d, settings: { ...d.settings, schoolName: '別校' } };
    expect(envBanner(d)).toBe('changed');
  });
});

describe('畫面（renderToString）', () => {
  it('新增考試：沒確認＝琥珀、有「確認使用」、建立鈕停用；確認後綠色一行可展開、鈕可按', () => {
    const d = doc0();
    const h0 = renderToString(<NewExam doc={d} onCancel={noop} onCreate={noop} now={() => NOW} />);
    expect(h0).toContain('本次使用的環境');
    expect(h0).toContain('還沒確認過環境');
    expect(h0).toContain('確認使用');
    expect(h0).toMatch(/disabled[^>]*>建立並開始/);
    const h1 = renderToString(<NewExam doc={confirmEnv(d, 'gsat', 1, NOW)} onCancel={noop} onCreate={noop} now={() => NOW} />);
    expect(h1).toContain('環境已確認');
    expect(h1).toContain('展開明細');
    expect(h1).not.toMatch(/disabled[^>]*>建立並開始/);
  });
  it('環境卡：紅燈沒有「確認使用」；琥珀變動列出前 → 後', () => {
    const blank = { ...doc0(), settings: { ...doc0().settings, schoolName: '' } };
    const h = renderToString(<EnvCard doc={blank} kind="gsat" round={4} onConfirm={noop} />);
    expect(h).toContain('環境缺必要設定');
    expect(h).not.toContain('確認使用');
    const ch = { ...confirmEnv(doc0(), 'ast', undefined, NOW) };
    const h2 = renderToString(<EnvCard doc={{ ...ch, settings: { ...ch.settings, schoolName: '別校' } }} kind="ast" onConfirm={noop} />);
    expect(h2).toContain('環境與上次確認不同');
    expect(h2).toContain('範例高中');
    expect(h2).toContain('→');
  });
  it('列表橫幅：沒確認／略過／確認後無橫幅', () => {
    const e = (d: Doc) => renderToString(<Exams doc={d} onEnv={noop} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(e(doc0())).toContain('我們還沒確認過環境');
    expect(e(skipWizard(doc0()))).toContain('你先略過了首次設定');
    expect(e(confirmEnv(doc0(), 'gsat', 4, NOW))).not.toContain('data-env-banner');
  });
  it('精靈每一步都畫得出來：預設值、用預設並下一步、空名單與就地匯入、節次表唯讀（G38）、總覽', () => {
    const fn = (d: Doc, step: number) => renderToString(<EnvWizard doc={d} step={step} now={() => NOW} onStep={noop} onChange={noop} onGoSettings={noop} onFinish={noop} />);
    const d = doc0();
    const h1 = fn(d, 1);
    expect(h1).toContain('用預設並下一步');
    expect(h1).toContain('預設值：115 學年度');
    expect(h1).toContain('稍後再設定');
    expect(h1).toContain('選好資料夾了');
    const h2 = fn(d, 2);
    expect(h2).toContain('這一步沒有「用預設」');
    expect(h2).toContain('共 2 班、5 人');
    const empty = withDefaults({ ...emptyDoc(), settings: { ...emptyDoc().settings, schoolName: '示範高中' } });
    const h2e = fn(empty, 2);
    expect(h2e).toContain('稍後匯入，下一步');
    expect(h2e).toContain('選擇學生名單檔');
    expect(fn(empty, 4)).toContain('還沒有學生名單，所以沒有班級教室可帶入');
    const h3 = fn(d, 3);
    expect(h3).toContain('科目名稱與時長依大考規定（唯讀）');
    expect(h3).toContain('英文 100');
    // 使用者 2026-11-18：進入步驟 4 就依名冊帶出班級教室（useEffect）；帶出後與考試 ③ 同一個教室清單列，有學生人數、編輯座位、新增預備教室
    const h4 = fn(ensureClassRooms(d, 'senior'), 4);
    for (const s of ['class="roomrow', '編輯座位 ▾', '學生 ', '新增預備教室', '到共用設定的教室清單']) expect(h4).toContain(s);
    expect(h4).not.toContain('role="switch"');
    expect(h4).not.toContain('<table');
    expect(fn({ ...d, settings: { ...d.settings, schoolName: '' } }, 5)).toContain('不能留空白');
    const done = [1, 2, 3, 4, 5].reduce((x, n) => markSeen(x, n as 1), ensureClassRooms(d, 'senior'));
    expect(fn(done, 6)).toContain('完成設定');
    expect(fn(d, 6)).toContain('先完成，稍後補做');
  });
});
