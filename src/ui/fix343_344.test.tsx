/**
 * #343：名冊有一班超過班級教室座位上限（50 人 > 7×7＝49）時，不可形成死路。
 * #344：新增模擬考頁離開再回來要保留類型與已填欄位；節次表那行跟著類型。
 * 全部假資料（「甲生01」這類代號），不含真實學生。
 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Student } from '../data';
import { studentCode } from '../data';
import { seatExam } from '../core';
import { classesWithoutRoom, ensureClassRooms, envReport, stepProblems } from './env';
import { NewExam, type NewExamDraft } from './pages/NewExam';
import { Settings } from './pages/Settings';
import { demoDoc } from './repository';
import type { Doc } from './store';

const noop = () => undefined;
const NOW = () => new Date('2026-09-01T02:00:00Z');
const kids = (classNo: number, n: number): Student[] => Array.from({ length: n }, (_, i) => ({ classNo, seatNo: i + 1, name: `甲生${String(i + 1).padStart(2, '0')}` }));

/** 高中部：第 1～3 班理組、第 4 班文組（沿用 demoDoc 的班級）；共用教室清單是空的（精靈第 4 步按了「稍後處理」的狀態） */
function docWith(sizes: Record<number, number>): Doc {
  const d = demoDoc();
  const senior = Object.entries(sizes).flatMap(([c, n]) => kids(Number(c), n));
  return { ...d, settings: { ...d.settings, classrooms: [] }, rosters: { ...d.rosters, senior } };
}
const roomsLine = (d: Doc, kind: 'gsat' | 'ast') => envReport(d, kind, 1).lines.find((l) => l.key === 'rooms:senior')!;

describe('#343 班級人數超過班級教室上限不形成死路', () => {
  // 第 1 班 50 人；理組三班共 50＋30＋40＝120 人，班級教室預設座位 49＋30＋42＝121 座，同組合起來排得下
  const d = docWith({ 1: 50, 2: 30, 3: 40, 4: 20 });

  it('學測：不再是紅燈（修正前是「座位不足」擋建立），改成不擋的提醒', () => {
    const rep = envReport(d, 'gsat', 1);
    expect(rep.state).not.toBe('blocked');
    expect(rep.problems).toEqual([]);
    const l = roomsLine(d, 'gsat');
    expect(l.tone).not.toBe('bad');
    expect(l.note).toContain('50 人、教室座位 49');
    expect(l.note).toContain('同組其他班級教室');
  });

  it('分科：同樣不擋，提醒寫明分科依報名人數排考場', () => {
    const rep = envReport(d, 'ast', 1);
    expect(rep.state).not.toBe('blocked');
    expect(roomsLine(d, 'ast').note).toContain('分科依各科報名人數排考場');
  });

  it('提醒的說法屬實：學測主排座真的把 50 人的班排進同組教室（不硬擠進同一間）', () => {
    const withRooms = ensureClassRooms(d, 'senior');
    const r = seatExam({
      division: 'senior', classes: withRooms.settings.classes.filter((c) => c.division === 'senior'), classrooms: withRooms.settings.classrooms,
      codes: withRooms.rosters.senior.map((s) => studentCode(s.classNo, s.seatNo)),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.assignments.length).toBe(140);
  });

  it('同組座位總數真的不夠才擋，訊息寫出還差幾個與怎麼修', () => {
    const full = docWith({ 1: 50, 2: 50, 3: 50, 4: 20 }); // 理組 150 人、座位 49×3＝147
    const rep = envReport(full, 'gsat', 1);
    expect(rep.state).toBe('blocked');
    expect(rep.problems.join()).toContain('高三理組學生 150 人，班級教室座位共 147 個，還差 3 個');
  });

  it('分科只在全部教室（含預備教室）都不夠時才擋', () => {
    const full = docWith({ 1: 50, 2: 50, 3: 50, 4: 20 }); // 170 人；班級教室 49×3＋20＝167 座
    expect(envReport(full, 'ast', 1).problems.join()).toContain('高三學生 170 人，教室座位共 167 個，還差 3 個；請到教室清單新增預備教室');
    const withReserve: Doc = { ...full, settings: { ...full.settings, classrooms: [{ id: 'rv', name: '預備甲', kind: 'reserve', rows: 2, depth: 2, seatCount: 4, division: 'senior' }] } };
    expect(envReport(withReserve, 'ast', 1).state).not.toBe('blocked');
  });

  it('精靈第 4 步：超過上限但同組夠，不再只剩「稍後處理」', () => {
    expect(stepProblems({ ...d, settings: { ...d.settings, env: { division: 'senior' } } }, 4)).toEqual([]);
  });

  it('依名冊帶出班級教室：50 人的班給 7×7，其他班依人數；已有的教室不動', () => {
    const w = ensureClassRooms(d, 'senior');
    const r1 = w.settings.classrooms.find((r) => r.name === d.settings.classes.find((c) => c.no === 1)!.name)!;
    expect([r1.rows, r1.depth, r1.seatCount]).toEqual([7, 7, 49]);
    expect(classesWithoutRoom(w, 'senior')).toEqual([]);
    expect(ensureClassRooms(w, 'senior')).toBe(w); // 再按一次不產生修改
  });

  it('共用設定教室清單：名冊有學生但沒有班級教室時，有「依名冊帶出班級教室」的路；帶出後消失', () => {
    const html = renderToString(<Settings doc={d} onChange={noop} tab="rooms" />);
    expect(html).toContain('依名冊帶出班級教室');
    expect(html).toContain('名冊有 4 個班級還沒有班級教室');
    const after = renderToString(<Settings doc={ensureClassRooms(d, 'senior')} onChange={noop} tab="rooms" />);
    expect(after).not.toContain('依名冊帶出班級教室');
  });
});

describe('#344 新增模擬考：離開再回來保留草稿、節次表跟著類型', () => {
  const draft: NewExamDraft = { kind: 'ast', name: '自訂分科名稱', edited: true, semester: 'second', semEdited: false, yearText: '113', round: 2, roundEdited: true };

  it('帶回草稿：分科仍是已選、學年度與名稱是剛填的，節次表那行是分科', () => {
    const html = renderToString(<NewExam doc={demoDoc()} draft={draft} onCancel={noop} onCreate={noop} now={NOW} />);
    const ast = html.split('<button').find((x) => x.includes('<strong>分科模擬考</strong>'))!;
    expect(ast).toContain('aria-pressed="true"');
    expect(html).toContain('value="113"');
    expect(html).toContain('value="自訂分科名稱"');
    expect(html).toContain('分科・內建預設排列・2 天、8 個時段');
    expect(html).not.toContain('學測第 1、2 次・內建預設排列');
  });

  it('沒有草稿（從列表按「新增」）：照舊從學測開始', () => {
    const html = renderToString(<NewExam doc={demoDoc()} onCancel={noop} onCreate={noop} now={NOW} />);
    const g = html.split('<button').find((x) => x.includes('<strong>學測模擬考</strong>'))!;
    expect(g).toContain('aria-pressed="true"');
    expect(html).toContain('學測第 1、2 次・內建預設排列・2 天、7 個時段');
  });
});
