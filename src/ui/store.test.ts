import { describe, expect, it } from 'vitest';
import { demoDoc } from './repository';
import { addStudent, defaultSemester, examYear, newExam, nextRound, removeStudent, searchStudents, setClassColor, setClassTrack, updateExam, updateStudent, type Doc } from './store';

describe('學生名單', () => {
  it('新增：重複座號、班級不存在、座號越界、姓名空白都擋下', () => {
    const d = demoDoc();
    expect(addStudent(d, 'senior', { classNo: 1, seatNo: 1, name: '某人' }).ok).toBe(false);
    expect(addStudent(d, 'senior', { classNo: 9, seatNo: 1, name: '某人' }).ok).toBe(false);
    expect(addStudent(d, 'senior', { classNo: 1, seatNo: 100, name: '某人' }).ok).toBe(false);
    expect(addStudent(d, 'senior', { classNo: 1, seatNo: 5, name: ' ' }).ok).toBe(false);
  });
  it('新增後依班級座號排序；學號空白不存', () => {
    const r = addStudent(demoDoc(), 'senior', { classNo: 1, seatNo: 10, name: '新生', schoolId: ' ' });
    if (!r.ok) throw new Error(r.error);
    const l = r.doc.rosters.senior.filter((s) => s.classNo === 1);
    expect(l.map((s) => s.seatNo)).toEqual([1, 2, 3, 10]);
    expect(l[3]).not.toHaveProperty('schoolId');
  });
  it('編輯可保留原座號；改成別人的座號會被擋；刪除保留空號', () => {
    const d = demoDoc();
    const s = d.rosters.senior[0]!;
    expect(updateStudent(d, 'senior', s, { ...s, name: '改名' }).ok).toBe(true);
    expect(updateStudent(d, 'senior', s, { ...s, seatNo: 2 }).ok).toBe(false);
    const after = removeStudent(d, 'senior', s);
    expect(after.rosters.senior.some((x) => x.classNo === 1 && x.seatNo === 1)).toBe(false);
    expect(after.rosters.senior).toHaveLength(d.rosters.senior.length - 1);
  });
  it('可依姓名、考生編號搜尋', () => {
    const l = demoDoc().rosters.senior;
    expect(searchStudents(l, '小明')).toHaveLength(1);
    expect(searchStudents(l, '0102')).toHaveLength(1);
    expect(searchStudents(l, '')).toHaveLength(l.length);
  });
});

describe('班級與考試', () => {
  it('國中部不能設文理組；高中部可以', () => {
    const d = demoDoc();
    expect(setClassTrack(d, 'junior', 1, 'liberal')).toBe(d);
    const s = setClassTrack(d, 'senior', 1, 'liberal');
    expect(s.settings.classes.find((c) => c.no === 1 && c.division === 'senior')?.track).toBe('liberal');
  });
  it('改色只動指定班級與部別', () => {
    const d = setClassColor(demoDoc(), 'senior', 1, 9);
    expect(d.settings.classes.filter((c) => c.colorIndex === 9 && c.division === 'senior')).toHaveLength(1);
  });
  it('新增考試：學測高中部、會考國中部、分科（部分參加、八科）、同名擋下', () => {
    const now = new Date('2026-11-08T00:00:00Z');
    const g = newExam(demoDoc(), 'gsat', '學測第三次', now);
    if (!g.ok) throw new Error(g.error);
    expect(g.doc.exams[0]).toMatchObject({ division: 'senior', kind: 'gsat' });
    expect(newExam(g.doc, 'gsat', '學測第三次', now).ok).toBe(false);
    const a = newExam(demoDoc(), 'ast', '分科第一次', now);
    if (!a.ok) throw new Error(a.error);
    expect(a.doc.exams[0]).toMatchObject({ division: 'senior', kind: 'ast' });
    expect(a.doc.exams[0]?.subjects.map((x) => x.name)).toEqual(['數學甲', '數學乙', '物理', '化學', '生物', '歷史', '地理', '公民與社會']);
    const b = newExam(demoDoc(), 'bcct', '會考第一次', now);
    if (!b.ok) throw new Error(b.error);
    expect(b.doc.exams[0]?.division).toBe('junior');
  });
});

describe('預設班級', () => {
  it('全新資料夾（空 Doc）帶入高中國中預設班級；已有班級就不動', async () => {
    const { emptyDoc, withDefaults, demoDoc } = await import('./repository');
    const d = withDefaults(emptyDoc());
    expect(d.settings.classes.filter((c) => c.division === 'senior').map((c) => c.track)).toEqual(['science', 'science', 'science', 'liberal', 'liberal', 'liberal']);
    expect(d.settings.classes.filter((c) => c.division === 'junior').every((c) => c.track === undefined)).toBe(true);
    const demo = demoDoc();
    expect(withDefaults(demo)).toBe(demo);
  });
});

