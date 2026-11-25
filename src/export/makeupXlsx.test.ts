/**
 * O-4 補考點名單 Excel 版（D227）：全部假資料。
 * 重點：回讀自己的 .xlsx 與排程一致（人次、各卷、版本碼、頁尾總人次、離場時間）；版式照學校範例（表頭三列、六欄兩組、無卷數欄）；
 * 刻意弄壞一定被抓到。
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { fakeRoster, fakeSettings, room, runAll, type FakeClass } from '../core/makeup/fixtures';
import { produceMakeupRollCallXlsx, type ProduceMakeupInput } from './makeupFiles';
import { readXlsxTables, summarizeTables } from './makeupReadback';
import { ROLL_HEAD6, ROLL_XLSX, renderRollCallXlsx } from './makeupXlsx';

const generatedAt = '2026-11-25T02:00:00Z';

function build(seed: number, big = false, twoDays = false): ProduceMakeupInput {
  const classes: FakeClass[] = big
    ? [{ oldClass: '高一溫', students: 45 }, { oldClass: '高一良', students: 45 }, { oldClass: '高二溫', students: 40 }]
    : [{ oldClass: '高一溫', students: 22 }, { oldClass: '高一良', students: 18 }, { oldClass: '高二溫', students: 15 }, { oldClass: '801', students: 12 }, ...(twoDays ? [{ oldClass: '高三溫', students: 9 }] : [])];
  const roster = fakeRoster({ seed, classes, maxSubjects: 5, notifyOnlyPerClass: 1, notifyExtraRatio: 0.2 });
  const rooms = big ? [room(120), room(120), room(40)] : [room(20, 'special'), room(40, 'mixed'), room(40), room(40), room(36)];
  const settings = fakeSettings(roster, rooms);
  if (twoDays) {
    settings.days.push({ id: 'D0', label: '1/16（六）' });
    settings.groups = settings.groups.map((g) => (g.grades.includes('S3') ? { ...g, grades: g.grades.filter((x) => x !== 'S3') } : g)).filter((g) => g.grades.length);
    settings.groups.push({ id: 'D0-S3', dayId: 'D0', label: '高三', grades: ['S3'], start: 480, periodMin: 50, breakMin: 10 });
  }
  return { title: '115 學年第一學期補考', settings, roster, ...runAll(roster, settings) };
}

describe('O-4 點名單 Excel 版：產生後回讀，與排程一致', () => {
  for (const seed of [3, 7, 11, 19]) {
    it(`種子 ${seed}：人次、各卷、版本碼、頁尾總人次都對`, async () => {
      const input = build(seed);
      const r = (await produceMakeupRollCallXlsx(input, { generatedAt }))!;
      expect(r.name).toBe('補考-O-4 點名單.xlsx');
      expect(r.verification.problems).toEqual([]);
      expect(r.verification.actual).toBe(input.entries.length);
    });
  }

  it('一個考場超過 60 人：分成幾個區塊、表頭重印，仍對得起來', async () => {
    const input = build(5);
    const outputs = structuredClone(input.outputs!);
    const one = outputs.rollCalls[0]!;
    const proto = one.rows[0]!;
    one.rows = Array.from({ length: 70 }, (_, k) => ({ ...proto, studentId: `9${String(k).padStart(5, '0')}`, oldSeat: k + 1, subjects: [proto.subjects[0]!], papers: [proto.papers[0]!], paperCount: 1 }));
    one.paperTotals = { [proto.papers[0]!]: 70 };
    outputs.rollCalls = [one];
    const xlsx = await renderRollCallXlsx({ title: input.title, settings: input.settings, roster: input.roster, schedule: input.schedule, outputs }, { generatedAt, dataVersion: 'MKX　總人次 70' });
    const raw = await readXlsxTables(xlsx);
    expect(raw.tables).toHaveLength(2);
    for (const t of raw.tables) expect(t.length - 4).toBeLessThanOrEqual(ROLL_XLSX.rowsPerGroup);
    const d = summarizeTables('x.xlsx', 'O-4', raw, input.roster.gradeOfClass);
    expect(d.problems).toEqual([]);
    expect(d.total).toBe(70);
    expect(d.footerTotal).toBe(70);
    expect(d.version).toBe('MKX');
  });

  it('依考日下載：檔名帶日期，各自對得起來', async () => {
    const input = build(5, false, true);
    for (const d of input.settings.days) {
      const r = await produceMakeupRollCallXlsx(input, { generatedAt, dayId: d.id });
      if (!r) continue;
      expect(r.name).toMatch(/^補考-O-4 點名單-.+\.xlsx$/);
      expect(r.verification.problems).toEqual([]);
    }
  });

  it('版式照學校範例：工作表「點名單」、表頭三列、六欄兩組、沒有卷數欄與統計列、A4 直式', async () => {
    const input = build(7);
    const r = (await produceMakeupRollCallXlsx(input, { generatedAt }))!;
    const z = await JSZip.loadAsync(r.xlsx);
    expect(await z.file('xl/workbook.xml')!.async('string')).toContain('name="點名單"');
    const xml = await z.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('paperSize="9" orientation="portrait"');
    const raw = await readXlsxTables(r.xlsx);
    const t = raw.tables[0]!;
    expect(t[0]![0]).toBe('監考老師：');
    expect(t[0]![5]).toBe('科目，人數');
    expect(t[1]![0]).toBe('監考地點：');
    expect(t[2]![0]).toBe('時段：');
    expect(t[2]![5]).toBe('注意事項：');
    expect(t[3]).toEqual([...ROLL_HEAD6, ...ROLL_HEAD6]);
    expect(raw.text).not.toContain('卷數');
    expect(raw.text).not.toContain('統計');
    expect(t[1]![7]).toMatch(/^\d+人$/);
    // 樣式由設計員定案（DESIGN §10.66）：字型、欄寬
    expect(await z.file('xl/styles.xml')!.async('string')).toContain(ROLL_XLSX.font);
    expect(xml).toContain(`width="${ROLL_XLSX.widths[0]}"`);
  });

  it('提前開考的「HH:MM 前不得離場」寫在註欄並回讀得到', async () => {
    for (const seed of [3, 7, 11, 19, 23]) {
      const input = build(seed);
      if (input.schedule.early.length === 0) continue;
      const r = (await produceMakeupRollCallXlsx(input, { generatedAt }))!;
      const d = summarizeTables(r.name, 'O-4', await readXlsxTables(r.xlsx), input.roster.gradeOfClass);
      expect(d.leaveTimes.length).toBeGreaterThan(0);
      return;
    }
    throw new Error('假資料沒有提前開考，換種子');
  });

  it('刻意弄壞（少印一人）一定被抓到', async () => {
    const input = build(11);
    const outputs = structuredClone(input.outputs!);
    const sheet = outputs.rollCalls.find((x) => x.rows.length > 1)!;
    sheet.rows.pop();
    const xlsx = await renderRollCallXlsx({ title: input.title, settings: input.settings, roster: input.roster, schedule: input.schedule, outputs }, { generatedAt, dataVersion: 'MKX　總人次 1' });
    const d = summarizeTables('x.xlsx', 'O-4', await readXlsxTables(xlsx), input.roster.gradeOfClass);
    expect(d.problems.join('；')).toMatch(/表頭/);
    expect(d.total).toBeLessThan(input.entries.length);
  });
});
