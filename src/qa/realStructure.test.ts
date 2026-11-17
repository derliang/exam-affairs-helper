/**
 * 去識別化的真實版面結構回歸（D71）。
 *
 * 兩層：
 *  1. 結構固定表（寫死在 repo）：只有各班人數、組別代碼計數，沒有任何姓名、學號、帳號。永遠執行。
 *  2. 本機真實檔案（只在這台電腦有雲端資料夾時執行）：讀入後只斷言「計數與結構」，
 *     斷言訊息與 log 都不含姓名；檔案不存在就整段略過。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSeating } from '../core';
import type { ClassInfo, Classroom, ExamEntry, Subject } from '../data/types';
import { parseExamList, parseRoster, readXlsx } from '../import';
import { checkMainSeating, checkMarksAndDetach } from './invariants';

/** 各次考試每班人數（來自真實名單，只留計數） */
const STRUCTURES = {
  E1: [46, 46, 46, 39, 43, 44],
  E2: [47, 46, 46, 43, 45, 44],
  E3: [47, 46, 46, 42, 45, 44],
  junior: [40, 40, 41, 39, 39, 38],
} as const;

const SUBJECTS: Subject[] = [
  { id: 'chi', name: '國文' },
  { id: 'eng', name: '英文' },
  { id: 'math', name: '數學' },
  { id: 'sci', name: '自然' },
  { id: 'soc', name: '社會' },
];

/** 依人數造假名單：前一半的人全科，其餘依組別各缺一科 */
function fakeEntries(sizes: readonly number[]): ExamEntry[] {
  const out: ExamEntry[] = [];
  sizes.forEach((n, ci) => {
    for (let s = 1; s <= n; s++) {
      const kind = s % 3; // 0 全科、1 自然組、2 社會組
      const ids = kind === 0 ? ['chi', 'eng', 'math', 'sci', 'soc'] : kind === 1 ? ['chi', 'eng', 'math', 'sci'] : ['chi', 'eng', 'math', 'soc'];
      out.push({ classNo: ci + 1, seatNo: s, name: `甲生${ci + 1}-${s}`, subjectIds: ids });
    }
  });
  return out;
}

const seniorClasses: ClassInfo[] = [1, 2, 3, 4, 5, 6].map((no) => ({ no, name: `班${no}`, division: 'senior', track: no <= 3 ? 'science' : 'liberal', colorIndex: no }));
const juniorClasses: ClassInfo[] = [1, 2, 3, 4, 5, 6].map((no) => ({ no, name: `班${no}`, division: 'junior', colorIndex: no }));
const room = (id: string, rows: number, depth: number, seatCount: number, track?: 'science' | 'liberal'): Classroom => ({ id, name: id, kind: 'class', rows, depth, seatCount, ...(track ? { track } : {}) });
const reserves: Classroom[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((id) => ({ id, name: id, kind: 'reserve' as const, rows: 7, depth: 7, seatCount: 49 }));

describe('真實版面結構回歸（寫死的計數）', () => {
  for (const [key, sizes] of Object.entries(STRUCTURES)) {
    it(`${key}：每班人數 ${sizes.join('/')}，排座與標示抽離不變式成立`, () => {
      const senior = key !== 'junior';
      const entries = fakeEntries(sizes);
      const input = {
        examId: key,
        division: senior ? ('senior' as const) : ('junior' as const),
        classes: senior ? seniorClasses : juniorClasses,
        classrooms: senior
          ? [room('S1', 7, 7, 49, 'science'), room('S2', 7, 7, 49, 'science'), room('S3', 7, 7, 49, 'science'), room('L1', 7, 7, 49, 'liberal'), room('L2', 7, 7, 49, 'liberal'), room('L3', 7, 7, 49, 'liberal'), ...reserves]
          : [room('J1', 7, 7, 49), room('J2', 7, 7, 49), room('J3', 7, 7, 49), room('J4', 7, 7, 49), room('J5', 7, 7, 49), ...reserves],
        entries,
        subjects: SUBJECTS,
        markRules: senior
          ? (['science', 'liberal'] as const).flatMap((track) => [
              { track, subjectId: 'sci', mode: track === 'science' ? ('none' as const) : ('mark-extra' as const) },
              { track, subjectId: 'soc', mode: track === 'liberal' ? ('none' as const) : ('mark-extra' as const) },
            ])
          : [{ subjectId: 'sci', mode: 'mark-absent' as const }],
        overrides: [{ kind: 'single' as const, code: '0101', location: '教務處', purpose: 'exam' as const }],
        now: '2026-11-08T08:00:00Z',
      };
      const r = runSeating(input);
      expect(r.ok, r.ok ? '' : r.errors.join('；')).toBe(true);
      if (!r.ok) return;
      expect(r.result.assignments.length).toBe(sizes.reduce((a, b) => a + b, 0));
      expect(checkMainSeating(input, r.result)).toEqual([]);
      expect(checkMarksAndDetach(input, r.result, r.special)).toEqual([]);
    });
  }
});

/** 真實檔案資料夾：環境變數 MOCK_EXAM_REAL_DIR 指定；沒設就試已知的預設位置，找不到整段略過（#207） */
const DEFAULT_DIRS = [`${process.env.USERPROFILE ?? process.env.HOME ?? ''}/我的雲端硬碟/0AI/模擬考小幫手`];
export function findRealDir(env: string | undefined, defaults: readonly string[]): string | undefined {
  const cands = env ? [env] : defaults;
  return cands.find((d) => d && existsSync(d));
}
/** 遞迴列出資料夾（含子資料夾）底下所有 .xlsx 的相對路徑 */
export function listXlsx(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listXlsx(dir, r));
    else if (e.name.endsWith('.xlsx') && !e.name.startsWith('~$')) out.push(r);
  }
  return out;
}
const DIR = findRealDir(process.env.MOCK_EXAM_REAL_DIR, DEFAULT_DIRS) ?? '';
const REAL_FILES = DIR ? listXlsx(DIR) : [];
const HAS_LOCAL = REAL_FILES.length > 0;