describe('更新考試', () => {
  it('改名擋同名與空白；其他欄位直接套用', async () => {
    const { updateExam } = await import('./store');
    const a = newExam(demoDoc(), 'gsat', 'A', new Date(1));
    if (!a.ok) throw new Error(a.error);
    const b = newExam(a.doc, 'bcct', 'B', new Date(2));
    if (!b.ok) throw new Error(b.error);
    const id = b.doc.exams[1]!.id;
    expect(updateExam(b.doc, id, { name: 'A' }).ok).toBe(false);
    expect(updateExam(b.doc, id, { name: ' ' }).ok).toBe(false);
    const r = updateExam(b.doc, id, { name: 'C', semester: 'second' });
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.exams[1]).toMatchObject({ name: 'C', semester: 'second' });
    expect(b.doc.exams[0]?.subjects.map((x) => x.name)).toContain('英聽');
  });
});

describe('新考試的標籤格數（D113）', () => {
  it('B4、A3 預設都是 7×7', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    for (const [paper, cols, rows] of [['B4', 7, 7], ['A3', 7, 7]] as const) {
      const d = demoDoc();
      d.settings = { ...d.settings, defaultLabelPaper: paper };
      const r = newExam(d, 'gsat', '學測第一次', now);
      expect(r.ok && r.doc.exams.at(-1)?.labelLayout).toEqual({ paper, cols, rows });
    }
  });
  it('學期預設依類型（D91）：學測上學期、分科下學期、會考上學期；仍可指定', () => {
    const now = new Date('2026-11-08T00:00:00Z');
    expect(defaultSemester('gsat')).toBe('first');
    expect(defaultSemester('ast')).toBe('second');
    expect(defaultSemester('bcct')).toBe('first');
    const sem = (kind: 'gsat' | 'ast' | 'bcct', semester?: 'first' | 'second') => {
      const r = newExam(demoDoc(), kind, 'x', now, semester ? { semester } : {});
      if (!r.ok) throw new Error(r.error);
      return r.doc.exams[0]?.semester;
    };
    expect(sem('gsat')).toBe('first');
    expect(sem('ast')).toBe('second');
    expect(sem('bcct')).toBe('first');
    expect(sem('ast', 'first')).toBe('first');
  });
});

describe('學年度可指定（#211）', () => {
  const today = new Date(2026, 10, 15); // 115 學年
  const base = () => ({ ...demoDoc(), exams: [] });
  it('沒指定就依日期；指定 114 就記 114，不被建立日期覆蓋', () => {
    const a = newExam(base(), 'ast', '分科第七次', today);
    if (!a.ok) throw new Error(a.error);
    expect(examYear(a.doc.exams[0]!)).toBe(115);
    const b = newExam(base(), 'ast', '114-2 分科第七次', today, { year: 114 });
    if (!b.ok) throw new Error(b.error);
    expect(examYear(b.doc.exams[0]!)).toBe(114);
  });
  it('次別只算同學年度；① 可改學年度；不合理的年度擋下；舊存檔沒欄位照舊推算', () => {
    const a = newExam(base(), 'gsat', '學測第一次', today, { year: 114 });
    if (!a.ok) throw new Error(a.error);
    const b = newExam(a.doc, 'gsat', '學測乙', today);
    if (!b.ok) throw new Error(b.error);
    expect(b.doc.exams[1]!.round).toBe(1); // 115 學年第一次，不接 114 的
    expect(newExam(base(), 'ast', 'x', today, { year: 14 }).ok).toBe(false);
    const u = updateExam(b.doc, b.doc.exams[1]!.id, { schoolYear: 114 });
    expect(u.ok && examYear(u.doc.exams[1]!)).toBe(114);
    expect(updateExam(b.doc, b.doc.exams[1]!.id, { schoolYear: 1.5 }).ok).toBe(false);
    const { schoolYear: _drop, ...legacy } = a.doc.exams[0]!;
    expect(examYear(legacy)).toBe(115);
  });
});

describe('預設次別（#248）', () => {
  const today = new Date(2026, 10, 15);
  const withRounds = (rounds: number[]) => {
    let d: Doc = { ...demoDoc(), exams: [] };
    rounds.forEach((r, i) => {
      const x = newExam(d, 'gsat', `舊${i}`, new Date(today.getTime() + i * 1000), { round: r });
      if (!x.ok) throw new Error(x.error);
      d = x.doc;
    });
    return d;
  };
  it('沒有考試就第 1 次；補登缺的次別補回缺的那次，不是筆數 + 1', () => {
    expect(nextRound(withRounds([]), 'gsat', today)).toBe(1);
    expect(nextRound(withRounds([3, 4]), 'gsat', today)).toBe(1); // 已有 E3、E4，再建 E1
    expect(nextRound(withRounds([1, 3, 4]), 'gsat', today)).toBe(2);
    expect(nextRound(withRounds([1, 2, 3]), 'gsat', today)).toBe(4);
  });
  it('新建的學測沒給次別時用這個預設；不同學年度互不影響', () => {
    const d = withRounds([4]);
    const r = newExam(d, 'gsat', '補登', new Date(today.getTime() + 9000));
    expect(r.ok && r.doc.exams.at(-1)!.round).toBe(1);
    const old = newExam(d, 'gsat', '另一學年', new Date(today.getTime() + 9000), { year: 114 });
    expect(old.ok && old.doc.exams.at(-1)!.round).toBe(1);
  });
});
