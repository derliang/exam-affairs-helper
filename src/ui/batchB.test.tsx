/** 批次 B 第 3 步教室（G21、G22、G25、G30）：學測、分科、會考各自驗證；全部假資料 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamConfig, ExamKind } from '../data';
import { RoomList } from './components/RoomList';
import { defaultSeatGrid, syncClassRooms } from './classRooms';
import { Step3 } from './pages/Step3';
import { demoDoc } from './repository';
import { newExam, type Doc } from './store';
import { addRoom, labelSplitNote, resize, roomLimitsOf, seatLimitNote } from './rooms';

const noop = () => undefined;
const room = (o: Partial<Classroom> = {}): Classroom => ({ id: 'r1', name: '甲班', kind: 'class', rows: 6, depth: 7, seatCount: 42, division: 'senior', track: 'science', ...o });
const docWith = (kind: ExamKind): { doc: Doc; exam: ExamConfig } => {
  const r = newExam(demoDoc(), kind, '測試考', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams[r.doc.exams.length - 1] as ExamConfig };
};

describe('G30 座位上限依教室類型', () => {
  it('班級教室 7×7＝49；預備教室 7 排×8 深位＝56', () => {
    expect(roomLimitsOf('class')).toEqual({ rows: 7, depth: 7, cap: 49 });
    expect(roomLimitsOf('reserve')).toEqual({ rows: 7, depth: 8, cap: 56 });
  });
  it('班級教室預設座位：42 人→6×7、45 人→7×7、超過 49 人仍 7×7', () => {
    expect(defaultSeatGrid(42)).toEqual({ rows: 6, depth: 7 });
    expect(defaultSeatGrid(45)).toEqual({ rows: 7, depth: 7 });
    expect(defaultSeatGrid(60)).toEqual({ rows: 7, depth: 7 });
  });
  it('resize：班級教室深位加到 8 被擋；預備教室可到 7×8、不能到 9 或 8 排', () => {
    const c = room({ rows: 7, depth: 7, seatCount: 49 });
    const cl = roomLimitsOf('class');
    expect(resize(c, { depth: 8 }, cl.cap, cl)).toBe(c);
    const rv = room({ kind: 'reserve', rows: 7, depth: 7, seatCount: 49 });
    const rl = roomLimitsOf('reserve');
    const up = resize(rv, { depth: 8 }, rl.cap, rl);
    expect(up).toMatchObject({ rows: 7, depth: 8, seatCount: 56 });
    expect(resize(up, { depth: 9 }, rl.cap, rl)).toBe(up);
    expect(resize(up, { rows: 8 }, rl.cap, rl)).toBe(up);
  });
  it('提示：預備教室 7×8 不叫人縮小；到上限的說明依類型', () => {
    expect(labelSplitNote(room({ kind: 'reserve', rows: 7, depth: 8, seatCount: 56 }))).toBeNull();
    expect(seatLimitNote(room({ kind: 'reserve', rows: 7, depth: 8, seatCount: 56 }))).toContain('預備教室上限 7×8');
    expect(seatLimitNote(room({ rows: 7, depth: 7, seatCount: 49 }))).toContain('班級教室上限 7×7');
  });
  it('預備教室卡片顯示 7×8 的座位數 56', () => {
    const html = renderToString(<RoomList rooms={[room({ kind: 'reserve', rows: 7, depth: 8, seatCount: 56, track: undefined })]} paper="B4" onChange={noop} selected={['r1']} onSelect={noop} />);
    expect(html).toContain('<b>56</b>');
  });
});

describe('G21 教室表格', () => {
  it('一間一列：表頭、縮圖、排×深位、座位統計、編輯座位；沒有舊的「複製／本次調整座位」按鈕列', () => {
    const html = renderToString(<RoomList rooms={[room()]} paper="B4" onChange={noop} selected={['r1']} onSelect={noop} classes={[{ name: '甲班', colorIndex: 1, division: 'senior' }]} division="senior" onOverride={noop} />);
    for (const h of ['<th>教室</th>', '<th>座位配置</th>', '<th>座位統計</th>', '<th>組別</th>', '<th>操作</th>']) expect(html).toContain(h);
    expect(html).toContain('seatthumb');
    expect(html).toContain('6</b> 排×<b>7</b> 深位');
    expect(html).toContain('▸ 編輯座位');
    expect(html).not.toContain('本次調整座位');
    expect(html).not.toContain('>複製這間教室<'); // 班級教室不複製
    expect(html).not.toContain('>刪除<'); // 班級教室不能刪
  });
  it('會考（國中部）沒有組別欄', () => {
    const html = renderToString(<RoomList junior rooms={[room({ division: 'junior', track: undefined })]} paper="B4" onChange={noop} selected={['r1']} onSelect={noop} />);
    expect(html).not.toContain('<th>組別</th>');
  });
});

describe('G22 三種類型：班級教室跟名冊走', () => {
  it('學測、分科、會考：依名冊補齊的班級教室，座位依名單人數；Step3 沒有「新增教室」「一次新增」', () => {
    for (const kind of ['gsat', 'ast', 'bcct'] as const) {
      const { doc, exam } = docWith(kind);
      const synced = syncClassRooms(doc, exam);
      const made = synced.settings.classrooms.filter((r) => r.kind === 'class' && r.division === exam.division);
      expect(made.length, kind).toBeGreaterThan(0);
      const html = renderToString(<Step3 doc={synced} exam={synced.exams.find((e) => e.id === exam.id)!} onChange={noop} />);
      expect(html, kind).not.toContain('>新增教室<');
      expect(html, kind).not.toContain('一次新增');
      expect(html.includes('新增預備教室'), kind).toBe(kind !== 'bcct');
    }
  });
  it('新增預備教室仍可用（addRoom reserve）；國中部不行', () => {
    expect(addRoom([], 'reserve', 'senior')[0]).toMatchObject({ kind: 'reserve', name: '預備教室1' });
    expect(addRoom([], 'reserve', 'junior')).toEqual([]);
  });
});

describe('G25 編輯座位單一入口', () => {
  it('有本次覆寫的教室仍標「本次專用」，座位數以本次為準；沒有「本次調整座位」「編輯本次座位」按鈕', () => {
    const html = renderToString(<RoomList rooms={[room()]} paper="B4" onChange={noop} selected={['r1']} onSelect={noop} onOverride={noop} overrides={{ r1: { rows: 7, depth: 7, seatCount: 49 } }} />);
    expect(html).toContain('本次專用');
    expect(html).toContain('<b>49</b>');
    expect(html).not.toContain('編輯本次座位');
    expect(html).not.toContain('本次調整座位');
  });
});
