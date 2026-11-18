/**
 * 包 A 版面驗證用：用「全虛構」資料產生 Word 與列印頁 HTML，供轉 PDF／轉圖片目視檢查。
 * 用法：npx vite-node scripts/verify-layout-a.ts <輸出資料夾>
 * 會考 237 人／6 班（B4）、學測 270 人／6 班（B4、A3）；教室含 7 排與 6 排兩種。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildLabelPages, buildSeatPages, buildStudyLists, defaultLabelLayout, renderDocx, renderPrintHtml, type ExportInput } from '../src/export';
import { studentCode, type Classroom, type ClassInfo, type ExamConfig, type ExamEntry, type Settings, type Student } from '../src/data';
import { makeFixture } from '../src/export/fixtures';
import { runSeating } from '../src/core/run';

const out = process.argv[2] ?? 'verify-out';
const fd = new URL('../src/export/fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fd))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fd))),
};
const NAMES = '甲乙丙丁戊己庚辛壬癸';

interface Spec {
  tag: string;
  kind: 'gsat' | 'bcct';
  division: 'senior' | 'junior';
  perClass: number[];
  rooms: { name: string; rows: number; depth: number }[];
  reserve?: { rows: number; depth: number };
  paper: 'B4' | 'A3';
  classNoStart?: number;
}

function build(sp: Spec): ExportInput {
  const start = sp.classNoStart ?? 1;
  const classes: ClassInfo[] = sp.perClass.map((_, i) => ({ no: start + i, name: `${NAMES[i]}班`, division: sp.division, track: sp.division === 'senior' ? (i % 2 ? 'liberal' : 'science') : undefined, colorIndex: (i % 6) + 1 }) as ClassInfo);
  const classrooms: Classroom[] = sp.rooms.map((r, i) => ({ id: `r${i + 1}`, name: r.name, kind: 'class' as const, rows: r.rows, depth: r.depth, seatCount: r.rows * r.depth, division: sp.division, ...(sp.division === 'senior' ? { track: i % 2 ? ('liberal' as const) : ('science' as const) } : {}) }));
  if (sp.reserve) classrooms.push({ id: 'rv', name: '預備教室', kind: 'reserve', rows: sp.reserve.rows, depth: sp.reserve.depth, seatCount: sp.reserve.rows * sp.reserve.depth, division: sp.division });
  const settings = { schoolName: '測試學校', headerText: '模擬考', defaultLabelPaper: sp.paper, classes, classrooms } as Settings;
  const students: Student[] = [];
  classes.forEach((c, ci) => { for (let n = 1; n <= sp.perClass[ci]!; n++) students.push({ classNo: c.no, seatNo: n, name: `甲生${c.no}${String(n).padStart(2, '0')}` }); });
  const subjects = sp.kind === 'gsat' ? [{ id: 'zh', name: '國文' }, { id: 'en', name: '英文' }, { id: 'ma', name: '數學' }] : [{ id: 'zh', name: '國文' }, { id: 'en', name: '英語' }, { id: 'ma', name: '數學' }, { id: 'sc', name: '自然' }, { id: 'so', name: '社會' }];
  const exam = {
    id: 'e1', name: `${sp.tag}`, kind: sp.kind, division: sp.division, semester: 'first', round: 1, participation: 'all', subjects, markRules: [],
    classroomIds: classrooms.map((c) => c.id), labelLayout: defaultLabelLayout(sp.paper), createdAt: '2026-11-08T00:00:00Z',
  } as unknown as ExamConfig;
  const entries: ExamEntry[] = students.map((s, i) => ({ classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: i % 17 === 5 ? subjects.slice(0, 2).map((x) => x.id) : subjects.map((x) => x.id) }));
  const r = runSeating({ examId: 'e1', division: sp.division, classes, classrooms, entries, subjects, markRules: [], overrides: [], now: '2026-11-08T08:30:00Z' });
  if (!r.ok) throw new Error(`${sp.tag} 排座失敗：${r.errors.join('；')}`);
  void studentCode;
  return { settings, exam, students, entries, result: r.result };
}

const specs: Spec[] = [
  // 會考 237 人／6 班：6 間 7 排×6 深位（42 座）
  { tag: '會考237', kind: 'bcct', division: 'junior', perClass: [40, 39, 40, 39, 40, 39], rooms: Array.from({ length: 6 }, (_, i) => ({ name: `國${i + 1}教室`, rows: 7, depth: 6 })), paper: 'B4' },
  // 同上，A3（深位 6）
  { tag: '會考237A3', kind: 'bcct', division: 'junior', perClass: [40, 39, 40, 39, 40, 39], rooms: Array.from({ length: 6 }, (_, i) => ({ name: `國${i + 1}教室`, rows: 7, depth: 6 })), paper: 'A3' },
  // 會考混 7 排與 6 排教室
  { tag: '會考混排', kind: 'bcct', division: 'junior', perClass: [40, 39, 40, 39, 40, 39], rooms: [7, 6, 7, 6, 7, 6].map((rw, i) => ({ name: `混${i + 1}教室`, rows: rw, depth: 7 })), paper: 'B4' },
  // 7 排×5 深位（有注意事項的情形）
  { tag: '會考5深位', kind: 'bcct', division: 'junior', perClass: [40, 39, 40, 39, 40, 39], rooms: Array.from({ length: 7 }, (_, i) => ({ name: `淺${i + 1}教室`, rows: 7, depth: 5 })), paper: 'B4' },
  // 學測 270 人／6 班（45 人）：7 排×7 深位（49 座）＋預備教室
  { tag: '學測270', kind: 'gsat', division: 'senior', perClass: [45, 45, 45, 45, 45, 45], rooms: Array.from({ length: 6 }, (_, i) => ({ name: `高${i + 1}教室`, rows: 7, depth: 7 })), reserve: { rows: 7, depth: 6 }, paper: 'B4' },
  { tag: '學測270A3', kind: 'gsat', division: 'senior', perClass: [45, 45, 45, 45, 45, 45], rooms: Array.from({ length: 6 }, (_, i) => ({ name: `高${i + 1}教室`, rows: 7, depth: 7 })), reserve: { rows: 7, depth: 6 }, paper: 'A3' },
];

mkdirSync(out, { recursive: true });
{
  // 自習參考座位頁（#386）：科目 id 改成真實節次表的 id（chinese／english／math），才對得到第幾天、時段
  const f = JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;
  const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'VERIFY01', fonts };
  const seat = buildSeatPages(f, 'reserve');
  writeFileSync(`${out}/自習參考-座位表.docx`, await renderDocx({ seat }, meta));
  writeFileSync(`${out}/自習參考-座位表.html`, renderPrintHtml({ seat }, meta));
  console.log('自習參考', seat.map((p) => `${p.roomName}|${JSON.stringify(p.chips)}`).join(' ;; '));
}
{
  // 預備教室 7 排×8 深位（G30）：用測試假資料
  const f = makeFixture();
  const rv = f.settings.classrooms.find((c) => c.kind === 'reserve')!;
  rv.rows = 7; rv.depth = 8; rv.seatCount = 56;
  const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'VERIFY01', fonts };
  const label = buildLabelPages(f, 'reserve');
  writeFileSync(`${out}/預備7x8-標籤.docx`, await renderDocx({ label }, meta));
  writeFileSync(`${out}/預備7x8-標籤.html`, renderPrintHtml({ label }, meta));
  console.log('預備7x8 標籤頁', label.length);
}
for (const sp of specs) {
  const f = build(sp);
  const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'VERIFY01', fonts };
  const label = [...buildLabelPages(f, 'class'), ...buildLabelPages(f, 'reserve')];
  const seat = [...buildSeatPages(f, 'class'), ...buildSeatPages(f, 'reserve')];
  writeFileSync(`${out}/${sp.tag}-標籤.docx`, await renderDocx({ label }, meta));
  writeFileSync(`${out}/${sp.tag}-座位表.docx`, await renderDocx({ seat }, meta));
  writeFileSync(`${out}/${sp.tag}-標籤.html`, renderPrintHtml({ label }, meta));
  writeFileSync(`${out}/${sp.tag}-座位表.html`, renderPrintHtml({ seat }, meta));
  if (sp.kind === 'gsat') { const study = buildStudyLists(f); if (study.length) writeFileSync(`${out}/${sp.tag}-自習.docx`, await renderDocx({ list: study }, meta)); }
  console.log(sp.tag, '標籤頁', label.length, '座位頁', seat.length);
}
