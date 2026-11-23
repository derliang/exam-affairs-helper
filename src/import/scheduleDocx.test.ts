import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { PeriodTable } from '../data';
import { slotTimes } from '../core/examTimes';
import { applySchedule, parseScheduleDocx, pickYear } from './scheduleDocx';

/** 依學校「時間科目表」格式組一份合成 docx（全部虛構）：每個時段成對「時間」「科目」兩列，自習列只有一段時間 */
const tc = (...lines: string[]): string => `<w:tc>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:tc>`;
const tr = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
async function docx(header: string[], pairs: { times: string[][]; subjects: string[] }[]): Promise<Uint8Array> {
  const rows = [tr(tc('日期'), ...header.map((h) => tc(h)))];
  pairs.forEach((p, i) => {
    rows.push(tr(tc(i === 0 ? '上午' : ''), tc('時間'), ...p.times.map((t) => tc(...t))));
    rows.push(tr(tc(''), tc('科目'), ...p.subjects.map((s) => tc(s))));
  });
  rows.push(tr(tc('備註'), tc('1.考試開始後不得入場')));
  const z = new JSZip();
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:tbl>${rows.join('')}</w:tbl></w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
}
const exam = (a: string, b: string, min: number): string[] => [`${a} 發卷(5分鐘)`, '※發卷完，請先讓同學入場準備※', `${b} (${min}分鐘)`];

const TABLE: PeriodTable = {
  days: [
    [{ name: '英文', minutes: 100 }, { name: '自然', minutes: 110 }],
    [{ name: '數學', minutes: 100 }, { name: '社會', minutes: 110 }],
  ],
};

describe('匯入考程表 docx', () => {
  it('讀出日期與考試時段；自習、休息列不算；備註略過', async () => {
    const b = await docx(['10月28日(星期三)', '10月29日(星期四)'], [
      { times: [exam('8:00-8:05', '8:05-9:45', 100), exam('8:00-8:05', '8:05-9:45', 100)], subjects: ['英文', '數學Ａ'] },
      { times: [['9:45-9:55'], ['9:45-9:55']], subjects: ['休息', '休息'] },
      { times: [exam('9:55-10:00', '10:00-11:50', 110), exam('9:55-10:00', '10:00-11:50', 110)], subjects: ['自然', '社會'] },
    ]);
    const p = await parseScheduleDocx(b);
    expect(p.days.map((d) => d.header)).toEqual(['10月28日(星期三)', '10月29日(星期四)']);
    expect(p.days[0]!.slots).toEqual([
      { subject: '英文', start: '08:05', end: '09:45', minutes: 100 },
      { subject: '自然', start: '10:00', end: '11:50', minutes: 110 },
    ]);
    expect(p.days[1]!.slots.map((s) => s.subject)).toEqual(['數學Ａ', '社會']);
  });
  it('「測驗70分鐘」寫法、沒有日期的表頭也讀得到', async () => {
    const b = await docx(['', ''], [{ times: [['8:25-8:35 發卷與說明', '8:35-9:45 測驗70分鐘'], ['8:25-8:35 發卷與說明', '8:35-9:45 測驗70分鐘']], subjects: ['社會', '自然'] }]);
    const p = await parseScheduleDocx(b);
    expect(p.days[0]!.slots[0]).toMatchObject({ subject: '社會', start: '08:35', end: '09:45', minutes: 70 });
    expect(p.days[0]!.month).toBeUndefined();
  });
  it('不是考程表就說清楚', async () => {
    const z = new JSZip();
    z.file('word/document.xml', '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>');
    await expect(parseScheduleDocx(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow('找不到考程表');
    await expect(parseScheduleDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
  it('年份用星期推：10/28 是星期三的那年', () => {
    const d = [{ header: '', month: 10, day: 28, weekday: '三', slots: [] }];
    expect(pickYear(d, [2026, 2025, 2027])).toBe(2026);
    expect(pickYear([{ header: '', month: 7, day: 29, weekday: '三', slots: [] }], [2026, 2027, 2025])).toBe(2026);
    expect(pickYear([{ header: '', month: 7, day: 29, slots: [] }], [2026, 2025])).toBe(2026); // 沒星期用第一個候選
  });
  it('套進節次表：日期、每天第一節、接不上的標手動；時長不同、天數不同要提醒', async () => {
    const b = await docx(['10月28日(星期三)', '10月29日(星期四)'], [
      { times: [exam('8:00-8:05', '8:05-9:45', 100), exam('8:00-8:05', '8:05-9:45', 100)], subjects: ['英文', '數學'] },
      { times: [exam('9:55-10:00', '10:00-11:50', 110), exam('9:55-10:00', '10:00-11:40', 100)], subjects: ['自然', '社會'] },
    ]);
    const r = applySchedule(await parseScheduleDocx(b), TABLE, [2026, 2025, 2027]);
    expect(r.examDates).toEqual(['2026-10-28', '2026-10-29']);
    const st = slotTimes(TABLE, r.dayTimes);
    expect(st.find((t) => t.day === 0 && t.slot === 1)!.start).toBe('08:05');
    expect(st.find((t) => t.day === 0 && t.slot === 2)!.start).toBe('10:00'); // 9:45 結束＋休息 15 分不等於預設 10 分，所以標手動
    expect(st.find((t) => t.day === 1 && t.slot === 2)!.start).toBe('10:00');
    expect(r.dayTimes![0]!.manual).toEqual({ '2': '10:00' });
    expect(r.notes.join('')).toContain('社會：考程表 100 分，節次表 110 分');
    expect(r.lines[0]).toContain('第 1 天　10/28：英文 08:05、自然 10:00');
  });
  it('文組、理組同一天兩欄：只取第一欄並說明；考程表比節次表多一天：多的不套用', async () => {
    const b = await docx(['04月09日(星期四)文組', '04月09日(星期四)理組', '04月10日(星期五)'], [
      { times: [exam('8:10-8:20', '8:20-9:40', 80), exam('8:10-8:20', '8:20-9:40', 80), exam('8:10-8:20', '8:20-9:40', 80)], subjects: ['歷史', '物理', '英文'] },
    ]);
    const one: PeriodTable = { days: [[{ name: '歷史', minutes: 80 }]] };
    const r = applySchedule(await parseScheduleDocx(b), one, [2026]);
    expect(r.examDates).toEqual(['2026-04-09']);
    expect(r.notes.join('')).toContain('有多欄');
    expect(r.notes.join('')).toContain('只有 1 天');
  });
  it('表裡沒有日期就不動考試日期', async () => {
    const b = await docx(['', ''], [{ times: [exam('8:00-8:05', '8:05-9:45', 100), exam('8:00-8:05', '8:05-9:45', 100)], subjects: ['英文', '數學'] }]);
    const r = applySchedule(await parseScheduleDocx(b), TABLE, [2026]);
    expect(r.examDates).toBeUndefined();
    expect(r.dayTimes).toBeDefined();
  });
});
