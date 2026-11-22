/** 比對前後兩份文件，推出「剛剛做了什麼」給復原按鈕用（純函式；頁面不用各自傳名稱） */
import type { Division, Student } from '../data';
import type { Doc } from './store';
import { rosterYearOf } from './rosterYears';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const key = (s: Student): string => `${s.classNo}-${s.seatNo}`;
const DIV: Record<Division, string> = { senior: '高中部', junior: '國中部' };

function rosterLabel(prev: Student[], next: Student[], div: Division): string | undefined {
  if (same(prev, next)) return undefined;
  const p = new Map(prev.map((s) => [key(s), s]));
  const n = new Map(next.map((s) => [key(s), s]));
  const added = next.filter((s) => !p.has(key(s))).length;
  const removed = prev.filter((s) => !n.has(key(s))).length;
  if (next.length === 0 && prev.length > 1) return `刪除${DIV[div]}全部名單`;
  if (added + removed > 3) return `匯入${DIV[div]}學生名單`;
  if (added === 1 && removed === 0) return '新增學生';
  if (removed === 1 && added === 0) return '刪除學生';
  if (added === 0 && removed === 0) return '編輯學生';
  return `修改${DIV[div]}學生名單`;
}

function examLabel(prev: Doc['exams'], next: Doc['exams']): string | undefined {
  if (same(prev, next)) return undefined;
  if (next.length > prev.length) return '新增模擬考';
  if (next.length < prev.length) return '刪除模擬考';
  const i = next.findIndex((e, k) => !same(e, prev[k]));
  const a = prev[i]; const b = next[i];
  if (!a || !b) return '修改模擬考';
  if (!!a.archived !== !!b.archived) return b.archived ? '封存模擬考' : '還原模擬考';
  if (a.name !== b.name) return '修改考試名稱';
  if (!same(a.subjects, b.subjects)) return '修改考科表';
  if (!same(a.classroomIds, b.classroomIds)) return '選用教室';
  if (!same(a.markRules, b.markRules)) return '修改個別覆寫';
  if (!same(a.labelLayout, b.labelLayout)) return '修改標籤版面';
  if (a.round !== b.round) return '修改次別';
  return '修改模擬考設定';
}

function settingsLabel(prev: Doc['settings'], next: Doc['settings']): string | undefined {
  if (same(prev, next)) return undefined;
  if (!same(prev.classes, next.classes)) {
    if (next.classes.length > prev.classes.length) return '新增班級';
    if (next.classes.length < prev.classes.length) return '刪除班級';
    const a = prev.classes.find((c, k) => !same(c, next.classes[k]));
    const b = a && next.classes.find((c) => c.no === a.no && c.division === a.division);
    if (a && b && a.colorIndex !== b.colorIndex) return '修改班級色';
    if (a && b && a.track !== b.track) return '修改文理組';
    if (a && b && a.name !== b.name) return '修改班級名稱';
    return '修改班級資料';
  }
  if (!same(prev.classrooms, next.classrooms)) {
    return next.classrooms.length > prev.classrooms.length ? '新增教室' : next.classrooms.length < prev.classrooms.length ? '刪除教室' : '修改教室';
  }
  if (prev.schoolName !== next.schoolName || prev.headerText !== next.headerText || prev.seatHeader !== next.seatHeader || prev.labelHeader !== next.labelHeader || prev.labelNotes !== next.labelNotes || prev.defaultLabelPaper !== next.defaultLabelPaper) return '修改學校與表頭';
  if (!same(prev.schedules, next.schedules)) return '修改節次與時長';
  if (!same(prev.features, next.features)) return '切換選用功能';
  if (!same(prev.env, next.env)) return '確認環境';
  return '修改設定';
}

function filesLabel(prev: Doc['examFiles'], next: Doc['examFiles']): string | undefined {
  if (same(prev ?? {}, next ?? {})) return undefined;
  const ids = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  for (const id of ids) {
    const a = prev?.[id] ?? {}; const b = next?.[id] ?? {};
    if (!same(a.result, b.result)) return b.result ? '排座' : '清除排座結果';
    if (!same(a.entries, b.entries)) return '匯入考試名單';
    if (!same(a.diffs, b.diffs)) return '處理名單比對';
    if (!same(a.overrides, b.overrides)) return '修改個別覆寫';
  }
  return '修改考試檔案';
}

/** 補考場次（K2）：新增／刪除場次，或看是哪一塊變了 */
function makeupLabel(prev: Doc['makeups'], next: Doc['makeups']): string | undefined {
  const a = prev ?? []; const b = next ?? [];
  if (same(a, b)) return undefined;
  if (b.length > a.length) return '新增補考場次';
  if (b.length < a.length) return '刪除補考場次';
  const i = b.findIndex((m, k) => !same(m, a[k]));
  const x = a[i]; const y = b[i];
  if (!x || !y) return '修改補考';
  if (!same(x.parse, y.parse)) return '匯入補考名單';
  if (!same(x.resolutions, y.resolutions)) return '處理補考名單問題列';
  if (!same(x.rooms, y.rooms) || !same(x.roomOff, y.roomOff)) return '修改補考教室';
  if (!same(x.plan, y.plan)) return '調整補考考程';
  if (!same(x.trackSplit, y.trackSplit)) return '修改選組拆分';
  if (!same(x.days, y.days) || !same(x.gradeDay, y.gradeDay)) return '修改補考考日';
  if (!same(x.snapshot, y.snapshot) && same({ ...x, snapshot: undefined }, { ...y, snapshot: undefined })) return '記錄補考對帳結果';
  return '修改補考設定';
}

/** 同一次變更碰到多處時，以一句話涵蓋；找不到就回 undefined（由呼叫端用預設名稱） */
export function describeChange(prev: Doc, next: Doc): string | undefined {
  // #634：切換／新增學年度會把工作名單整份換掉，不能當成「刪除全部名單」
  if (next.rosterYear !== undefined && next.rosterYear !== rosterYearOf(prev)) return `切換學年度（${rosterYearOf(prev)}→${next.rosterYear}）`;
  const parts: string[] = [];
  for (const div of ['senior', 'junior'] as Division[]) {
    const l = rosterLabel(prev.rosters[div], next.rosters[div], div);
    if (l) parts.push(l);
  }
  const x = examLabel(prev.exams, next.exams); if (x) parts.push(x);
  const s = settingsLabel(prev.settings, next.settings); if (s) parts.push(s);
  const f = filesLabel(prev.examFiles, next.examFiles); if (f) parts.push(f);
  const mk = makeupLabel(prev.makeups, next.makeups); if (mk) parts.push(mk);
  if (parts.length === 0) return undefined;
  // 名單比對套用會同時動學生名單與考試名單：用較能描述整件事的那個
  if (parts.length > 1 && parts.includes('處理名單比對')) return '套用名單比對';
  if (parts.length > 1 && parts.includes('新增班級') && parts[0]?.startsWith('匯入')) return `${parts[0]}並新增班級`;
  return parts[0];
}
