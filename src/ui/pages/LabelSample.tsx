import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabelPaper } from '../../data';
import { labelCellMm, defaultLabelLayout, PAPER_MM } from '../../export/model';
import { sampleHtml, sampleMarkLabelPage, sampleReserveLabelPage, SAMPLE_ROOM } from '../../export/sample';

const PX = 96 / 25.4; // 1 mm ≈ 3.78 px

/** 範例用的格尺寸（mm）：與實際輸出同一來源（labelCellMm）；rows＝該教室深位數，noteLines＝注意事項行數（範例頁不印注意事項＝0） */
export const sampleCellMm = (paper: LabelPaper, rows: number, noteLines = 0): { w: number; h: number } => labelCellMm(defaultLabelLayout(paper), rows, noteLines);

/** 範例框一律不出現捲動軸（#408）：框內頁面隱藏捲軸，框的尺寸再由呼叫端決定（固定縮圖）或量內容（AutoFrame） */
const NOSCROLL = 'html,body{overflow:hidden!important}';
const frame = (html: string, w: number, h: number, title: string) => (
  <iframe class="lsample" title={title} sandbox="" scrolling="no" srcdoc={html} style={`width:${Math.ceil(w)}px;height:${Math.ceil(h)}px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff;display:block;max-width:100%`} />
);

/**
 * 高度由內容量出來的範例框（#408、D147）：不是手算。sandbox 只開 allow-same-origin（不開 script，頁面碼跑不了），
 * 載入後讀內容高度設給框；容器比框窄時整框等比例縮小（zoom），不裁切、不出捲動軸。
 */
function AutoFrame(p: { html: string; w: number; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  const [z, setZ] = useState(1);
  const measure = (el: HTMLIFrameElement | null) => {
    const d = el?.contentDocument;
    // 內容頁用了 CSS zoom：scrollHeight 是沒縮放的值，要用實際版面（最後一頁底緣）才對
    const sheet = d?.querySelector('.sheet');
    if (sheet) setH(Math.ceil(sheet.getBoundingClientRect().bottom) + 2);
  };
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => setZ(el.clientWidth > 0 && p.w > el.clientWidth ? Math.max(0.3, (el.clientWidth - 2) / p.w) : 1);
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [p.w]);
  return (
    <div ref={host} style="width:100%">
      <iframe
        class="lsample"
        title={p.title}
        sandbox="allow-same-origin"
        scrolling="no"
        srcdoc={p.html}
        onLoad={(e) => measure(e.currentTarget as HTMLIFrameElement)}
        style={`width:${Math.ceil(p.w)}px;height:${h ?? 120}px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff;display:block;overflow:hidden;zoom:${z}`}
      />
    </div>
  );
}

/** G26：預備教室合併標籤範例（3 張，跟著標籤預設紙張），用真正的標籤渲染程式畫 */
export function ReserveLabelSample(p: { paper: LabelPaper }) {
  const zoom = p.paper === 'A3' ? 0.5 : 0.55;
  const html = useMemo(() => sampleHtml(sampleReserveLabelPage(p.paper), `html{zoom:${zoom}}body{margin:0;background:#fff}${NOSCROLL}.sheet{height:auto!important;break-after:auto!important;padding-bottom:3mm!important}.pp-foot{display:none!important}`), [p.paper]);
  const w = PAPER_MM[p.paper].w * PX * zoom;
  return <AutoFrame html={html} w={w} title="預備教室合併標籤範例" />;
}

/** G28：整頁縮圖（5 排×6 深位假教室）＋放大的一格，皆為真正渲染結果 */
export function MarkLabelSample(p: { paper: LabelPaper; mark?: { kind: 'x' | 'add'; text: string } }) {
  const page = useMemo(() => sampleMarkLabelPage(p.paper, p.mark), [p.paper, p.mark]);
  const cell = sampleCellMm(p.paper, SAMPLE_ROOM.depth);
  const paper = PAPER_MM[p.paper];
  const thumbZoom = 0.2;
  const thumb = useMemo(() => sampleHtml(page, `html{zoom:${thumbZoom}}body{margin:0;background:#fff}${NOSCROLL}`), [page]);
  const bigZoom = 0.95;
  // 放大一格：隱藏抬頭與頁尾，格子從頁面左上（上邊界 3mm）開始
  const big = useMemo(() => sampleHtml(page, `html{zoom:${bigZoom}}body{margin:0;background:#fff}${NOSCROLL}.pp-hd,.pp-foot,.pp-note{display:none!important}.sheet{margin-top:-3mm!important}`), [page]);
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
