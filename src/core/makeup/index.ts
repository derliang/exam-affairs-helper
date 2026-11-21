/**
 * 補考核心（K1）：純邏輯，不碰畫面。呼叫方式見 docs/dispatch/補考K1完成記錄.md。
 *
 * 典型流程：
 *   const parse = parseMakeupWorkbook(await readXlsx(buf));     // ② 匯入
 *   const roster = resolveMakeup(parse, resolutions);              // ② 問題列處理
 *   const entries = makeupEntries(roster, settings.trackSplit);   // ④ 統計的輸入
 *   const plan = suggestPlan(entries, settings);                   // ⑤ 系統建議（使用者可改 plan）
 *   const schedule = buildSchedule(entries, settings, plan);       // ⑤ 排程
 *   const outputs = buildOutputs(schedule, entries, settings);     // ⑦ 產出模型
 *   const checks = runMakeupChecks({ roster, settings, plan, outputs, currentVersion: makeupVersion(roster, settings, plan) });
 *   const gate = downloadGate(checks);               // ⑥⑦ 閘門
 */
import { dataVersion } from '../version';
import type { MakeupPlan, MakeupRoster, MakeupSettings } from './types';

export * from './types';
export * from './importRows';
export * from './stats';
export * from './schedule';
export * from './outputs';
export * from './checks';
export * from './byDay';

/** 補考資料版本碼（D66 同一套）：名單、設定、計畫任何一項變動就會變（C-15 過期判斷、檔案頁尾） */
export function makeupVersion(roster: MakeupRoster, settings: MakeupSettings, plan: MakeupPlan): string {
  return dataVersion({ kind: 'makeup', included: roster.included, notified: roster.notified, skipped: roster.skipped, settings, plan });
}
