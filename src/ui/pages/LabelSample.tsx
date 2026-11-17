import { useMemo } from 'preact/hooks';
import type { LabelPaper } from '../../data';
import { labelCellMm, defaultLabelLayout, PAPER_MM } from '../../export/model';
import { sampleHtml, sampleMarkLabelPage, sampleReserveLabelPage, SAMPLE_ROOM } from '../../export/sample';

const PX = 96 / 25.4; // 1 mm ≈ 3.78 px

/** 範例用的格尺寸（mm）：與實際輸出同一來源（labelCellMm）；rows＝該教室深位數 */
export const sampleCellMm = (paper: LabelPaper, rows: number): { w: number; h: number } => labelCellMm(defaultLabelLayout(paper), rows);

const frame = (html: string, w: number, h: number, title: string) => (
  <iframe class="lsample" title={title} sandbox="" srcdoc={html} style={`width:${Math.ceil(w)}px;height:${Math.ceil(h)}px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff;display:block;max-width:100%`} />
);

/** G26：預備教室合併標籤範例（3 張，跟著標籤預設紙張），用真正的標籤渲染程式畫 */
export function ReserveLabelSample(p: { paper: LabelPaper }) {
  const zoom = p.paper === 'A3' ? 0.5 : 0.55;
  const html = useMemo(() => sampleHtml(sampleReserveLabelPage(p.paper), `html{zoom:${zoom}}body{margin:0;background:#fff}.sheet{height:auto!important;break-after:auto!important;padding-bottom:3mm!important}.pp-foot{display:none!important}`), [p.paper]);
  const cell = sampleCellMm(p.paper, 1);
  const w = PAPER_MM[p.paper].w * PX * zoom;
  const h = (3 + 16 + cell.h + 4) * PX * zoom;
  return frame(html, w, h, '預備教室合併標籤範例');
}

/** G28：整頁縮圖（5 排×6 深位假教室）＋放大的一格，皆為真正渲染結果 */
export function MarkLabelSample(p: { paper: LabelPaper; mark?: { kind: 'x' | 'add'; text: string } }) {
  const page = useMemo(() => sampleMarkLabelPage(p.paper, p.mark), [p.paper, p.mark]);
  const cell = sampleCellMm(p.paper, SAMPLE_ROOM.depth);
  const paper = PAPER_MM[p.paper];
  const thumbZoom = 0.2;
  const thumb = useMemo(() => sampleHtml(page, `html{zoom:${thumbZoom}}body{margin:0;background:#fff}`), [page]);
  const bigZoom = 0.95;
  // 放大一格：隱藏抬頭與頁尾，格子從頁面左上（上邊界 3mm）開始
  const big = useMemo(() => sampleHtml(page, `html{zoom:${bigZoom}}body{margin:0;background:#fff}.pp-hd,.pp-foot,.pp-note{display:none!important}.sheet{margin-top:-3mm!important}`), [page]);
  return (
    <div class="lprev">
      <figure>
        <div style={`width:${Math.ceil(cell.w * PX * bigZoom)}px;height:${Math.ceil(cell.h * PX * bigZoom)}px;overflow:hidden`}>
          {frame(big, paper.w * PX * bigZoom, paper.h * PX * bigZoom, `${p.paper} 標籤放大一格`)}
        </div>
        <figcaption><b>{p.paper}</b>　每格 {cell.w.toFixed(1)}×{cell.h.toFixed(1)} mm</figcaption>
      </figure>
      <figure>
        {frame(thumb, paper.w * PX * thumbZoom, paper.h * PX * thumbZoom, `${p.paper} 整頁縮圖`)}
        <figcaption>整頁縮圖：{SAMPLE_ROOM.rows} 排×{SAMPLE_ROOM.depth} 深位＝{SAMPLE_ROOM.rows * SAMPLE_ROOM.depth} 格</figcaption>
      </figure>
    </div>
  );
}
