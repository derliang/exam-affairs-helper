/**
 * ⑥ 下載頁的「考前對帳」面板（G35，稿 v2.47、DESIGN 10.25）：燈號列、應有／實有／差異、明細展開（公式預設收起）、
 * 總帳表（名單範圍）、逐項確認警示彈窗。學測、分科、會考共用；補考日後沿用同一組元件。
 * 燈號不只靠顏色：✓ 通過、▲ 警示、✕ 不通過、– 不適用，每個燈號旁都有文字。
 */
import { useState } from 'preact/hooks';
import { Alert, Button, EmptyState, Modal } from '../components';
import { LIGHT_ICON, LIGHT_TEXT, type Check, type Gate, type Reconcile } from '../reconcile';
import type { ExportFormat } from '../../export/plan';

const STEP_NAME: Record<2 | 3 | 5, string> = { 2: '② 考試名單', 3: '③ 教室設定', 5: '⑤ 排座與預覽' };
const LABELS: Record<'tri' | 'cap', [string, string, string]> = { tri: ['應有', '實有', '差異'], cap: ['上限', '使用', '餘額'] };

const Lamp = (p: { light: Check['light'] }) => <span class={`rc-lamp rc-${p.light}`}><span aria-hidden="true">{LIGHT_ICON[p.light]}</span> {LIGHT_TEXT[p.light]}</span>;

function CheckRow(p: { c: Check; onGo: (n: 2 | 3 | 5) => void }) {
  const { c } = p;
  // 紅、琥珀列預設展開；通過與不適用預設收起
  const [open, setOpen] = useState(c.light === 'fail' || c.light === 'warn');
  const [x, y, z] = LABELS[c.cap ? 'cap' : 'tri'];
  return (
    <div class={`rc-row rc-row-${c.light}`} data-check={c.id} data-light={c.light}>
      <div class="rc-name"><b>{c.id}</b>　{c.title}<Lamp light={c.light} /></div>
      {c.light === 'na'
        ? <div class="rc-val small muted">{c.summary}</div>
        : (
          <div class="rc-val">
            <div class="rc-tri">
              <div><span class="small muted">{x}</span><b>{c.a}</b></div>
              <div><span class="small muted">{y}</span><b>{c.b}</b></div>
              <div><span class="small muted">{z}</span><b>{c.d}</b></div>
            </div>
            <div class="small">{c.summary}</div>
          </div>
        )}
      {c.light !== 'na' && <button type="button" class="rc-more" aria-expanded={open} onClick={() => setOpen(!open)}>明細 {open ? '▴' : '▾'}</button>}
      {open && c.light !== 'na' && (
        <div class="rc-detail">
          {c.issues.map((i) => (
            <div key={i.text} class="rc-issue">
              <span>{i.text}</span>
              {i.step && <Button small onClick={() => p.onGo(i.step!)}>到 {STEP_NAME[i.step]} ›</Button>}
            </div>
          ))}
          <div class="small muted">檢核公式：{c.formula}</div>
        </div>
      )}
    </div>
  );
}

