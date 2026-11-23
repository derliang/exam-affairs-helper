/**
 * D139（使用者 2026-11-18 夜：「拿掉！！！座位配置就照原來的在座位表上預覽的時候，點擊表示不能排的座位就好了」）：
 * 座位編輯只剩整間橫排／深位步進器＋點座位，沒有「每一排的深位」步進器；舊資料的 rowDepths 仍照樣顯示、輸出不變。
 * ①編輯卡沒有每排步進器；舊 rowDepths 資料畫出該排沒有的位置（淡斜線）；畫清單不會改資料；
 * ②排座結果、座位表、標籤的 sha256 與 D138 之前（origin/main 5f9c0fe）算出的值相同；
 * ③整間橫排、深位 +1 再 −1 回到原樣：教室資料相等、輸出 sha256 相同。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderToString as render } from 'preact-render-to-string';
import { classroomSeats } from '../data';
import { runSeating } from '../core/run';
import { makeFixture } from '../export/fixtures';
import { buildLabelPages, buildSeatPages, type ExportInput } from '../export/model';
import { RoomList, SeatGrid } from './components/RoomList';
import { setAllDepth, setRowCount } from './ast/roomEdit';
import { roomLimitsOf } from './rooms';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex');

function seat(f: ExportInput) {
  const r = runSeating({
    examId: f.exam.id, division: f.exam.division, classes: f.settings.classes, classrooms: f.settings.classrooms.filter((c) => c.kind === 'class').map((c, i) => ({ ...c, ...(i === 0 ? { seatCount: Math.max(c.seatCount, 20), track: 'science' as const } : { track: 'liberal' as const }) })),
    entries: f.entries, subjects: f.exam.subjects, markRules: f.exam.markRules, overrides: [], now: '2026-11-18T00:00:00Z',
  });
  if (!r.ok) throw new Error('排座失敗');
  return r.result;
}
// #625 之後頁面模型多一個 school 欄位（頁首校名）；這裡比的是座位與格子內容，所以雜湊前拿掉
const noSchool = <T extends { school?: string }>(pages: T[]): T[] => pages.map(({ school: _s, ...rest }) => rest as T);
const out = (f: ExportInput) => ({ seat: sha(noSchool(buildSeatPages(f, 'all'))), label: sha(noSchool(buildLabelPages(f, 'all'))) });

/** 在加每排步進器之前的程式（origin/main 5f9c0fe，core、export、data 本 PR 未改）算出的值 */
const GOLDEN = {
  seating: 'f4be9b39512598f246f97ec8f554c2a78b6dd4683d62da2fb8a7ed63cd97a9e8',
  // D182：自習座位頁多一枚圖例小標籤（STUDY_LEGEND），座位表雜湊由 7e37fce5… 更新；拿掉該小標籤後雜湊與舊值相同（已實測），其餘輸出不變；#550 圖例文字改後 8fcf75d0… → 43be7d4c…（只有圖例字串變，排座與其他輸出不變）
  // 座位表、標籤的輸出模型因匯出樣式包（D147）改了文字與統計表欄位、D170 移除「本教室考生人數」列而重算；排座結果 seating 的值沒變（引擎沒動）
  // D220（#647 #648）：座位表多空位／停用圖例小標籤、標籤多了空位格（只印座標）而重算：座位表 43be7d4c… → 61d725df…，標籤 26b25be2… → c5e933b8…；排座結果 seating 不變；D224 預備教室依用途配色（考試淡藍、自習淺灰）後座位表 a22e9531… → bda3ce68…，標籤 c60b0122… → 9d290f46…
  // 2026-11-23：座位表與標籤底色改依文理組＋加考科目（SeatKind），不再依班級色：座位表 61d725df… → a22e9531…，標籤 c5e933b8… → c60b0122…；排座結果 seating 不變
  seat: 'bda3ce684c9e25b5edaad62596c41b1b931756736f91d4f5895d743350f62187',
  label: '9d290f4682809c8b4bb1db5f22091ac6ed567f9cbf9bae0eb58128d44465dcc9',
};

