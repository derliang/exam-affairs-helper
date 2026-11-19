/** 補考七步驟（規格第三章）：名稱與短語、各步狀態。⑥ ⑦ 是儀表板與下載（K3） */
import { settingIssues, type MakeupSession } from './session';
import { baseOf, scheduleOf } from './pipeline';
import { todayTaipei } from '../examDates';
import { dashboardDone } from './dashboard';
import type { StepState } from '../components';

export const MAKEUP_STEP_NAMES = ['補考設定', '匯入名單', '教室設定', '人數統計', '考程編排', '檢核與對帳', '下載'] as const;
export const MAKEUP_STEP_BLURBS = ['日期・時長', '教務系統匯出檔', '座位與類型', '班級 × 科目', '時段與教室', '儀表板', '七項產出'] as const;
export const makeupStepTitle = (n: number): string => `${'①②③④⑤⑥⑦'[n - 1] ?? ''} ${MAKEUP_STEP_NAMES[n - 1] ?? ''}`;

export type MakeupStepNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 每一步做完了沒（資料算出，不是按鈕）；⑥ 沒有紅燈才算做完、⑦ 本版已下載且回讀全過才算做完 */
export function stepDone(s: MakeupSession, today: string = todayTaipei()): Record<MakeupStepNo, boolean> {
  const b = baseOf(s);
  const hasRoster = b.roster.included.length + b.roster.notified.length > 0;
  const importOk = !!s.parse && hasRoster && b.roster.unresolved.length === 0;
  const { schedule, peak } = scheduleOf(s);
  return {
    1: settingIssues(s, today, b.grades).length === 0,
    2: importOk,
    3: b.settings.rooms.length > 0 && peak.every((p) => p.ok),
    4: hasRoster,
    5: importOk && b.entries.length > 0 && schedule.unplaced.length === 0,
    6: hasRoster && dashboardDone(s).six,
    7: dashboardDone(s).seven,
  };
}

export function stepStates(s: MakeupSession, current: number, today?: string): { no: number; name: string; state: StepState; blurb: string }[] {
  const done = stepDone(s, today);
  return MAKEUP_STEP_NAMES.map((name, i) => {
    const no = (i + 1) as MakeupStepNo;
    return { no, name, blurb: MAKEUP_STEP_BLURBS[i]!, state: no === current ? 'cur' : done[no] ? 'done' : 'todo' } as { no: number; name: string; state: StepState; blurb: string };
  });
}
