/**
 * G37 新增考試「本次使用的環境」摘要（稿 v2.50 §四）。補考日後沿用同一元件。
 * 綠＝已確認、沒變動（一行，可展開）；琥珀＝沒確認過或與上次確認不同，須按「確認使用」；紅＝缺必要設定，不可確認。
 */
import { useState } from 'preact/hooks';
import type { ExamKind } from '../../data';
import { Alert, Badge, Button } from '../components';
import { envReport, type EnvLine } from '../env';
import { formatModified } from '../examList';
import type { Doc } from '../store';

type SettingsTab = 'roster' | 'classes' | 'school' | 'rooms' | 'sched';
const FIX: Record<string, { tab: SettingsTab; label: string }> = {
  sched: { tab: 'sched', label: '節次與時長' }, classes: { tab: 'roster', label: '學生名單' }, rooms: { tab: 'rooms', label: '教室清單' }, school: { tab: 'school', label: '學校與表頭' },
};
const fixOf = (l: EnvLine) => FIX[l.key.split(':')[0]!]!;
const MARK = { ok: '✓', warn: '▲', bad: '✕' } as const;

export function EnvCard(p: {
  doc: Doc; kind: ExamKind; round?: number | undefined; onConfirm: () => void;
  /** 跳去共用設定修改（會有「← 回到」導覽） */
  onGoSettings?: (tab: SettingsTab) => void;
}) {
  const rep = envReport(p.doc, p.kind, p.round);
  const [open, setOpen] = useState(false);
  const head = rep.state === 'confirmed' ? '環境已確認' : rep.state === 'blocked' ? '環境缺必要設定' : rep.state === 'changed' ? '環境與上次確認不同' : '還沒確認過環境';
  const tone = rep.tone === 'ok' ? 'ok' : rep.tone === 'bad' ? 'danger' : 'warn';
  const detail = (
    <ul class="envrows" aria-label="本次使用的環境明細">
      {rep.lines.map((l) => (
        <li key={l.key} class={`envrow e-${l.tone}`}>
          <span class="envmk" aria-hidden="true">{MARK[l.tone]}</span>
          <span class="envlab">{l.label}</span>
          <span class="envtext">{l.before !== undefined ? <>{l.before} → <b>{l.text}</b></> : l.text}</span>
          {l.tone !== 'ok' && p.onGoSettings && <Button small onClick={() => p.onGoSettings!(fixOf(l).tab)}>到「{fixOf(l).label}」›</Button>}
          {l.problem && <span class="field-msg" style="flex-basis:100%">{l.problem}</span>}
          {l.note && <span class="hint" data-k="envnote" style="flex-basis:100%">{l.note}</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <div class="psec envcard" data-env={rep.state}>
      <div class="lab">本次使用的環境</div>
      {rep.state === 'confirmed' ? (
        <>
          <div class="envone">
            <Badge tone="ok">✓ 環境已確認</Badge>
            <span class="envsum">{rep.lines.map((l) => l.text).join('・')}</span>
            <button type="button" class="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>展開明細 {open ? '▴' : '▾'}</button>
          </div>
          {rep.confirmedAt && <span class="hint">確認時間 {formatModified(rep.confirmedAt)}，與目前設定相同。</span>}
          {open && detail}
        </>
      ) : (
        <>
          <Alert tone={tone} action={rep.state !== 'blocked' ? <Button kind="primary" onClick={p.onConfirm}>確認使用</Button> : undefined}>
            <b>{head}</b>
            {rep.state === 'never' && '：節次表、教室、班級、標籤紙張要先看過一次，確認後才能建立這場考試。'}
            {rep.state === 'changed' && '：共用設定在上次確認後改過了，下面列出改了什麼；確認後才能建立。'}
            {rep.state === 'blocked' && '：下列問題不能確認，請先到共用設定處理。'}
          </Alert>
          {rep.changes.length > 0 && (
            <ul class="envchg" aria-label="與上次確認不同的地方">{rep.changes.map((c) => <li key={c.label}><b>{c.label}</b>：{c.before} → {c.after}</li>)}</ul>
          )}
          {detail}
        </>
      )}
    </div>
  );
}
