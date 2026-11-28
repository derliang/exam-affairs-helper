/**
 * 座位表（DESIGN 五、六、10.1）：講臺在下方、0101 在左下角；左側只標深位數字，下方標「第N排」；
 * 每格右上角印座標「排-深位」。容器 ≥561px 比容器寬時等比縮小進容器（稿 v2.75，不捲動）；容器 ≤560px 改逐排堆疊（SeatStack，D230、稿 v2.111），頁面不橫向捲動（UI-22）。
 * pull＝抽離考試的預備教室：整張柔和單色、不依班級上色（UI-23）。
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Button } from './index';
import { legendKindsOf, SEAT_KINDS, type SeatKind } from '../../core/seatKind';
import type { ChartCell, ChartModel } from '../seating';

/** 稿 v2.75（E）：座位表一律等比縮進容器、不捲動（D154 橫排 ≤8，手機每格約 35px 以上）；下限只防容器量到 0 的退化情況 */
export const MIN_CHART_SCALE = 0.1;

/** 容器寬 avail、圖寬 w：需要時縮小進容器（最小 MIN_CHART_SCALE 只防退化） */
export const chartScale = (avail: number, w: number): number => (avail > 0 && w > avail ? Math.max(MIN_CHART_SCALE, (avail - 2) / w) : 1);

/** D230（#667，稿 v2.111）：容器寬 ≤ 此值改逐排堆疊；≥ 此值 +1 維持等比縮進的現有座位圖 */
export const STACK_MAX_WIDTH = 560;

/** 容器（host）目前是否窄到要改逐排堆疊；沒有 ResizeObserver 的環境（測試）一律當寬 */
export function useNarrow(host: { current: HTMLDivElement | null }): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    const f = () => { const w = h.clientWidth; if (w > 0) setNarrow(w <= STACK_MAX_WIDTH); };
    f();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(f);
    ro?.observe(h);
    return () => ro?.disconnect();
  }, [host]);
  return narrow;
}

/** 逐排堆疊的一格：row＝第 N 排、depth＝深位；kind 'seat' 才有人，'empty'＝空位／停用／沒有這個座位 */
export interface StackCell {
  row: number; depth: number; kind: 'seat' | 'empty';
  /** 4 碼學號（班 2＋座號 2）、班級名、姓名、底色分類（data-k）、標示文字、是否「X」 */
  code?: string; className?: string; name?: string; seatKind?: string; marks?: string[]; x?: boolean; dim?: boolean; locked?: boolean;
  /** 空格的說明（無障礙名稱用） */
  note?: string;
}

/**
 * 逐排堆疊座位圖（D230、稿 v2.111）：一排一列、深位一欄（深位 1 靠講臺在左），格內只印 2 碼座號，
 * 點一格在下方資料卡看班級、座號、姓名與標示；action 放在資料卡上的操作（個別覆寫、鎖定）。字級 ≥12px，不橫向捲動。
 */
export function SeatStack(p: { title: string; sub: string; rows: number; depth: number; cells: StackCell[]; legend?: ComponentChildren; action?: (c: StackCell) => ComponentChildren }) {
  const [sel, setSel] = useState<string | null>(null);
  const at = new Map(p.cells.map((c) => [`${c.row}-${c.depth}`, c]));
  const picked = sel ? at.get(sel) : undefined;
  const style = { '--d': p.depth } as preact.JSX.CSSProperties;
  return (
    <div class="sq">
      <div class="sq-in">
        <div class="sq-title">{p.title}<small>{p.sub}</small></div>
        <div class="sq-podium">講　台</div>
        <div class="sq-axis" style={style} aria-hidden="true"><span class="sq-lab">深位→</span>{Array.from({ length: p.depth }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
        <div class="sq-grid">
          {Array.from({ length: p.rows }, (_, ri) => (
            <div class="sq-row" style={style} key={ri}>
              <div class="sq-rowlab">第{ri + 1}排</div>
              {Array.from({ length: p.depth }, (_, di) => {
                const key = `${ri + 1}-${di + 1}`;
                const c = at.get(key);
                if (!c || c.kind !== 'seat') return <div key={key} class="sq-c empty" aria-label={`第${ri + 1}排深位${di + 1}　${c?.note ?? '沒有座位'}`} />;
                const cls = ['sq-c', c.x ? 'x' : '', c.dim ? 'dim' : '', c.locked ? 'lk' : '', sel === key ? 'sel' : ''].filter(Boolean).join(' ');
                const label = `第${ri + 1}排深位${di + 1}，${c.className ?? ''} 座號 ${(c.code ?? '').slice(2)} ${c.name ?? ''}${c.marks?.length ? `，${c.marks.join('、')}` : ''}${c.locked ? '，已鎖定' : ''}`;
                return <button key={key} type="button" class={cls} data-k={c.seatKind} aria-pressed={sel === key} aria-label={label} onClick={() => setSel(sel === key ? null : key)}>{(c.code ?? '').slice(2)}</button>;
              })}
            </div>
          ))}
        </div>
        <div class="sq-pick" aria-live="polite">
          {picked
            ? <><b>第{picked.row}排－深位{picked.depth}</b><br />{picked.className} 座號 {(picked.code ?? '').slice(2)}・{picked.name}{picked.marks?.length ? <><br />標示：{picked.marks.join('、')}</> : null}{p.action ? <div style="margin-top:6px">{p.action(picked)}</div> : null}</>
            : '點一格看詳細資料'}
        </div>
        {p.legend}
      </div>
    </div>
  );
}

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
  const narrow = useNarrow(host);
  const { model: m } = p;
  if (narrow) {
    const cells: StackCell[] = m.lines.flatMap((line, i) => line.map((c, j): StackCell => {
      const base = { row: j + 1, depth: m.depth - i };
      if (c.kind !== 'student') return { ...base, kind: 'empty', note: c.kind === 'off' ? '沒有座位' : '空位' };
      return { ...base, kind: 'seat', code: c.code, className: c.className, name: c.name, seatKind: c.seatKind === 'general' ? undefined : c.seatKind, marks: c.marks, x: c.markKind === 'x', dim: p.onlyClass !== undefined && c.classNo !== p.onlyClass };
    }));
    const pick = p.onPick;
    return (
      <div class="chartfit" ref={host}>
        <SeatStack title={p.title} sub={p.sub} rows={m.rows} depth={m.depth} cells={cells} legend={p.pull ? undefined : <KindLegend model={m} />}
          action={pick ? (c) => <Button small onClick={() => pick(c.code ?? '', `${c.row}-${c.depth}`)}>個別覆寫這位的座位標示</Button> : undefined} />
      </div>
    );
  }
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
  return <KindLegendOf kinds={p.model.lines.flat().flatMap((c) => (c.kind === 'student' ? [c.seatKind] : []))} />;
}

/** 圖例本體：kinds＝圖上出現過的分類；labels 可換成分科的說法 */
export function KindLegendOf(p: { kinds: Iterable<SeatKind>; labels?: Partial<Record<SeatKind, string>> }) {
  const kinds = legendKindsOf(p.kinds);
  if (!kinds.length) return null;
  return (
    <div class="kind-legend" aria-label="底色圖例">
      <b>底色</b>
      <span class="kl-i"><i class="kl-sw" />一般考生</span>
      {kinds.map((k) => <span class="kl-i" key={k}><i class="kl-sw" data-k={k} />{p.labels?.[k] ?? SEAT_KINDS[k].label}</span>)}
    </div>
  );
}
