/**
 * #369、D155、D159：班級教室「不排座」。旗標只管「預設列入哪些教室」與首次設定的座位合計；引擎不看旗標，
 * 本次用哪些教室永遠看考試 ③ 的勾選（ExamConfig.classroomIds），兩者衝突以 ③ 為準。全部假資料。
 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createMemoryFS, loadDoc, saveDoc, studentCode, type Classroom, type ClassInfo, type ExamEntry } from '../data';
import { runSeating, seatExam, seatingVersion } from '../core';
import { RoomList } from './components/RoomList';
import { classRoomRows, missingClassRooms, syncClassRooms } from './classRooms';
import { stepLines } from './env';
import { setNoSeat } from './rooms';
import { newExam, type Doc } from './store';
import { demoDoc } from './repository';

const noop = () => undefined;
const cr = (id: string, name: string, extra: Partial<Classroom> = {}): Classroom => ({ id, name, kind: 'class', rows: 2, depth: 3, seatCount: 6, division: 'senior', track: 'science', ...extra });

/** 高三三個班各 3 人（溫、良、恭），三間班級教室各 6 座 */
function docOf(noSeatId?: string): Doc {
  const base = demoDoc();
  const students = [1, 2, 3].flatMap((c) => [1, 2, 3].map((n) => ({ classNo: c, seatNo: n, name: `生${c}${n}` })));
  const names = ['溫', '良', '恭'];
  const classrooms = names.map((n, i) => cr(`k${i + 1}`, n, noSeatId === `k${i + 1}` ? { noSeat: true } : {}));
  return { ...base, settings: { ...base.settings, classrooms }, rosters: { ...base.rosters, senior: students } };
}
const examOf = (doc: Doc) => {
  const r = newExam(doc, 'gsat', '測試考', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams[r.doc.exams.length - 1]! };
};

describe('setNoSeat', () => {
  it('標記與改回：改回就把欄位拿掉（和舊存檔一樣）；預備教室沒有這個概念', () => {
    const a = cr('k1', '溫');
    const on = setNoSeat(a, true);
    expect(on.noSeat).toBe(true);
    const off = setNoSeat(on, false);
    expect('noSeat' in off).toBe(false);
    expect(off).toEqual(a);
    const rv: Classroom = { ...a, kind: 'reserve' };
    expect(setNoSeat(rv, true)).toBe(rv);
  });
  it('存檔讀回旗標還在；舊存檔沒有欄位＝照常排座', async () => {
    const d = docOf('k2');
    const fs = createMemoryFS();
    await saveDoc(fs, d);
    const back = (await loadDoc(fs)).data.settings.classrooms;
    expect(back.find((r) => r.id === 'k2')!.noSeat).toBe(true);
    expect(back.filter((r) => r.noSeat)).toHaveLength(1);
    expect(back.find((r) => r.id === 'k1')!.noSeat).toBeUndefined();
  });
});

describe('預設列入：旗標＝全域預設不列入，③ 的勾選優先', () => {
  it('沒有旗標：三間都自動列入本次考試', () => {
    const { doc, exam } = examOf(docOf());
    const next = syncClassRooms(doc, exam);
    expect(next.exams[0]!.classroomIds.sort()).toEqual(['k1', 'k2', 'k3']);
  });
  it('k2 不排座：自動帶入時不列入 k2，也不算「缺教室」', () => {
    const { doc, exam } = examOf(docOf('k2'));
    expect(missingClassRooms(doc, exam)).toBe(2);
    const next = syncClassRooms(doc, exam);
    expect(next.exams[0]!.classroomIds.sort()).toEqual(['k1', 'k3']);
    expect(missingClassRooms(next, next.exams[0]!)).toBe(0);
    expect(classRoomRows(next, next.exams[0]!).find((r) => r.room?.id === 'k2')).toMatchObject({ inExam: false, skipped: true });
  });
  it('衝突時以 ③ 目前勾選為準：使用者在 ③ 勾了 k2，就照勾選列入，旗標不會把它拿掉', () => {
    const { doc, exam } = examOf(docOf('k2'));
    const ticked = { ...doc, exams: [{ ...exam, classroomIds: ['k1', 'k2', 'k3'] }] };
    const next = syncClassRooms(ticked, ticked.exams[0]!);
    expect(next).toBe(ticked); // 沒有要補的，原樣
    expect(classRoomRows(next, next.exams[0]!).find((r) => r.room?.id === 'k2')).toMatchObject({ inExam: true, skipped: false });
  });
});

