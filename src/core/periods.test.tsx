import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { PeriodTable, Settings } from '../data';
import { defaultSubjects } from '../ui/subjects';
import { demoDoc } from '../ui/repository';
import { newExam } from '../ui/store';
import { ScheduleTab } from '../ui/pages/Schedule';
import {
  dayName, slotName,
  addRow, defaultSchedule, dropRow, examSubjectPeriods, isDefaultSchedule, isOneSubjectPerPeriod, moveRow, numberRows,
  removeRow, scheduleKeyOf, scheduleOf, subjectPeriods, updateRow, withSchedule,
} from './periods';

const periodsOf = (m: Map<string, { period: number; label: string }[]>, id: string) => m.get(id)?.map((x) => `${x.period}${x.label}`);

describe('內建預設節次表（docs/exam-schedule.md）', () => {
  it('學測第 1、2 次：第一天 英文、自然、國綜、英聽，第二天 數學、社會、國寫；國文兩節', () => {
    const m = subjectPeriods(defaultSubjects('gsat', 1), defaultSchedule('g12'));
    expect(periodsOf(m, 'english')).toEqual(['1英文']);
    expect(periodsOf(m, 'en-listen')).toEqual(['4英聽']);
    expect(periodsOf(m, 'math')).toEqual(['5數學']);
    expect(periodsOf(m, 'chinese')).toEqual(['3國綜', '7國寫']);
    expect(numberRows(defaultSchedule('g12')).map((r) => r.minutes)).toEqual([100, 110, 90, 50, 100, 110, 90]);
  });
  it('學測第 3、4 次：無英聽，第一天最後一節數學 B，第二天數學 A', () => {
    const m = subjectPeriods(defaultSubjects('gsat', 3), defaultSchedule('g34'));
    expect(periodsOf(m, 'math-b')).toEqual(['4數學B']);
    expect(periodsOf(m, 'math-a')).toEqual(['5數學A']);
    expect(m.has('en-listen')).toBe(false);
  });
  it('分科 8 節、每節 80 分；會考 7 科', () => {
    const ast = numberRows(defaultSchedule('ast'));
    expect(ast.map((r) => `${r.period}${r.name}`)).toEqual(['1物理', '2化學', '3數學甲', '4生物', '5歷史', '6地理', '7數學乙', '8公民與社會']);
    expect(ast.every((r) => r.minutes === 80)).toBe(true);
    const b = subjectPeriods(defaultSubjects('bcct'), defaultSchedule('bcct'));
    expect([...b.values()].flat().map((x) => x.period).sort((a, z) => a - z)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(periodsOf(b, 'en-listen')).toEqual(['7英語聽力']);
  });
  it('預設表都是一科一節（學測國文雖兩節，但沒有兩科同節）', () => {
    for (const [k, r] of [['gsat', 1], ['gsat', 3], ['ast', 1], ['bcct', 1]] as const) {
      expect(isOneSubjectPerPeriod(subjectPeriods(defaultSubjects(k, r), defaultSchedule(scheduleKeyOf(k, r))))).toBe(true);
    }
  });
  it('考試類型與次別選表：學測第 3 次起用第 3、4 次那份', () => {
    expect([scheduleKeyOf('gsat', 1), scheduleKeyOf('gsat', 2), scheduleKeyOf('gsat', 3), scheduleKeyOf('gsat'), scheduleKeyOf('ast'), scheduleKeyOf('bcct')]).toEqual(['g12', 'g12', 'g34', 'g12', 'ast', 'bcct']);
  });
});

describe('舊資料與新增考試', () => {
  it('舊存檔沒有 schedules 欄位：用內建預設，不需遷移', () => {
    const doc = demoDoc();
    expect(doc.settings.schedules).toBeUndefined();
    expect(scheduleOf(doc.settings, 'ast')).toEqual(defaultSchedule('ast'));
  });
  it('新增考試自動帶入共用設定的節次（改了共用設定就跟著變）', () => {
    let doc = demoDoc();
    const r = newExam(doc, 'ast', '分科第一次', new Date('2026-04-01T02:00:00Z'));
    if (!r.ok) throw new Error(r.error);
    doc = r.doc;
    const exam = doc.exams[doc.exams.length - 1]!;
    expect(periodsOf(examSubjectPeriods(exam, doc.settings), 'history')).toEqual(['5歷史']);
    // 4/9 特例：壓成一天、文理同節——把歷史拖到物理後面並勾同節
    let t = scheduleOf(doc.settings, 'ast');
    t = dropRow(t, { day: 1, index: 0 }, { day: 0, index: 1 });
    t = updateRow(t, { day: 0, index: 1 }, { samePrev: true });
    const settings = withSchedule(doc.settings, 'ast', t);
    const m = examSubjectPeriods(exam, settings);
    expect(periodsOf(m, 'history')).toEqual(['1歷史']);
    expect(periodsOf(m, 'physics')).toEqual(['1物理']);
    expect(isOneSubjectPerPeriod(m)).toBe(false);
  });
  it('考科表有、節次表沒有的自訂科目排在最後各自一節；名稱比對忽略空白', () => {
    const subs = [...defaultSubjects('gsat', 3), { id: 'custom-9', name: '數學 C', custom: true }];
    const t = addRow(defaultSchedule('g34'), 1, '數學C');
    expect(periodsOf(subjectPeriods(subs, t), 'custom-9')).toEqual(['8數學C']);
    const m = subjectPeriods([...defaultSubjects('gsat', 1), { id: 'custom-7', name: '公民', custom: true }], defaultSchedule('g12'));
    expect(periodsOf(m, 'custom-7')).toEqual(['8公民']);
  });
});

describe('編輯節次表', () => {
  const t0 = defaultSchedule('g12');
  it('與上一科同節：沿用上一節的編號，可跨天；第一列不能同節', () => {
    const t = updateRow(updateRow(t0, { day: 1, index: 0 }, { samePrev: true }), { day: 0, index: 0 }, { samePrev: true });
    expect(numberRows(t).map((r) => r.period)).toEqual([1, 2, 3, 4, 4, 5, 6]);
  });
  it('↑↓ 同一天交換；到頭移到另一天', () => {
    expect(moveRow(t0, { day: 0, index: 1 }, -1).days[0]!.map((r) => r.name)).toEqual(['自然', '英文', '國綜', '英聽']);
    const down = moveRow(t0, { day: 0, index: 3 }, 1);
    expect(down.days[1]!.map((r) => r.name)).toEqual(['英聽', '數學', '社會', '國寫']);
    expect(moveRow(t0, { day: 0, index: 0 }, -1)).toBe(t0);
    expect(t0.days[0]![0]!.name).toBe('英文'); // 原表不變
  });
  it('拖拉：放到某列之前；放到天的最後', () => {
    expect(dropRow(t0, { day: 0, index: 0 }, { day: 0, index: 2 }).days[0]!.map((r) => r.name)).toEqual(['自然', '英文', '國綜', '英聽']);
    expect(dropRow(t0, { day: 0, index: 0 }, { day: 0, index: 4 }).days[0]!.map((r) => r.name)).toEqual(['自然', '國綜', '英聽', '英文']);
    expect(dropRow(t0, { day: 1, index: 2 }, { day: 0, index: 0 }).days[0]!.map((r) => r.name)).toEqual(['國寫', '英文', '自然', '國綜', '英聽']);
  });
  it('新增、刪除、清空選填欄位；與預設相同就不存（還原預設）', () => {
    const added = addRow(t0, 0);
    expect(added.days[0]![4]).toEqual({ name: '新科目', minutes: 50 });
    expect(removeRow(added, { day: 0, index: 4 })).toEqual(t0);
    expect(updateRow(updateRow(t0, { day: 0, index: 0 }, { start: '08:10' }), { day: 0, index: 0 }, { start: undefined })).toEqual(t0);
    // G38：自訂新增的科目不存（忽略），所以只剩預設＝不存
    expect(withSchedule({} as Pick<Settings, 'schedules'>, 'g12', added)).toEqual({});
    const moved = withSchedule({} as Pick<Settings, 'schedules'>, 'g12', moveRow(t0, { day: 0, index: 0 }, 1));
    expect(moved.schedules?.g12).toBeDefined();
    expect(withSchedule(moved, 'g12', t0)).toEqual({});
    expect(isDefaultSchedule(t0, 'g12')).toBe(true);
  });
});

describe('共用設定「節次與時長」分頁', () => {
  it('照稿：類型分段鈕、兩天兩欄、節次編號、國文整個一起標、英聽固定、還原預設', () => {
    const html = renderToString(<ScheduleTab doc={demoDoc()} onChange={() => undefined} />);
    for (const s of ['節次與時長', '學測第 1、2 次', '學測第 3、4 次', '分科', '會考', '第 一 天', '第 二 天', '與上一科同節', '開始時間（選填）', '國文：整個一起標', '英聽固定排第一天最後一節', '還原「學測第 1、2 次」預設']) expect(html).toContain(s);
    expect(html).toContain('時段三');
    expect(html).not.toContain('第 7 節');
  });
});

describe('時段編號每天重新開始（使用者 2026-11-10）', () => {
  it('第二天從時段一開始；同節不多算一個時段', () => {
    const rows = numberRows({ days: [[{ name: 'A' }, { name: 'B' }], [{ name: 'C' }, { name: 'D', samePrev: true }, { name: 'E' }]] } as never);
    expect(rows.map((r) => [r.day, r.slot, r.period])).toEqual([[0, 1, 1], [0, 2, 2], [1, 1, 3], [1, 1, 3], [1, 2, 4]]);
    expect(slotName(1)).toBe('時段一');
    expect(dayName(1)).toBe('第二天');
  });
});

describe('G38 科目名稱與每科時長寫死', () => {
  const keys = ['g12', 'g34', 'ast', 'bcct'] as const;
  for (const key of keys) {
    it(key + '：舊存檔自訂的名稱、時長、新增科目一律忽略，排列與同節、開始時間照存', () => {
      const d = defaultSchedule(key);
      const first = d.days[0]![0]!;
      const custom = JSON.parse(JSON.stringify(d)) as PeriodTable;
      custom.days[0]!.reverse(); // 排列自訂
      custom.days[0]!.forEach((r) => { r.name = '亂改'; r.minutes = 7; });
      custom.days[0]![1]!.start = '08:10';
      custom.days[1]!.push({ name: '自訂科目', minutes: 30 });
      const t = scheduleOf({ schedules: { [key]: custom } }, key);
      const defMin = new Map(d.days.flat().map((r) => [r.subjectId + r.name, r.minutes]));
      for (const r of t.days.flat()) {
        expect(r.name).not.toBe('亂改');
        expect(r.name).not.toBe('自訂科目');
        expect(r.minutes).toBe(defMin.get(r.subjectId + r.name));
      }
      expect(t.days[1]!.length).toBe(d.days[1]!.length);
      expect(t.days[0]!.map((r) => r.name)).toEqual([...d.days[0]!].reverse().map((r) => r.name)); // 順序照存檔
      expect(t.days[0]![1]!.start).toBe('08:10');
      expect(t.days[0]!.at(-1)!.name).toBe(first.name);
    });
    it(key + '：存回時只存排列；名稱與時長不會被寫進存檔', () => {
      const t = moveRow(defaultSchedule(key), { day: 0, index: 0 }, 1);
      t.days[0]![0]!.minutes = 1;
      t.days[0]![0]!.name = 'X';
      const saved = withSchedule({} as Pick<Settings, 'schedules'>, key, t).schedules?.[key];
      expect(saved?.days[0]!.every((r) => r.name !== 'X' && r.minutes !== 1)).toBe(true);
    });
  }
  it('學測國文兩列（國綜、國寫）時長各自對回 90', () => {
    const c = defaultSchedule('g12');
    c.days[0]![2]!.minutes = 1; c.days[1]![2]!.minutes = 2;
    const t = scheduleOf({ schedules: { g12: c } }, 'g12');
    expect(t.days[0]![2]!.minutes).toBe(90);
    expect(t.days[1]![2]!.minutes).toBe(90);
  });
});

describe('G38 畫面', () => {
  it('名稱與時長是唯讀文字：沒有科目名稱／時長輸入欄、沒有「新增一科」', () => {
    const html = renderToString(<ScheduleTab doc={demoDoc()} onChange={() => {}} />);
    expect(html).not.toContain('新增一科');
    expect(html).not.toMatch(/<input[^>]*aria-label="(科目名稱|時長)/);
    expect(html).toContain('<b>100</b>');
  });
});
