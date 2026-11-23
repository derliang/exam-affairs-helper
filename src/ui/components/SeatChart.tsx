/**
 * 座位表（DESIGN 五、六、10.1）：講臺在下方、0101 在左下角；左側只標深位數字，下方標「第N排」；
 * 每格右上角印座標「排-深位」。比容器寬時等比縮小進容器（稿 v2.75，不捲動），頁面不橫向捲動（UI-22）。
 * pull＝抽離考試的預備教室：整張柔和單色、不依班級上色（UI-23）。
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { legendKindsOf, SEAT_KINDS } from '../../core/seatKind';
import type { ChartCell, ChartModel } from '../seating';

/** 稿 v2.75（E）：座位表一律等比縮進容器、不捲動（D154 橫排 ≤8，手機每格約 35px 以上）；下限只防容器量到 0 的退化情況 */
export const MIN_CHART_SCALE = 0.1;

/** 容器寬 avail、圖寬 w：需要時縮小進容器（最小 MIN_CHART_SCALE 只防退化） */
export const chartScale = (avail: number, w: number): number => (avail > 0 && w > avail ? Math.max(MIN_CHART_SCALE, (avail - 2) / w) : 1);

function Cell(p: { c: ChartCell; dim: boolean; onPick?: (code: string, co: string) => void }) {
  const { c } = p;
  if (c.kind !== 'student') return <div class="cell empty-seat" aria-label={c.kind === 'off' ? `${c.co} 沒有座位` : `${c.co} 空位`}><span class="co">{c.kind === 'free' ? c.co : ''}</span></div>;
  const cls = ['cell', c.markKind === 'x' ? 'mk-x' : c.markKind === 'add' ? 'mk-add' : '', p.dim ? 'dim' : ''].filter(Boolean).join(' ');
  const label = `${c.code} ${c.className} ${c.name}，座位 ${c.co}${c.marks.length ? `，${c.marks.join('、')}` : ''}`;
  const act = p.onPick ? { tabIndex: 0, role: 'button' as const, onClick: () => p.onPick!(c.code, c.co), onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onPick!(c.code, c.co); } } } : {};
  return (
    <div class={cls} data-k={c.seatKind === 'general' ? undefined : c.seatKind} aria-label={label} title={p.onPick ? `${label}（點一下做個別覆寫）` : label} {...act}>
      <span class="co">{c.co}</span>
      <span class="no">{c.code}</span>
      <span class="meta"><span class="tg">{c.className}</span>{c.name}</span>
      {c.marks.length > 0 && <span class="mks">{c.marks.map((m) => <span class="mk" key={m}>{m}</span>)}</span>}
    </div>
  );
}

/** 座位表等比縮進容器（稿 v2.75 E）：host＝外框，chart＝圖本身（外框的第一個子元素在 chart 內是 .chart-wrap） */
export function useChartFit(host: { current: HTMLDivElement | null }, chart: { current: HTMLDivElement | null }): void {
  useLayoutEffect(() => {
    const h = host.current;
    const ch = chart.current;
    if (!h || !ch) return;
    const fit = () => {
      ch.style.zoom = '';
      const wrap = ch.firstElementChild as HTMLElement | null;
      if (!wrap) return;
      const z = chartScale(h.clientWidth, wrap.offsetWidth);
      if (z < 1) ch.style.zoom = String(z);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(h);
    return () => ro?.disconnect();
  });
}

export function SeatChart(p: { model: ChartModel; title: string; sub: string; pull?: boolean; onlyClass?: number; onPick?: (code: string, co: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = host.current;
    const ch = chart.current;
    if (!h || !ch) return;
    const fit = () => {
      ch.style.zoom = '';
      const wrap = ch.firstElementChild as HTMLElement | null;
      if (!wrap) return;
      const z = chartScale(h.clientWidth, wrap.offsetWidth);
      if (z < 1) ch.style.zoom = String(z);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(h);
    return () => ro?.disconnect();
  });
  const { model: m } = p;
  const rowsTpl = `repeat(${m.depth},var(--ch))`;
  const colsTpl = `repeat(${m.rows},var(--cw))`;
  return (
    <div class="chartfit" ref={host}>
      <div class={`chart${p.pull ? ' pull' : ''}`} ref={chart}>
        <div class="chart-wrap">
          <div class="chart-title">{p.title}<small>{p.sub}</small></div>
          <div class="axis-y" style={{ gridTemplateRows: rowsTpl }} aria-hidden="true">
            {m.lines.map((_, i) => <span key={i}>{m.depth - i}</span>)}
          </div>
          <div>
            <div class="cg" style={{ gridTemplateColumns: colsTpl }}>
              {m.lines.flatMap((line) => line.map((c) => (
                <Cell key={c.co} c={c} dim={p.onlyClass !== undefined && c.kind === 'student' && c.classNo !== p.onlyClass} onPick={p.onPick} />
              )))}
            </div>
            <div class="axis-x" style={{ gridTemplateColumns: colsTpl, marginTop: '4px' }} aria-hidden="true">
              {Array.from({ length: m.rows }, (_, i) => <span key={i}>第{i + 1}排</span>)}
            </div>
          </div>
          <div class="podium-bar">講　台</div>
          {!p.pull && <KindLegend model={m} />}
        </div>
      </div>
    </div>
  );
}

/** 圖例一項＝小牌＋說明綁在一起（#稿 v2.88：小牌不與說明拆在兩行；手機寬度一項一行） */
function LegendItem(p: { cls: string; mk: string; children: string }) {
  return <span class="lg-i"><span class={`cell ${p.cls}`}><span class="mk">{p.mk}</span></span><span>{p.children}</span></span>;
}

/** 圖例（標示式樣，D39） */
export function ChartLegend(p: { override?: boolean; marks?: boolean }) {
  return (
    <div class="legend">
      <span><b>圖例</b></span>
      {p.marks !== false && <>
        <LegendItem cls="mk-x" mk="X 科目">這位考生不考這一科（該節改到自習地點）</LegendItem>
        <LegendItem cls="mk-add" mk="＋ 科目">這位考生加考這一科，在原教室考</LegendItem>
        <LegendItem cls="mk-add" mk="抽離 科目 考試">這位考生這一科到別的教室考（預備教室）</LegendItem>
        <LegendItem cls="mk-x" mk="X 不參加">這位考生這次不參加，每一節都到自習教室（不印標籤）</LegendItem>
      </>}
      {p.override && <LegendItem cls="mk-add" mk="→地點">個別覆寫（不是換座位）：被標示的那幾節改去該地點</LegendItem>}
      <span class="lg-i"><span class="cell empty-seat" style="width:28px;height:16px" /><span>空位（只在最後）</span></span>
    </div>
  );
}

/** 底色圖例（2026-11-23）：只列這張圖出現過的底色；沒有任何加考底色就不印。白底＝一般考生 */
export function KindLegend(p: { model: ChartModel }) {
  const kinds = legendKindsOf(p.model.lines.flat().flatMap((c) => (c.kind === 'student' ? [c.seatKind] : [])));
  if (!kinds.length) return null;
  return (
    <div class="kind-legend" aria-label="底色圖例">
      <b>底色</b>
      <span class="kl-i"><i class="kl-sw" />一般考生</span>
      {kinds.map((k) => <span class="kl-i" key={k}><i class="kl-sw" data-k={k} />{SEAT_KINDS[k].label}</span>)}
    </div>
  );
}
