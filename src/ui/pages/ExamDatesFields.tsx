/**
 * 考試日期兩欄（#389、D164 H）：第 1 天、第 2 天（選填）。星期由日期算出、顯示在欄位旁；用在座位表頁首與各時段說明，標籤不加。
 * 新增考試頁與「修改基本資料」共用，全站只有這一種畫法。
 */
import { weekdayOf, isRealDate } from '../examDates';

/** 把兩個欄位的值收成存檔用的陣列：只存填了的；中間空著的天留空字串，尾端空的去掉；全空回 undefined */
export function packDates(day1: string, day2: string): string[] | undefined {
  const a = [day1.trim(), day2.trim()];
  while (a.length && !a[a.length - 1]) a.pop();
  return a.length ? a : undefined;
}

export function ExamDatesFields(p: { day1: string; day2: string; onChange: (day1: string, day2: string) => void }) {
  const one = (id: string, label: string, v: string, set: (x: string) => void) => (
    <div class="field"><label for={id}>{label}</label>
      <input id={id} class="input" type="date" value={v} onInput={(e) => set(e.currentTarget.value)} />
      <span class="hint">{isRealDate(v) ? `星期${weekdayOf(v)}` : '選填'}</span></div>
  );
  return (
    <>
      {one('exam-day1', '考試日期　第 1 天', p.day1, (x) => p.onChange(x, p.day2))}
      {one('exam-day2', '考試日期　第 2 天', p.day2, (x) => p.onChange(p.day1, x))}
    </>
  );
}
