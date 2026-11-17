/**
 * 補考測試用假資料（只給測試用；全部是虛構的學號、姓名、班名）。
 * 公開 repo：不得放真實學生資料。
 */
import { buildOutputs } from './outputs';
import { buildSchedule, defaultMakeupGroups, DEFAULT_EARLY_RULE, suggestPlan } from './schedule';
import { makeupEntries } from './stats';
import { parseMakeupSheet, resolveMakeup } from './importRows';
import type { GradeKey, MakeupGroup, MakeupRoom, MakeupRoster, MakeupSettings } from './types';

export const HEADER = ['學號', '新班', '新號', '舊班', '舊號', '姓名', '科代碼', '科目名稱', '科學分', '科屬性', '科學期', '分數'];

/** mulberry32：可重現的亂數 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SENIOR_SUBJECTS = ['數學', '英文', '化學', '物理', '國文', '歷史', '地理', '生物'];
export const JUNIOR_SUBJECTS = ['數學', '英文', '理化', '國文', '歷史'];
export const NOTIFY_SUBJECTS = ['生命教育', '生涯規劃', '文化基本教材'];

/** 一列假資料（schema 與教務系統匯出檔同欄序） */
export function fakeRow(id: string, cls: string, seat: number, subject: string, attr = '0', name = `測試${id.slice(-3)}`): string[] {
  return [id, cls, String(seat), cls, String(seat), name, `C${subject.length}${subject.charCodeAt(0) % 97}`, subject, '2', attr, '1', '45'];
}

export interface FakeClass {
  oldClass: string;
  /** 本班補考學生人數 */
  students: number;
}

export interface FakeOptions {
  seed: number;
  classes: FakeClass[];
  /** 每位學生的科數上限（含）；1＝全部單科 */
  maxSubjects?: number;
  /** 只有另行通知科目的學生人數（每班加在最後） */
  notifyOnlyPerClass?: number;
  /** 一般學生另外帶另行通知科目的機率 */
  notifyExtraRatio?: number;
}

/** 產生假名單工作表（含表頭） */
export function fakeSheet(o: FakeOptions): string[][] {
  const r = rng(o.seed);
  const rows: string[][] = [HEADER];
  const max = o.maxSubjects ?? 4;
  let serial = 0;
  for (const c of o.classes) {
    const junior = /^[789]/.test(c.oldClass) || c.oldClass.startsWith('初');
    const pool = junior ? JUNIOR_SUBJECTS : SENIOR_SUBJECTS;
    let seat = 0;
    for (let i = 0; i < c.students; i++) {
      seat += r() < 0.3 ? 2 : 1;
      const id = `9${String(++serial).padStart(5, '0')}`;
      // 科數偏向 1：70% 單科，其餘均勻 2..max
      const k = r() < 0.7 || max === 1 ? 1 : 2 + Math.floor(r() * (max - 1));
      // 前段科目（數學、英文…）較常被選中，製造「大科」
      const picked = new Set<string>();
      while (picked.size < Math.min(k, pool.length)) {
        const idx = Math.min(pool.length - 1, Math.floor(Math.pow(r(), 1.8) * pool.length));
        picked.add(pool[idx] as string);
      }
      for (const s of picked) rows.push(fakeRow(id, c.oldClass, seat, s));
      if (r() < (o.notifyExtraRatio ?? 0.1)) rows.push(fakeRow(id, c.oldClass, seat, NOTIFY_SUBJECTS[Math.floor(r() * 3)] as string, '1'));
    }
    for (let i = 0; i < (o.notifyOnlyPerClass ?? 0); i++) {
      seat += 1;
      const id = `9${String(++serial).padStart(5, '0')}`;
      rows.push(fakeRow(id, c.oldClass, seat, NOTIFY_SUBJECTS[i % 3] as string, '1'));
    }
  }
  return rows;
}

export function fakeRoster(o: FakeOptions): MakeupRoster {
  return resolveMakeup(parseMakeupSheet(fakeSheet(o)));
}

let roomSerial = 0;
export function room(seats: number, use: MakeupRoom['use'] = 'class', name?: string): MakeupRoom {
  const rows = Math.min(7, Math.max(1, Math.ceil(seats / 8)));
  const depth = Math.ceil(seats / rows);
  const id = `R${++roomSerial}`;
  return { id, name: name ?? `${use === 'mixed' ? '綜合教室' : use === 'special' ? '特別教室' : '教室'}${id}`, rows, depth, seatCount: seats, use };
}

/** 一個考日、高中與初中各一組的設定；教室依人數給足 */
export function fakeSettings(roster: MakeupRoster, rooms: MakeupRoom[], extra: Partial<MakeupSettings> = {}): MakeupSettings {
  const grades = [...new Set(Object.values(roster.gradeOfClass))] as GradeKey[];
  const groups: MakeupGroup[] = defaultMakeupGroups(grades, 'D1');
  return { days: [{ id: 'D1', label: '1/23（六）' }], groups, rooms, early: DEFAULT_EARLY_RULE, ...extra };
}

/** 從名單到產出跑一遍 */
export function runAll(roster: MakeupRoster, settings: MakeupSettings) {
  const entries = makeupEntries(roster, settings.trackSplit);
  const plan = suggestPlan(entries, settings);
  const schedule = buildSchedule(entries, settings, plan);
  const outputs = buildOutputs(schedule, entries, settings);
  return { entries, plan, schedule, outputs };
}
