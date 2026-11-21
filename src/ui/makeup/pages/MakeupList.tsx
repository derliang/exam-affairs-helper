/** S-1 補考入口與場次列表（稿 S-1：有場次／第一次（空）／新增場次／找不到資料夾） */
import { useState } from 'preact/hooks';
import { Badge, Button, EmptyState, ConfirmModal, PageHead } from '../../components';
import { GRADE_TEXT, GRADE_ORDER } from '../../../core/makeup';
import { todayTaipei } from '../../examDates';
import { formatModified } from '../../examList';
import { outputsOf, baseOf } from '../pipeline';
import { dayLabel, SEMESTER_TEXT, type MakeupSession } from '../session';
import { stepDone, makeupStepTitle, type MakeupStepNo } from '../steps';

/** 場次列表一列的摘要：進度點、左邊條顏色、對帳徽章數字 */
export interface MakeupCardInfo {
  dots: ('d' | 'c' | 's' | '')[];
  tone: 'red' | 'amber' | 'green' | 'none';
  red: number;
  amber: number;
  missing: number;
  headline: string;
}

export function cardInfo(s: MakeupSession, today: string = todayTaipei()): MakeupCardInfo {
  const done = stepDone(s, today);
  const nos = [1, 2, 3, 4, 5, 6, 7] as MakeupStepNo[];
  const cur = nos.find((n) => !done[n]);
  const dots = nos.map((n) => (done[n] ? 'd' : n === cur ? 'c' : '')) as MakeupCardInfo['dots'];
  const b = baseOf(s);
  const has = b.roster.included.length > 0;
  // 沒有名單時不算對帳（所有項目都會因為沒資料而紅，列表不必嚇人）
  const checks = has ? outputsOf(s).checks.filter((c) => c.id !== 'C-14') : [];
  const red = checks.filter((c) => c.status === 'red').length;
  const amber = checks.filter((c) => c.status === 'amber').length;
  const missing = has ? Math.abs(outputsOf(s).checks.find((c) => c.id === 'C-3')?.diff ?? 0) : 0;
  const tone = !has ? 'none' : red > 0 ? 'red' : amber > 0 ? 'amber' : 'green';
  return { dots, tone, red, amber, missing, headline: cur ? makeupStepTitle(cur) : '前五步都完成了' };
}

/** 「考日 2 天：1/16（高三）、1/23（其餘）」 */
export function daysText(s: MakeupSession): string {
  const parts = s.days.map((d, i) => {
    const gs = GRADE_ORDER.filter((g) => s.gradeDay[g] === d.id);
    const who = gs.length === 6 ? '全校' : gs.length === 0 ? '' : gs.map((g) => GRADE_TEXT[g]).join('、');
    return `${dayLabel(d, i)}${who ? `（${who}）` : ''}`;
  });
  return `考日 ${s.days.length} 天：${parts.join('、')}`;
}

export function MakeupList(p: {
  sessions: MakeupSession[];
  folder?: string | undefined;
  /** 找不到資料夾時的錯誤區（沿用 G16 做法，由 App 傳入） */
  listError?: preact.ComponentChildren;
  today?: string;
  onNew: () => void;
  onOpen: (id: string, step?: MakeupStepNo) => void;
  onDelete: (id: string) => void;
}) {
  const [del, setDel] = useState<MakeupSession | null>(null);
  const today = p.today ?? todayTaipei();
  const sorted = [...p.sessions].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return (
    <section>
      {/* #505、稿 v2.85：沒有場次時頁首只放標題與徽章，唯一的新增鈕在空白卡中央；有場次時新增鈕回頁首右上 */}
      {sorted.length === 0 && !p.listError
        ? <PageHead title="補考" badge="補考模式" />
        : <PageHead title="補考" badge="補考模式"><Button kind="primary" onClick={p.onNew}>＋ 新增補考場次</Button></PageHead>}
      {p.listError ? p.listError : sorted.length === 0 ? (
        <EmptyState title="還沒有補考場次" action={<Button kind="primary" large onClick={p.onNew}>＋ 新增補考場次</Button>}
          hint="流程：① 補考設定 → ② 匯入名單 → ③ 教室設定 → ④ 人數統計 → ⑤ 考程編排 → ⑥ 檢核與對帳 → ⑦ 下載。前面還沒做完也能跳著點；⑥ 全部對上才能下載。">
          把教務系統匯出的不及格名單丟進來，系統會統計人數、排考程與教室，並逐項對帳，確保沒有任何一位補考學生被漏掉。
        </EmptyState>
      ) : (
        <div class="exam-list" style="margin-top:12px">
          {sorted.map((s) => {
            const info = cardInfo(s, today);
            const b = baseOf(s);
            const students = new Set([...b.roster.included, ...b.roster.notified].map((r) => r.studentId)).size;
            return (
              <article class={`exam mk-card mk-${info.tone}`} key={s.id}>
                <div>
                  <h3>{s.name}</h3>
                  <div class="meta">
                    <Badge>補考</Badge>
                    <span>{s.year} 學年・{SEMESTER_TEXT[s.semester]}</span>
                    <span>{daysText(s)}</span>
                    <span>{b.entries.length > 0 ? `${b.entries.length} 人次・${students} 位學生` : '尚未匯入名單'}</span>
                  </div>
                </div>
                <div>
                  <div class="dots" aria-hidden="true">{info.dots.map((c, i) => <i key={i} class={c} />)}</div>
                  <div class="prog">{info.headline}
                    {info.tone === 'red' && <span class="bad">・✕ {info.red} 項不通過・遺漏 {info.missing} 筆</span>}
                    {info.tone === 'amber' && <span class="amb">・! {info.amber} 項警示（僅供參考）・遺漏 {info.missing} 筆</span>}
                    {info.tone === 'green' && <span class="ok">・✓ 全數對上・遺漏 0 筆</span>}
                  </div>
                  <div class="small muted" style="margin-top:4px">最後更新 {formatModified(s.modifiedAt)}</div>
                </div>
                <div class="row" style="flex-wrap:wrap">
                  <Button kind="primary" onClick={() => p.onOpen(s.id)}>繼續 ›</Button>
                  <Button kind="danger" onClick={() => setDel(s)}>刪除</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {sorted.length > 0 && !p.listError && <p class="small muted" style="margin-top:12px">進度點：綠＝完成、藍＝目前、灰＝尚未做。左邊的粗線：紅＝有不通過項目、琥珀＝有待確認項目、綠＝全數對上。</p>}
      {del && (
        <ConfirmModal
          copy={{ title: `刪除補考場次「${del.name}」？`, body: '會刪掉這個場次的設定、匯入的名單與教室（只刪 App 內的資料，不碰已下載的檔案）。', confirm: '刪除' }}
          onConfirm={() => { p.onDelete(del.id); setDel(null); }} onClose={() => setDel(null)} />
      )}
    </section>
  );
}
