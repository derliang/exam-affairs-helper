/**
 * 標籤「範例」的版面模型（G26、G28）：全部假資料，但丟給真正的標籤渲染程式（htmlRender.labelHtml）畫，
 * 所以輸出的版式、格子尺寸一改，範例就跟著改，不再手寫一份靜態畫面。
 */
import type { LabelPaper } from '../data';
import { defaultLabelLayout, PREP_TAG, type CellModel, type LabelPageModel, type PersonModel } from './model';
import { renderPrintHtml } from './htmlRender';

const base = (seat: { row: number; depth: number }, coord: string): CellModel => ({
  coord, seat, code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
});

/** 預備教室合併標籤範例（G26）：3 張——一人單節、同一人跨節坐同一格、兩人共用同一格 */
export function sampleReserveLabelPage(paper: LabelPaper): LabelPageModel {
  const p = (code: string, classLabel: string, name: string, sched: string[]): PersonModel => ({ code, classLabel, name, sched, schedShort: sched.map((s) => s.replace(/^.*? /, '')) });
  const persons: PersonModel[][] = [
    [p('0107', '勤', '甲生07', ['第2天 歷史'])],
    [p('0212', '勇', '乙生12', ['第1天 物理', '第2天 數乙'])],
    [p('0303', '誠', '丙生03', ['第1天 化學']), p('0421', '勤', '丁生21', ['第2天 地理'])],
  ];
  return {
    kind: 'label', title: '範例', examName: '範例模擬考', roomName: '備一　抽離考試', tag: PREP_TAG,
    layout: defaultLabelLayout(paper), notes: [], grid: { cols: 3, rows: 1 },
    cells: persons.map((ps, i) => ({ ...base({ row: i + 1, depth: 1 }, `${i + 1}-1`), persons: ps })),
  };
}

/** 範例教室的排數、深位數（G28：5 排×6 深位＝30 格，不是 49 格） */
export const SAMPLE_ROOM = { rows: 5, depth: 6 };

/** 標示範例（G28）：假教室 5 排×6 深位，左上角（第 1 排最後深位）那格帶標示 */
export function sampleMarkLabelPage(paper: LabelPaper, mark?: { kind: 'x' | 'add'; text: string }): LabelPageModel {
  const cells: CellModel[] = [];
  for (let r = 1; r <= SAMPLE_ROOM.rows; r++) {
    for (let d = 1; d <= SAMPLE_ROOM.depth; d++) {
      const n = (r - 1) * SAMPLE_ROOM.depth + d;
      const special = r === 1 && d === SAMPLE_ROOM.depth && mark;
      cells.push({
        ...base({ row: r, depth: d }, `${r}-${d}`),
        code: `01${String(n).padStart(2, '0')}`, classLabel: '勤', name: `甲生${String(n).padStart(2, '0')}`,
        ...(special ? { corners: [{ kind: mark.kind, text: mark.text }] } : {}),
      });
    }
  }
  return {
    kind: 'label', title: '範例', examName: '範例模擬考', roomName: '甲班教室',
    layout: defaultLabelLayout(paper), notes: [], grid: { cols: SAMPLE_ROOM.rows, rows: SAMPLE_ROOM.depth }, cells,
  };
}

/** 範例的 HTML：直接呼叫真正的渲染器（預覽元件與測試共用，確保範例＝實際輸出） */
export function sampleHtml(page: LabelPageModel, extraCss = ''): string {
  return renderPrintHtml({ label: [page] }, { generatedAt: '2026-01-01T00:00:00+08:00', dataVersion: 'SAMPLE', extraCss });
}