export function ReconcilePanel(p: {
  r: Reconcile;
  gate: Gate;
  /** 目前資料下警示已逐項確認 */
  acked: boolean;
  at: string;
  onRecheck: () => void;
  onGo: (n: 2 | 3 | 5) => void;
  /** 彈窗「確認並下載」：記下確認並依格式下載 */
  onConfirmDownload: (fingerprint: string, fmt: ExportFormat) => void;
  busy?: boolean;
}) {
  const { r, gate } = p;
  const [dlg, setDlg] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  if (r.state !== 'ready') {
    return (
      <div class="card stack" data-reconcile="empty">
        <div class="row sb"><h3>考前對帳</h3><Button small onClick={p.onRecheck}>↻ 重新對帳</Button></div>
        {r.state === 'no-roster'
          ? <EmptyState title="還沒有名單，無法對帳" action={<Button small kind="primary" onClick={() => p.onGo(2)}>去 ② 考試名單</Button>}>名冊或考試名單還沒匯入，沒有名單範圍可以對。</EmptyState>
          : <EmptyState title="還沒有排座結果" action={<Button small kind="primary" onClick={() => p.onGo(5)}>去 ⑤ 排座與預覽</Button>}>排座完成後，這裡會從座位表與標籤重新點人，核對每個時段的帳。</EmptyState>}
      </div>
    );
  }
  const worst = gate.fails > 0 ? 'fail' : gate.warns.length > 0 ? 'warn' : 'pass';
  const head = worst === 'fail' ? `${gate.fails} 項不通過，須先修正` : worst === 'warn' ? `${gate.warns.length} 項警示，須逐項確認` : '全部通過';
  const allTicked = gate.warns.length > 0 && gate.warns.every((w) => ticks[w.id]);
  return (
    <div class="card stack" data-reconcile="ready" data-light={worst}>
      <div class="row sb">
        <h3>考前對帳</h3>
        <div class="row">
          <span class={`rc-lamp rc-${worst} rc-big`} role="status"><span aria-hidden="true">{LIGHT_ICON[worst]}</span> {head}</span>
          <Button small onClick={p.onRecheck}>↻ 重新對帳</Button>
        </div>
      </div>
      <div class="small muted">依目前資料自動重算（{p.at}）。每次改動名單、教室{r.hasStudy ? '、標示' : ''}或重新排座後都會重算。從最後產出的座位表與標籤重新點人，不使用排座引擎自己的計數。</div>
      <div class="rc-legend small"><Lamp light="pass" /> <Lamp light="warn" /> 須逐項確認才能下載　<Lamp light="fail" /> 擋下載，須先修正　<Lamp light="na" /></div>
      <div class="rc-list">{r.checks.map((c) => <CheckRow key={`${c.id}-${c.light}-${c.a}-${c.b}`} c={c} onGo={p.onGo} />)}</div>

      <div class="lab"><b>總帳：每個時段，名單範圍內每個人都在一個地方</b></div>
      <div class="small">名單範圍 {r.scope.total} 人 ＝ 報名 {r.scope.enrolled} ＋ 未參加 {r.scope.absent}</div>
      <div class="rc-table scroll">
        <table class="t compact">
          <thead><tr><th>時段</th><th>科目</th><th>名單範圍</th><th>＝ 考試</th>{r.hasStudy && <th>＋ 自習</th>}<th>＋ 未參加</th><th>座位表</th><th>標籤</th><th>教室加總</th><th>帳</th></tr></thead>
          <tbody>{r.ledger.map((l) => (
            <tr key={l.key} data-ledger-ok={l.ok} class={l.ok ? '' : 'rc-bad'}>
              <td>{l.when}</td><td>{l.subject}</td><td>{l.scope}</td><td>{l.exam}</td>{r.hasStudy && <td>{l.study}</td>}<td>{l.absent}</td>
              <td>{l.seat} {l.seat === l.exam ? '✓' : '✕'}</td><td>{l.label} {l.label === l.exam ? '✓' : '✕'}</td><td>{l.room} {l.room === l.exam ? '✓' : '✕'}</td>
              <td>{l.ok ? '✓ 平' : '✕ 不平'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div class="rc-cards">{r.ledger.map((l) => (
        <div key={l.key} class={`rc-pcard ${l.ok ? '' : 'rc-bad'}`}>
          <div class="row sb"><b>{l.when}　{l.subject}</b><span>{l.ok ? '✓ 平' : '✕ 不平'}</span></div>
          <div class="small">名單範圍 {l.scope} ＝ 考試 {l.exam}{r.hasStudy ? ` ＋ 自習 ${l.study}` : ''} ＋ 未參加 {l.absent}</div>
          <div class="small muted">座位表 {l.seat}　標籤 {l.label}　教室加總 {l.room}</div>
        </div>
      ))}</div>
      <div class="small muted">「考試」是這個時段坐進考場的人；{r.hasStudy ? '「自習」是有報名本次考試、但這個時段不考的人；' : ''}「未參加」是名單範圍內沒有報名本次考試的人。{r.hasStudy ? '三者' : '兩者'}加起來必須等於名單範圍。</div>

      <div class="small muted">下載閘門：任何一項不通過就禁止下載；有警示要逐項確認；全部通過才直接放行。</div>
      {gate.fails > 0 && <Alert tone="danger"><b>還不能下載：</b>{gate.why}紅燈沒有「確認放行」，修正後會自動重新對帳。</Alert>}
      {gate.fails === 0 && gate.warns.length > 0 && !p.acked && (
        <Alert tone="warn" action={<Button small kind="primary" onClick={() => { setTicks({}); setDlg(true); }}>逐項確認警示…</Button>}><b>有 {gate.warns.length} 項警示：</b>逐項確認後才能下載。</Alert>
      )}
      {gate.fails === 0 && gate.warns.length > 0 && p.acked && <Alert tone="ok"><b>警示已逐項確認</b>：可以下載。確認只記在 App 內，輸出檔案不加註記；名單、教室、標示或排座一有變動，確認就作廢。</Alert>}

      {dlg && (
        <Modal title="逐項確認警示" onClose={() => setDlg(false)} actions={(
          <>
            <Button onClick={() => setDlg(false)}>取消</Button>
            <Button kind="primary" disabled={!allTicked || p.busy} onClick={() => { setDlg(false); p.onConfirmDownload(gate.fingerprint, 'word'); }}>確認並下載 Word</Button>
            <Button kind="primary" disabled={!allTicked || p.busy} onClick={() => { setDlg(false); p.onConfirmDownload(gate.fingerprint, 'pdf'); }}>確認並下載 PDF</Button>
          </>
        )}>
          <p class="small muted">每一項警示都要各自勾選，沒有全選；全部勾完才可確認。</p>
          {gate.warns.map((w) => (
            <label key={w.id} class="check" style="align-items:flex-start">
              <input type="checkbox" checked={!!ticks[w.id]} onChange={(e) => setTicks((t) => ({ ...t, [w.id]: e.currentTarget.checked }))} />
              <span><b>{w.id}　{w.title}</b>：{w.summary}<br />{w.issues.map((i) => <span key={i.text} class="small muted">{i.text}<br /></span>)}</span>
            </label>
          ))}
        </Modal>
      )}
    </div>
  );
}
