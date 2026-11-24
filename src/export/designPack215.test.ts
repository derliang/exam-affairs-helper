/**
 * D220（稿 v2.103）：座位表一間教室一頁（#645）、座位表畫全部座位且空位／停用分開（#647）、
 * 標籤空位也印只有座位編號（#648）、補考 O-5 格狀座位圖（#644）、補考 O-2 兩張表（#646）。全部匿名假資料。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { buildLabelPages, buildSeatPages, renderDocx, renderPrintHtml, seatGeometry, statLayout, SEAT_CELL_MM, SEAT_PAGE, type SeatPageModel } from './index';
import { makeFixture } from './fixtures';
import { fakeRoster, fakeSettings, room, runAll, type FakeClass } from '../core/makeup/fixtures';
import { buildSeatTablePages, buildTimetablePages } from './makeupPages';
import { MAKEUP_DOC_KINDS, produceMakeupFiles, produceMakeupPrintHtml, type ProduceMakeupInput } from './makeupFiles';
import { readDocxTables } from './makeupReadback';

vi.setConfig({ testTimeout: 60000 });
const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-22T08:30:00Z', dataVersion: 'A1B2C3D4' };
const xmlOf = async (buf: Uint8Array): Promise<string> => (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');

/** 7×7 教室、12 列統計表（學測兩天多科的真實規模；與 #212 同一種擔心：座位格字太小） */
function bigPage(rowsN: number, depth = 7): SeatPageModel {
  const f = makeFixture();
  f.settings.classrooms[0] = { ...f.settings.classrooms[0]!, rows: 7, depth, seatCount: 7 * depth };
  const p = buildSeatPages(f, 'class')[0]!;
  const classes = ['溫', '良', '恭', '儉', '勤', '誠'];
  return {
    ...p,
    rows: 7,
    depth,
    stats: { ...p.stats, table: { classes, leadHeads: ['日期', '第幾天', '時段', '科目'], rows: Array.from({ length: rowsN }, (_, i) => ({ label: `科${i}`, lead: ['11/17（二）', `第 ${1 + (i >> 2)} 天`, `時段${'一二三四'[i % 4]}`, `科${i}`], per: [6, 6, 6, 6, 6, 6], total: 36 })) } },
  };
}