describe.skipIf(!HAS_LOCAL)('本機真實檔案：只斷言結構與計數（不印姓名）', () => {
  const files = REAL_FILES;
  const perClass = (list: { classNo: number }[]): number[] => {
    const m = new Map<number, number>();
    for (const x of list) m.set(x.classNo, (m.get(x.classNo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  };
  const load = async (f: string) => (await readXlsx(new Uint8Array(readFileSync(`${DIR}/${f}`))))[0]!.rows as string[][];

  it('考生資料名單：匯入無警告，每班人數與寫死的結構相同', async () => {
    const expected: [RegExp, number, readonly number[]][] = [
      [/115E1/, 1, STRUCTURES.E1],
      [/115E2/, 2, STRUCTURES.E2],
      [/115E3高中學測考生資料名單\.xlsx$/, 3, STRUCTURES.E3],
    ];
    let hit = 0;
    for (const [re, round, sizes] of expected) {
      const f = files.find((x) => re.test(x));
      if (!f) continue;
      hit++;
      const res = parseExamList(await load(f), { round });
      expect(res.issues.length, `${round}`).toBe(0);
      expect(perClass(res.entries), `round ${round}`).toEqual([...sizes]);
      // 每位考生都有科目（組別代碼都在對照表內）；唯一例外是備註寫明全科缺考的人（真實名單有 1 位）
      expect(res.entries.every((e) => e.subjectIds.length > 0 || !!e.note), `round ${round} 有人沒有科目也沒備註`).toBe(true);
    }
    expect(hit).toBeGreaterThan(0);
  });

  it('學生名單（區塊版式）：國三／高三每班人數正確，且無警告（缺姓名列除外）', async () => {
    const expected = [STRUCTURES.junior.join(), STRUCTURES.E3.join()];
    // 排除驗收員的輸出子資料夾（「驗收測試-*」「分科驗收-*」等路徑含「驗收」者；內有比對結果、改過人數的名單副本，不是原始名單檔）
    const f = files.filter((x) => /學生名單/.test(x) && !/考生/.test(x) && !/驗收/.test(x));
    expect(f.length).toBeGreaterThan(0);
    const got: string[] = [];
    for (const name of f) {
      const res = parseRoster(await load(name));
      // 真實國三名單確有 1 列座號與帳號有值、姓名空白（#297），現在會列為警告而非靜默略過；除此之外不得有警告
      expect(res.issues.filter((i) => !/沒有姓名/.test(i.message))).toEqual([]);
      expect(res.layout).toBe('blocks');
      got.push(perClass(res.students).join());
    }
    for (const e of expected) expect(got).toContain(e);
  });

  it('真實名單匯入後直接排座：不變式成立（高三 E3 結構、勾選 6 間教室）', async () => {
    const f = files.find((x) => /115E3高中學測考生資料名單\.xlsx$/.test(x));
    if (!f) return;
    const res = parseExamList(await load(f), { round: 3 });
    const subjects: Subject[] = [
      { id: 'chi', name: '國文' },
      { id: 'eng', name: '英文' },
      { id: 'mathA', name: '數A' },
      { id: 'mathB', name: '數B' },
      { id: 'sci', name: '自然' },
      { id: 'soc', name: '社會' },
    ];
    const input = {
      examId: 'E3',
      division: 'senior' as const,
      classes: seniorClasses,
      classrooms: [room('S1', 7, 7, 49, 'science'), room('S2', 7, 7, 49, 'science'), room('S3', 7, 7, 49, 'science'), room('L1', 7, 7, 49, 'liberal'), room('L2', 7, 7, 49, 'liberal'), room('L3', 7, 7, 49, 'liberal'), ...reserves],
      entries: res.entries,
      subjects,
      markRules: [],
      overrides: [],
      now: '2026-11-08T08:00:00Z',
    };
    const r = runSeating(input);
    expect(r.ok, r.ok ? '' : r.errors.join('；')).toBe(true);
    if (r.ok) {
      expect(checkMainSeating(input, r.result)).toEqual([]);
      // D79：全科缺考者（真實名單有 1 位）不排座
      expect(r.result.assignments.length).toBe(res.entries.filter((e) => e.subjectIds.length > 0).length);
      expect(r.fullyAbsent.length).toBe(res.entries.filter((e) => e.subjectIds.length === 0).length);
    }
  });
});

describe('真實檔案探測（#207，假資料夾）', () => {
  it('遞迴找到子資料夾的 .xlsx、略過暫存檔；環境變數優先；不存在回 undefined', () => {
    const base = mkdtempSync(join(tmpdir(), 'mxh-'));
    try {
      mkdirSync(join(base, '學測', '深'), { recursive: true });
      writeFileSync(join(base, 'a.xlsx'), '');
      writeFileSync(join(base, '學測', 'b.xlsx'), '');
      writeFileSync(join(base, '學測', '深', 'c.xlsx'), '');
      writeFileSync(join(base, '~$a.xlsx'), '');
      writeFileSync(join(base, 'd.txt'), '');
      expect(listXlsx(base).sort()).toEqual(['a.xlsx', '學測/b.xlsx', '學測/深/c.xlsx']);
      expect(findRealDir(base, ['/nope'])).toBe(base);
      expect(findRealDir(undefined, ['/nope', base])).toBe(base);
      expect(findRealDir('/nope', [base])).toBeUndefined();
      expect(findRealDir(undefined, [])).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
