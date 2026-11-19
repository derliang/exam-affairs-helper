import { Alert, Badge, Button, EmptyState, More } from '../components';
import type { StudyCapacity, StudyGroupRow } from '../capacity';

/** 第 3、4、5 步共用的「自習容量」顯示（G29、G31；數字都來自 capacity.ts 的 studyCapacity，三處一致） */

const maxOf = (gs: StudyGroupRow[], f: (g: StudyGroupRow) => number) => gs.reduce((m, g) => Math.max(m, f(g)), 0);

/** 缺口說明：點名第一個放不下的時段與哪一部分 */
export function shortText(sc: StudyCapacity): string {
  const w = sc.worst;
  if (!w || sc.ok) return '';
  if (w.failPart === 'exam') return `「${w.label}」（${w.when}）抽離考試 ${w.examCount} 人，預備教室座位不足，還缺 ${w.short} 個座位。`;
  if (w.failPart === 'study') return `「${w.label}」（${w.when}）抽離考試用掉部分預備教室後，剩下的座位不足以容納抽離自習 ${w.studyCount} 人，還缺 ${w.short} 個座位。`;
  return sc.allocErrors[0] ?? '預備教室排不下。';
}

export function StudyNeedDetail(p: { sc: StudyCapacity; compact?: boolean; /** 第 3 步：點「再列入」直接勾進本次考試 */ onAdd?: (ids: string[]) => void; onNewRoom?: () => void }) {
  const { sc } = p;
  if (!sc.applicable) return null;
  const act = sc.groups.filter((g) => g.examCount + g.studyCount > 0);
  if (act.length === 0) return <p class="small muted">目前標示方式下沒有抽離考試或抽離自習，不需要預備教室。</p>;
  const exMax = maxOf(act, (g) => g.examCount);
  const stMax = maxOf(act, (g) => g.studyCount);
  const rooms = maxOf(act, (g) => g.examRooms + g.studyRooms);
  const seats = maxOf(act, (g) => g.seatsNeed);
  return (
    <div class="stack" style="gap:6px">
      <p class={`small${sc.ok ? ' muted' : ' errnote'}`}>
        <b>預備教室需求（目前標示方式）：</b>抽離考試最多 {exMax} 人、抽離自習最多 {stMax} 人（同一時段），需要預備教室 {rooms} 間、至少 {seats} 個座位（考試與自習各用整間、分開排）；已列入 {sc.on}／{sc.total} 間、{sc.avail} 個座位。{sc.ok ? '夠用。' : ''}
      </p>
      {!sc.ok && (
        <Alert tone="danger" action={
          sc.addRooms
            ? (p.onAdd && <Button small kind="primary" onClick={() => p.onAdd!(sc.addRoomIds)}>再列入 {sc.addRooms} 間預備教室</Button>)
            : (p.onNewRoom && <Button small onClick={p.onNewRoom}>新增預備教室</Button>)
        }>
          <b>預備教室不夠：</b>{shortText(sc)}{sc.allocErrors.length > 0 && !sc.groups.some((g) => !g.ok) ? sc.allocErrors.join('；') : ''}
          {sc.addRooms ? `再列入 ${sc.addRooms} 間共用設定裡已有的預備教室就夠了。` : '共用設定裡已有的預備教室全列入也不夠，請新增預備教室或加大座位。'}
        </Alert>
      )}
      {!p.compact && (
        <More title="每個時段的明細">
          <div class="scroll">
            <table class="t compact">
              <thead><tr><th>時段</th><th>科目</th><th>抽離考試</th><th>抽離自習</th><th>需要教室</th><th>至少座位</th><th>結果</th></tr></thead>
              <tbody>
                {act.map((g) => (
                  <tr key={g.key}>
                    <td>{g.when}</td><td>{g.label}</td><td class="n">{g.examCount}</td><td class="n">{g.studyCount}</td>
                    <td class="n">{g.examRooms + g.studyRooms} 間</td><td class="n">{g.seatsNeed}</td>
                    <td><Badge tone={g.ok ? 'ok' : 'danger'}>{g.ok ? '夠用' : `缺 ${g.short}`}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </More>
      )}
    </div>
  );
}

/** 第 5 步「各時段自習」（G31）：人數、地點、可用座位、夠不夠 */
export function StudySlotTable(p: { sc: StudyCapacity; classNames: Map<number, string> }) {
  const { sc } = p;
  if (!sc.applicable) return null;
  const rows = sc.groups.filter((g) => g.studyCount + g.stay > 0 || g.examCount > 0);
  if (rows.length === 0) return <EmptyState title="每個時段所有人都考，沒有自習的人" />;
  return (
    <div class="scroll">
      <table class="t compact">
        <thead><tr><th>時段</th><th>科目</th><th>自習人數</th><th>自習地點</th><th>可用座位</th><th>夠不夠</th></tr></thead>
        <tbody>
          {rows.map((g) => {
            const home = g.stayByClass.map((c) => `${p.classNames.get(c.classNo) ?? c.classNo} ${c.count}`).join('、');
            return (
              <tr key={g.key}>
                <td>{g.when}</td><td>{g.label}</td>
                <td>
                  {g.studyCount > 0 && <div>抽離 {g.studyCount} 人</div>}
                  {g.stay > 0 && <div>留原班 {g.stay} 人{home && <span class="muted small">（{home}）</span>}</div>}
                  {g.studyCount + g.stay === 0 && <span class="muted">—</span>}
                </td>
                <td>{g.studyCount > 0 && <div>預備教室{g.studyRooms > 0 ? ` ${g.studyRooms} 間` : ''}</div>}{g.stay > 0 && <div>原班教室</div>}</td>
                <td>{g.studyCount > 0 && <div>預備教室 {g.avail}{g.examCount > 0 && `（考試 ${g.examCount} 人先用整間）`}</div>}{g.stay > 0 && <div>{sc.homeOk ? '班級教室座位足夠' : '班級教室座位不足'}</div>}</td>
                <td>
                  {g.studyCount > 0 && <div><Badge tone={g.ok ? 'ok' : 'danger'}>{g.ok ? '抽離自習夠' : `缺 ${g.short}`}</Badge></div>}
                  {g.stay > 0 && <div><Badge tone={sc.homeOk ? 'ok' : 'danger'}>{sc.homeOk ? '原班夠' : '原班不足'}</Badge></div>}
                  {g.studyCount + g.stay === 0 && <Badge tone={g.ok ? 'ok' : 'danger'}>{g.ok ? '夠用' : `缺 ${g.short}`}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