describe('首次設定的座位合計與座位不足', () => {
  const rooms4 = (doc: Doc) => stepLines(doc, 4).find((l) => l.key === 'rooms:senior')!;
  it('合計不含不排座的教室', () => {
    expect(rooms4(docOf()).text).toContain('座位 18');
    expect(rooms4(docOf('k2')).text).toContain('座位 12');
  });
  it('剩下的座位不夠（同組合計）仍紅字擋下；夠就不擋', () => {
    // 理組：溫、良、恭三班 9 人；兩間不排座 → 只剩 6 座 < 9 人
    const base = docOf('k2');
    const tight: Doc = { ...base, settings: { ...base.settings, classrooms: base.settings.classrooms.map((r) => (r.id === 'k3' ? { ...r, noSeat: true } : r)) } };
    const l = rooms4(tight);
    expect(l.tone).toBe('bad');
    expect(l.problem).toContain('還差');
    expect(rooms4(docOf('k2')).tone).toBe('ok');
  });
});

describe('引擎：不排座的教室不放進 classrooms，學生排進其他班級教室，不改引擎（D25 照舊）', () => {
  const classes: ClassInfo[] = ['溫', '良', '恭'].map((name, i) => ({ no: i + 1, name, division: 'senior', track: 'science', colorIndex: i + 1 }));
  const rooms = [cr('k1', '溫'), cr('k2', '良'), cr('k3', '恭')];
  const codes = [1, 2, 3].flatMap((c) => [1, 2, 3].map((n) => studentCode(c, n)));
  const entries: ExamEntry[] = codes.map((_, i) => ({ classNo: Math.floor(i / 3) + 1, seatNo: (i % 3) + 1, name: `生${i}`, subjectIds: ['zh'] }));
  it('少一間教室：9 人全部排進剩下兩間（12 座），每人一個座位', () => {
    const r = seatExam({ division: 'senior', classes, classrooms: rooms.filter((x) => x.id !== 'k2'), codes });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assignments).toHaveLength(9);
    expect(new Set(r.assignments.map((a) => a.classroomId))).toEqual(new Set(['k1', 'k3']));
    expect(new Set(r.assignments.map((a) => a.code)).size).toBe(9);
  });
  it('座位不夠就照 D25 擋下，不輸出部分結果', () => {
    const r = seatExam({ division: 'senior', classes, classrooms: [rooms[0]!], codes });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toContain('座位不足');
  });
  it('旗標不進資料版本碼，也不影響排座：同樣的 classrooms 內容，有沒有旗標版本碼相同', () => {
    const input = { examId: 'e', division: 'senior' as const, classes, entries, subjects: [], markRules: [], overrides: [], now: 'x' };
    const a = seatingVersion({ ...input, classrooms: [rooms[0]!, rooms[2]!] });
    const b = seatingVersion({ ...input, classrooms: [{ ...rooms[0]!, noSeat: true }, rooms[2]!] });
    expect(b).toBe(a);
    const run = runSeating({ ...input, classrooms: [rooms[0]!, rooms[2]!] });
    expect(run.ok).toBe(true);
  });
});

describe('教室清單：不排座鈕與徽章', () => {
  const render = (rooms: Classroom[], toggle = true) =>
    renderToString(<RoomList rooms={rooms} paper="B4" onChange={noop} division="senior" track="none" {...(toggle ? { noSeatToggle: true } : {})} />);
  it('班級教室每列有「編輯座位」＋「不排座」；不是紅色、沒有「刪除」', () => {
    const html = render([cr('k1', '溫')]);
    expect(html).toContain('編輯座位 ▾');
    expect(html).toContain('>不排座<');
    expect(html).not.toContain('>刪除<');
    expect(html).not.toContain('btn-danger');
  });
  it('不排座列：中性徽章「不排座」、降一階（off）、編輯座位停用、改顯示「改回排座」', () => {
    const html = render([cr('k1', '溫', { noSeat: true })]);
    expect(html).toContain('改回排座');
    expect(html).toContain('badge');
    expect(html).toContain('roomrow off');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>編輯座位 ▾<\/button>/);
  });
  it('沒傳 noSeatToggle（考試 ③ 等）：沒有這顆鈕', () => {
    expect(render([cr('k1', '溫')], false)).not.toContain('>不排座<');
  });
  it('預備教室不給「不排座」', () => {
    expect(render([cr('v1', '預備', { kind: 'reserve', track: undefined })])).not.toContain('>不排座<');
  });
});