describe('#645 座位表一間教室一頁（推翻 D111）：統計表逐級縮小', () => {
  it('7×7、統計表 12 列：不換頁、座位格 ≥ 18mm（精簡 9pt）', () => {
    const p = bigPage(12);
    const g = seatGeometry(p);
    expect(g.statsNext).toBe(false);
    expect(g.tier).toBeGreaterThanOrEqual(1);
    expect(g.ch).toBeGreaterThanOrEqual(SEAT_CELL_MM.pref);
    // 整頁放得下：座位格＋統計表＋固定部分（標題、小標籤、講臺、頁尾約 75mm）不超過可印高度
    expect(g.ch * p.depth + statLayout(p, g.tier).total + 75).toBeLessThanOrEqual(SEAT_PAGE.h - 2 * SEAT_PAGE.padY + 9);
  });
  it('列數少維持原樣（tier 0，輸出與以前相同）；列數多才逐級縮', () => {
    expect(seatGeometry(bigPage(3)).tier).toBe(0);
    expect(seatGeometry(bigPage(14, 8)).statsNext).toBe(false);
  });
  it('極端：列數遠超過可縮範圍才退回統計表另起一頁（最後手段）', () => {
    expect(seatGeometry(bigPage(40, 8)).statsNext).toBe(true);
  });
  it('Word、列印頁都沒有另起一頁的統計表', async () => {
    const p = bigPage(12);
    const xml = await xmlOf(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    expect(xml).not.toContain('w:pageBreakBefore');
    expect(renderPrintHtml({ seat: [p] }, meta).match(/<section class="sheet pp pp-seat"/g)).toHaveLength(1);
  });
});

describe('#647 座位表畫出教室全部座位：空位（斜線）與停用（斜紋）分開', () => {
  const f = () => {
    const x = makeFixture();
    // 乙教室：4 排×5 深位＝20 格，可用 15，其中停用 1-1；12 人 → 空位 15-1-12... 以 usable 與 cells 實算
    x.settings.classrooms[1] = { ...x.settings.classrooms[1]!, seatCount: 15, disabled: ['1-1'] };
    const mine = x.result.assignments.filter((a) => a.classroomId === 'r2');
    x.result.assignments = x.result.assignments.filter((a) => a.classroomId !== 'r2').concat(mine.map((a, i) => ({ ...a, row: Math.floor((i + 1) / 5) + 1, depth: ((i + 1) % 5) + 1 })).filter((a) => !(a.row === 1 && a.depth === 1)));
    return x;
  };
  it('格數＝排×深位（教室設得比人數大也全畫）；圖例小標籤寫清楚', () => {
    const x = f();
    const p = buildSeatPages(x, 'class').find((q) => q.roomName === '乙教室')!;
    expect(p.rows * p.depth).toBe(20);
    expect(p.usable.has('1-1')).toBe(false); // 停用
    const empty = [...p.usable].filter((k) => !p.cells.has(k));
    expect(empty.length).toBeGreaterThan(0);
    expect(p.chips).toContain('圖例：斜線格＝空位（沒人坐）；斜紋底＝停用座位');
  });
  it('列印頁：空位 pp-em、停用 pp-e，兩種都在；Word：空位是圖片（一條斜線）、停用另一種圖片，兩者不同', async () => {
    const x = f();
    const p = buildSeatPages(x, 'class').find((q) => q.roomName === '乙教室')!;
    const html = renderPrintHtml({ seat: [p] }, meta);
    const nEmpty = [...p.usable].filter((k) => !p.cells.has(k)).length;
    expect((html.match(/class="pp-c pp-em"/g) ?? []).length).toBe(nEmpty);
    expect((html.match(/class="pp-c pp-e"/g) ?? []).length).toBe(20 - p.usable.size);
    const z = await JSZip.loadAsync(await renderDocx({ seat: [p] }, { fonts, ...meta }));
    const media = Object.keys(z.files).filter((n) => /^word\/media\//.test(n));
    expect(media.length).toBeGreaterThanOrEqual(2); // 斜線圖、斜紋圖
  });
  it('每格都有人、沒有停用時不加圖例', () => {
    const p = buildSeatPages(makeFixture(), 'class').find((q) => q.roomName === '乙教室')!;
    expect(p.rows * p.depth - p.usable.size).toBeGreaterThan(0); // 乙教室 20 格、可用 12，本來就有停用
    const x = makeFixture();
    x.settings.classrooms[1] = { ...x.settings.classrooms[1]!, rows: 3, depth: 4, seatCount: 12 };
    x.result.assignments = x.result.assignments.map((a) => (a.classroomId === 'r2' ? { ...a, row: Math.floor((a.depth - 1 + (a.row - 1) * 5) / 4) + 1, depth: ((a.depth - 1 + (a.row - 1) * 5) % 4) + 1 } : a));
    const q = buildSeatPages(x, 'class').find((r) => r.roomName === '乙教室')!;
    expect(q.chips.some((c) => c.startsWith('圖例'))).toBe(false);
  });
});

describe('#648 標籤：沒人坐的座位也印（只有座位編號）；自習生、停用座位不印', () => {
  it('標籤格＝全部可用座位；空位 empty、只有座標；列印頁 pp-el、Word 有座標', async () => {
    const x = makeFixture();
    const room2 = x.settings.classrooms[1]!; // 乙教室：可用 12，12 人
    x.settings.classrooms[1] = { ...room2, seatCount: 15 }; // 多 3 個空位
    const page = buildLabelPages(x, 'class').find((p) => p.roomName === '乙教室')!;
    expect(page.cells).toHaveLength(15);
    const empties = page.cells.filter((c) => c.empty);
    expect(empties).toHaveLength(3);
    for (const c of empties) expect([c.code, c.name, c.classLabel]).toEqual(['', '', '']);
    const html = renderPrintHtml({ label: [page] }, meta);
    expect((html.match(/pp-el/g) ?? []).length).toBe(3);
    for (const c of empties) expect(html).toContain(`<i class="pp-co">${c.coord}</i></div>`);
    const xml = await xmlOf(await renderDocx({ label: [page] }, { fonts, ...meta }));
    for (const c of empties) expect(xml).toContain(c.coord);
  });
  it('自習生（沒有考科）的座位不印、也不算空位：不出空白標籤', () => {
    const x = makeFixture();
    x.entries = x.entries.map((e) => (e.classNo === 2 && e.seatNo <= 3 ? { ...e, subjectIds: [] } : e));
    const labels = buildLabelPages(x, 'class');
    const all = labels.flatMap((p) => p.cells);
    // 沒有考科的人的座位：既不是考生標籤、也不是空位標籤
    const noSubj = new Set(x.result.assignments.filter((a) => ['0201', '0202', '0203'].includes(a.code)).map((a) => `${a.classroomId}:${a.row}-${a.depth}`));
    const page = (id: string) => labels.find((p) => p.roomName === (id === 'r1' ? '甲教室' : '乙教室'))!;
    for (const k of noSubj) {
      const [rid, seat] = k.split(':') as [string, string];
      expect(page(rid).cells.find((c) => c.seat.row + '-' + c.seat.depth === seat)).toBeUndefined();
    }
    expect(all.some((c) => c.empty)).toBe(false); // 甲、乙教室可用座位都有人坐
  });
});

describe('#644 補考座位表改格狀座位圖（O-5）', () => {
  function build(seed = 5): ProduceMakeupInput {
    const classes: FakeClass[] = [{ oldClass: '高一溫', students: 22 }, { oldClass: '高一良', students: 14 }, { oldClass: '801', students: 12 }];
    const roster = fakeRoster({ seed, classes, maxSubjects: 4, notifyOnlyPerClass: 0, notifyExtraRatio: 0 });
    const settings = fakeSettings(roster, [room(40, 'class'), room(40), room(36), room(20, 'special')]);
    const all = runAll(roster, settings);
    return { title: '115 學年第一學期補考', settings, roster, ...all };
  }
  it('每場每考場一頁座位圖：格數＝排×深位，每人一格（舊號、舊班、學號），空位斜線', async () => {
    const input = build();
    const pages = buildSeatTablePages({ title: input.title, settings: input.settings, roster: input.roster, schedule: input.schedule, outputs: input.outputs! });
    expect(pages.length).toBe(input.outputs!.seatTables.length);
    for (const [k, p] of pages.entries()) {
      const t = input.outputs!.seatTables[k]!;
      expect(p.kind).toBe('seat');
      expect(p.cells.size).toBe(t.seats.filter((x) => x.seat).length);
      expect(p.rows * p.depth).toBeGreaterThanOrEqual(p.usable.size);
      for (const x of t.seats) if (x.seat) { const c = p.cells.get(x.seat)!; expect([c.classLabel, c.name, c.code]).toEqual([x.oldClass, x.studentId, String(x.oldSeat).padStart(2, '0')]); }
    }
    const out = await produceMakeupFiles(input, { fonts, generatedAt: '2026-11-18T08:30:00Z', kinds: ['O-5'] });
    expect(out.ok, out.verification.flatMap((v) => v.problems).join('；')).toBe(true);
    const html = produceMakeupPrintHtml(input, 'O-5', { generatedAt: '2026-11-18T08:30:00Z' })!;
    expect(html.verification.problems).toEqual([]);
    expect(html.html).toContain('class="pp-c pp-em"');
    expect(html.html).toContain('講臺');
  });
  it('有人沒座位：座位圖畫不出來，逐人擋下', async () => {
    const input = build();
    const t = input.outputs!.seatTables[0]!;
    const victim = t.seats[0]!;
    const sit = input.schedule.sittings.find((x) => x.studentId === victim.studentId && x.slotId === t.slotId)!;
    const broken = { ...input, schedule: { ...input.schedule, sittings: input.schedule.sittings.map((x) => (x === sit ? { ...x, seat: null } : x)) }, outputs: undefined };
    const out = await produceMakeupFiles(broken, { fonts, generatedAt: '2026-11-18T08:30:00Z', kinds: ['O-5'] });
    expect(out.ok).toBe(false);
    expect(out.verification.flatMap((v) => v.problems).join('；')).toContain('沒有座位');
  });
});

describe('#646 補考考程表（O-2）兩張表：時間地點表（學生）＋監考表（老師）', () => {
  function input(): ProduceMakeupInput {
    const classes: FakeClass[] = [{ oldClass: '高一溫', students: 22 }, { oldClass: '高二溫', students: 15 }, { oldClass: '801', students: 12 }];
    const roster = fakeRoster({ seed: 7, classes, maxSubjects: 5, notifyOnlyPerClass: 0, notifyExtraRatio: 0 });
    const settings = fakeSettings(roster, [room(20, 'special'), room(40), room(40), room(36)]);
    return { title: '115 學年第一學期補考', settings, roster, ...runAll(roster, settings) };
  }
  it('每個考日一頁（2026-11-24 使用者：以一頁為原則）：①補考時間、地點表（欄＝年級組、分高中部／初中部）與②補考監考表（欄＝教室含座位數）放同一頁', () => {
    const i = input();
    const pages = buildTimetablePages({ title: i.title, settings: i.settings, roster: i.roster, schedule: i.schedule, outputs: i.outputs! });
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.title).toBe('補考時間、地點表');
    expect(pages[0]!.second?.title).toBe('補考監考表');
    const t1 = pages[0]!;
    expect(t1.headGroups!.reduce((a, g) => a + g.span, 0)).toBe(t1.heads.length);
    expect(t1.headGroups!.map((g) => g.text)).toEqual(expect.arrayContaining(['高中部']));
    expect(t1.rows[0]![0]).toBe('第一節・時間');
    expect(t1.rows[1]![0]).toBe('第一節・科目');
    expect(t1.rows[2]![0]).toBe('第一節・補考地點');
    const t2 = pages[0]!.second!;
    expect(t2.heads[0]).toBe('監考時段');
    expect(t2.heads.slice(1).every((h) => /（\d+座位）$/.test(h))).toBe(true);
    expect(t2.rows[0]![0]).toBe('監考老師');
    expect(t2.rows[0]!.slice(1).every((c) => c === '')).toBe(true);
  });
  it('回讀：監考表各格「卷別(人數)」加總＝排程人次；Word 與列印頁都一致；離場時間印在注意事項', async () => {
    const i = input();
    const out = await produceMakeupFiles(i, { fonts, generatedAt: '2026-11-18T08:30:00Z', kinds: ['O-2'] });
    expect(out.ok, out.verification.flatMap((v) => v.problems).join('；')).toBe(true);
    expect(out.verification[0]!.actual).toBe(i.entries.length);
    const raw = await readDocxTables(out.files[0]!.docx);
    expect(raw.tables.some((t) => t[0]![0] === '監考時段')).toBe(true);
    const h = produceMakeupPrintHtml(i, 'O-2', { generatedAt: '2026-11-18T08:30:00Z' })!;
    expect(h.verification.problems).toEqual([]);
  });
  it('MAKEUP_DOC_KINDS 仍含 O-2、O-5（下載清單不變）', () => {
    expect(MAKEUP_DOC_KINDS).toEqual(expect.arrayContaining(['O-2', 'O-5']));
  });
});