describe('D139 拿掉每排深位步進器：座位編輯回到整間步進器＋點座位，舊資料輸出不變', () => {
  it('座位編輯卡沒有「每一排的深位」步進器，只有整間橫排、深位兩個步進器', () => {
    const f = makeFixture();
    const room = f.settings.classrooms[0]!;
    const html = render(<SeatGrid room={room} paper="B4" cap={49} lim={{ rows: 7, depth: 7 }} onClose={() => {}} onChange={() => {}} />);
    expect(html).not.toContain('每一排的深位');
    expect(html).not.toContain('rowdepths');
    expect(html).toContain('橫排（左右）');
    expect(html).toContain('深位（前後，整間）');
    expect(html).not.toContain('第1排深位');
  });
  it('舊資料有 rowDepths（每排深位不同）仍照樣顯示：該排沒有的位置畫淡斜線，畫的時候不改資料', () => {
    const f = makeFixture();
    const r0 = f.settings.classrooms[0]!;
    const rd = Array.from({ length: r0.rows }, (_, i) => (i === r0.rows - 1 ? r0.depth - 1 : r0.depth));
    const room = { ...r0, rowDepths: rd, seatCount: rd.reduce((a, b) => a + b, 0) };
    const before = sha(room);
    let changed = false;
    const html = render(<SeatGrid room={room} paper="B4" cap={49} lim={{ rows: 7, depth: 7 }} onClose={() => {}} onChange={() => { changed = true; }} />);
    expect(html.match(/class="pc none"/g)?.length).toBe(1);
    expect(changed).toBe(false);
    expect(sha(room)).toBe(before);
  });
  it('畫出教室清單（含每排步進器、展開前後）不會改到教室資料', () => {
    const f = makeFixture();
    const before = sha(f.settings.classrooms);
    let changed = false;
    render(<RoomList rooms={f.settings.classrooms} paper="B4" track="none" onChange={() => { changed = true; }} selected={f.exam.classroomIds} onSelect={() => { changed = true; }} />);
    expect(changed).toBe(false);
    expect(sha(f.settings.classrooms)).toBe(before);
  });
  it('排座結果、座位表、標籤的 sha256 與加步進器之前相同', () => {
    const f = makeFixture();
    const res = seat(f);
    expect(sha({ a: res.assignments, m: res.marks, d: res.detaches })).toBe(GOLDEN.seating);
    expect(out(f)).toEqual({ seat: GOLDEN.seat, label: GOLDEN.label });
  });
  it('整間橫排 +1 再 −1、整間深位 +1 再 −1：座位一樣、排座與輸出 sha256 不變', () => {
    const f = makeFixture();
    // 座位全開（沒有不排的座位）與有不排座位（disabled）兩種教室都驗
    const full = { ...f.settings.classrooms[0]!, seatCount: 20 };
    const holes = { ...f.settings.classrooms[1]!, seatCount: 18, disabled: ['2-3', '4-5'] };
    for (const room of [full, holes]) {
      const lim = { ...roomLimitsOf(room.kind), rows: roomLimitsOf(room.kind).rows };
      const trips = [
        setRowCount(setRowCount({ ...room, rowDepths: [room.depth, ...Array(room.rows - 1).fill(room.depth)] }, room.rows + 1, lim), room.rows, lim),
        setAllDepth(setAllDepth(room, room.depth + 1, lim), room.depth, lim),
      ];
      for (const back of trips) {
        expect(classroomSeats(back)).toEqual(classroomSeats(room));
        expect(back.seatCount).toBe(room.seatCount);
        expect(back.rowDepths).toBeUndefined();
      }
      const base = { ...f, settings: { ...f.settings, classrooms: f.settings.classrooms.map((c) => (c.id === room.id ? room : c)) } };
      const tripped = { ...f, settings: { ...f.settings, classrooms: f.settings.classrooms.map((c) => (c.id === room.id ? trips[0]! : c)) } };
      const a = seat(base); const b = seat(tripped);
      expect(sha({ a: b.assignments, m: b.marks, d: b.detaches })).toBe(sha({ a: a.assignments, m: a.marks, d: a.detaches }));
      expect(out(tripped)).toEqual(out(base));
    }
  });
});
