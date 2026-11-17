/**
 * 補考紙面（K4，O-1～O-5、O-7）：把 K1 的產出模型（MakeupOutputs）排成通用表格頁（TablePageModel），
 * 交給既有的 renderDocx（Word）與 renderPrintHtml（PDF 用列印頁）。版面依稿 v2.52 S-9。
 *
 * 版面約定（回讀驗算 makeupReadback.ts 依這些表頭認表，改表頭要一起改）：
 * - 表頭第一格是各文件的識別字：O-1「卷別」、O-2「考日・年級」、O-3「舊班」、O-4「學號」＋「舊班」、O-5「座位」、O-7「序號」。
 * - 統計列、合計列的第一格是「統計」或「合計」，回讀時不算人次。
 * - 每頁頁尾由 renderDocx／renderPrintHtml 印版本碼（資料版本碼：MK…　總人次 N）。
 * 所有函式純計算、不取現在時間；只讀模型，不重排程。
 */
import { fmtTime, type MakeupOutputs, type MakeupRoster, type MakeupSchedule, type MakeupSettings, type SlotInfo } from '../core/makeup';
import type { TablePageModel } from './model';

export interface MakeupPaperInput {
  /** 例「115 學年第一學期補考」 */
  title: string;
  settings: MakeupSettings;
  roster: Pick<MakeupRoster, 'notified' | 'gradeOfClass'>;
  schedule: MakeupSchedule;
  outputs: MakeupOutputs;
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export const slotName = (s: SlotInfo): string => (s.kind === 'early' ? '提前開考' : `時段${CN[s.index] ?? s.index + 1}${s.kind === 'final' ? '（綜合節）' : ''}`);
export const slotTime = (s: SlotInfo): string => (s.kind === 'early' ? `${fmtTime(s.start)} 起` : `${fmtTime(s.start)}–${fmtTime(s.end)}`);

interface Ctx {
  dayLabel: (dayId: string) => string;
  roomName: (id: string) => string;
  slot: (id: string) => SlotInfo;
  groupLabel: (groupId: string) => string;
}
function ctxOf(i: MakeupPaperInput): Ctx {
  const slots = new Map(i.schedule.slots.map((s) => [s.id, s]));
  return {
    dayLabel: (id) => i.settings.days.find((d) => d.id === id)?.label ?? id,
    roomName: (id) => i.settings.rooms.find((r) => r.id === id)?.name ?? id,
    slot: (id) => slots.get(id) as SlotInfo,
    groupLabel: (id) => i.settings.groups.find((g) => g.id === id)?.label ?? id,
  };
}
const pad2 = (n: number): string => String(n).padStart(2, '0');
const dayList = (i: MakeupPaperInput, c: Ctx): string => {
  const ids = [...new Set(i.schedule.slots.map((s) => s.dayId))].sort((a, b) => i.settings.days.findIndex((d) => d.id === a) - i.settings.days.findIndex((d) => d.id === b));
  return ids.map((id) => c.dayLabel(id)).join('、');
};
const leaveTimes = (i: MakeupPaperInput): string[] => [...new Set(i.schedule.early.map((e) => fmtTime(e.leaveAt)))].sort();

/** O-1 人數統計與備卷清單：每卷（年級＋科目）各時段各教室份數，合計＝人次 */
export function buildPrepPages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  const total = new Map<string, number>();
  for (const p of i.outputs.papers) total.set(p.paper, (total.get(p.paper) ?? 0) + p.count);
  const seen = new Set<string>();
  const rows = i.outputs.papers.map((p) => {
    const s = c.slot(p.slotId);
    const first = !seen.has(p.paper);
    seen.add(p.paper);
    return [p.paper, first ? String(total.get(p.paper)) : '', `${c.dayLabel(s.dayId)} ${slotName(s)}`, c.roomName(p.roomId), String(p.count)];
  });
  const sum = i.outputs.papers.reduce((a, p) => a + p.count, 0);
  const noti = new Map<string, number>();
  for (const r of i.roster.notified) noti.set(r.subjectName, (noti.get(r.subjectName) ?? 0) + 1);
  const notiText = noti.size ? `另行通知科目（不排考程）：${[...noti].map(([k, v]) => `${k} ${v}`).join('・')}　合計 ${i.roster.notified.length}` : '另行通知科目：無';
  return [
    {
      kind: 'table',
      title: '補考人數統計與備卷清單',
      subtitle: `${i.title}　考日：${dayList(i, c)}`,
      legend: `${notiText}　｜　份數合計＝${sum}（各卷份數合計須等於各卷人數）`,
      heads: ['卷別', '人數', '考日・時段', '教室', '份數'],
      widths: [2.6, 1, 2.6, 2.6, 1],
      rows,
      totalRow: ['合計', String(sum), '', '', String(sum)],
    },
  ];
}

/** O-2 考程表（A4 橫式）：群組 × 時段，每格時間、科目、人次與教室人數；最後一列監考老師空欄 */
export function buildTimetablePages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  const bySlot = new Map<string, typeof i.schedule.sittings>();
  for (const x of i.schedule.sittings) {
    const a = bySlot.get(x.slotId);
    if (a) a.push(x);
    else bySlot.set(x.slotId, [x]);
  }
  const dayOrder = (id: string): number => i.settings.days.findIndex((d) => d.id === id);
  const groups = i.settings.groups
    .filter((g) => i.schedule.slots.some((s) => s.groupId === g.id))
    .sort((a, b) => dayOrder(a.dayId) - dayOrder(b.dayId));
  const regular = (gid: string): SlotInfo[] => i.schedule.slots.filter((s) => s.groupId === gid && s.kind !== 'early').sort((a, b) => a.index - b.index);
  const maxN = Math.max(1, ...groups.map((g) => regular(g.id).length));
  const cell = (s: SlotInfo): string => {
    const list = bySlot.get(s.id) ?? [];
    const subj = new Map<string, number>();
    const room = new Map<string, number>();
    for (const x of list) {
      for (const sub of x.subjects) subj.set(sub, (subj.get(sub) ?? 0) + 1);
      room.set(x.roomId, (room.get(x.roomId) ?? 0) + 1);
    }
    const subjText = [...subj].map(([k, v]) => `${k} ${v} 人次`).join('＋');
    const roomText = [...room].map(([id, n]) => `${c.roomName(id)} ${n}`).join('／');
    return `${slotTime(s)}　${subjText || '—'}${roomText ? `（${roomText}）` : ''}`;
  };
  const rows: string[][] = [];
  for (const g of groups) {
    const label = `${c.dayLabel(g.dayId)} ${g.label}`;
    const slots = regular(g.id);
    rows.push([label, ...Array.from({ length: maxN }, (_, k) => (slots[k] ? cell(slots[k]!) : '—'))]);
    const early = i.schedule.slots.find((s) => s.groupId === g.id && s.kind === 'early');
    if (early) {
      const list = bySlot.get(early.id) ?? [];
      const rooms = [...new Set(list.map((x) => c.roomName(x.roomId)))].join('、');
      const entries = list.reduce((a, x) => a + x.subjects.length, 0);
      const leave = Math.max(...list.map((x) => x.leaveAt ?? 0));
      rows.push([`${label} 提前開考`, `${fmtTime(early.start)} 起　${rooms}　${list.length} 人　共 ${entries} 人次　最早離場 ${fmtTime(leave)}`, ...Array.from({ length: maxN - 1 }, () => '')]);
    }
  }
  rows.push(['監考老師', ...Array.from({ length: maxN }, () => '')]);
  const leaves = leaveTimes(i);
  const notes = [
    '考試請攜帶學生證，依公告教室就座，自由入座。',
    '綜合節同學到該時段結束才可離場。',
    ...(leaves.length ? [`提前開考的同學${leaves.map((t) => `${t} 前不得離場`).join('、')}。`] : []),
    '多科生的各科考卷合為一份，監考老師點交。',
  ];
  return [
    {
      kind: 'table',
      landscape: true,
      title: '補考考程表',
      subtitle: i.title,
      legend: `注意事項：${notes.join('')}`,
      heads: ['考日・年級', ...Array.from({ length: maxN }, (_, k) => `時段${CN[k] ?? k + 1}`)],
      widths: [2.2, ...Array.from({ length: maxN }, () => 4)],
      rows,
    },
  ];
}

/** O-3 班級公告：每班一頁；公告版只印學號（不印姓名），導師存參版把學號欄換成姓名（兩份行數相同） */
export function buildAnnouncementPages(i: MakeupPaperInput, variant: 'public' | 'teacher'): TablePageModel[] {
  const c = ctxOf(i);
  const leaves = leaveTimes(i);
  return i.outputs.announcements.map((a) => {
    const rows = a.rows.map((r) => {
      const s = c.slot(r.slotId);
      const time = s.kind === 'early' ? `${fmtTime(s.start)} 起（提前開考）` : slotTime(s);
      return [a.oldClass, pad2(r.oldSeat), variant === 'public' ? r.studentId : r.name, r.subject, `${c.dayLabel(s.dayId)} ${time}`, r.roomName, r.note];
    });
    const hasEarly = a.rows.some((r) => r.note);
    const notes = [
      '班級以舊班、舊號為準。請攜帶學生證，提早 10 分鐘到場，自由入座。',
      '不得攜帶手機、智慧型手錶進入考場。',
      '無故缺考以零分計，如有特殊情形請事先向教務處請假。',
      `綜合節請坐到該時段結束才可離場${hasEarly && leaves.length ? `；提前開考的同學${leaves.map((t) => `${t} 前不得離場`).join('、')}` : ''}。`,
    ];
    return {
      kind: 'table' as const,
      title: `${a.oldClass}　補考公告`,
      subtitle: `${variant === 'public' ? '公告版（不印姓名）' : '導師存參版（含姓名，請勿張貼）'}　${i.title}　本班共 ${rows.length} 人次`,
      legend: notes.join(''),
      heads: ['舊班', '座號', variant === 'public' ? '學號' : '姓名', '科目', '時間', '地點', '註'],
      widths: [1.1, 0.9, 1.6, 1.6, 2.6, 2, 1.8],
      rows,
    };
  });
}

/** O-4 補考點名單：每考場每節一張；多科生一人一列列出全部科目與卷數；註欄標「HH:MM 前不得離場」；表尾各科學生統計 */
export function buildRollCallPages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  return i.outputs.rollCalls.map((sheet) => {
    const s = c.slot(sheet.slotId);
    const rows: string[][] = sheet.rows.map((r) => [r.studentId, r.oldClass, pad2(r.oldSeat), r.name, r.subjects.join('、'), String(r.paperCount), r.note]);
    const kinds: ('exam' | 'multi' | undefined)[][] = sheet.rows.map((r) => (r.paperCount > 1 ? Array(7).fill('multi') : []));
    for (const [paper, n] of Object.entries(sheet.paperTotals).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(['統計', '', '', '', paper, String(n), '實到：　　缺考：']);
      kinds.push(Array(7).fill('exam'));
    }
    return {
      kind: 'table' as const,
      title: '補考點名單',
      subtitle: `考場：${sheet.roomName}　${c.dayLabel(s.dayId)}　${slotName(s)} ${slotTime(s)}　應到 ${sheet.rows.length} 人　監考老師：＿＿＿＿＿＿`,
      legend: '註欄標「HH:MM 前不得離場」者為提前開考學生（洩題管制），監考老師請勿提前放行。多科生各科考卷合為一份。',
      heads: ['學號', '舊班', '舊號', '姓名', '科目', '卷數', '註（缺考／證件）'],
      widths: [1.4, 1.3, 0.9, 1.5, 2.8, 0.9, 2.4],
      rows,
      cellKinds: kinds,
    };
  });
}

/** O-5 座位表（參考）：每考場每節一張，依班級、座號排列；座標寫「第N排－深位」（D119） */
export function buildSeatTablePages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  const roll = new Map(i.outputs.rollCalls.map((r) => [`${r.slotId}@@${r.roomId}`, r]));
  return i.outputs.seatTables.map((t) => {
    const s = c.slot(t.slotId);
    const sheet = roll.get(`${t.slotId}@@${t.roomId}`);
    const rows = t.seats.map((x) => {
      const [r, d] = (x.seat ?? '').split('-');
      return [x.seat ? `第${r}排－${d}` : '（無座位）', x.oldClass, pad2(x.oldSeat), x.studentId];
    });
    return {
      kind: 'table' as const,
      title: '補考座位表（參考）',
      subtitle: `考場：${sheet?.roomName ?? c.roomName(t.roomId)}　${c.dayLabel(s.dayId)}　${slotName(s)} ${slotTime(s)}　共 ${rows.length} 人`,
      legend: '依班級、座號排列；現場自由入座，本表僅供檢核「每個人都有座位」（座標「排－深位」）。',
      heads: ['座位', '舊班', '舊號', '學號'],
      widths: [2, 1.6, 1, 1.8],
      rows,
    };
  });
}

/** O-7 公假名單（給學務處；欄位格式暫定 U-3，待核對 106-2 初三那份）：學生、班級、科目、日期基本版 */
export function buildLeaveListPages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  interface Acc { oldClass: string; oldSeat: number; name: string; subjects: string[]; days: Set<string> }
  const by = new Map<string, Acc>();
  const nameOf = new Map<string, string>();
  for (const a of i.outputs.announcements) for (const r of a.rows) nameOf.set(r.studentId, r.name);
  for (const x of i.schedule.sittings) {
    const a = by.get(x.studentId) ?? { oldClass: x.oldClass, oldSeat: x.oldSeat, name: nameOf.get(x.studentId) ?? '', subjects: [], days: new Set<string>() };
    a.subjects.push(...x.subjects);
    a.days.add(c.slot(x.slotId).dayId);
    by.set(x.studentId, a);
  }
  const order = i.settings.days.map((d) => d.id);
  const gradeIdx = (cls: string): number => ['J1', 'J2', 'J3', 'S1', 'S2', 'S3'].indexOf(i.roster.gradeOfClass[cls] ?? 'S3');
  const list = [...by.entries()].sort(([ia, a], [ib, b]) => gradeIdx(a.oldClass) - gradeIdx(b.oldClass) || a.oldClass.localeCompare(b.oldClass, 'zh-Hant', { numeric: true }) || a.oldSeat - b.oldSeat || ia.localeCompare(ib));
  const rows = list.map(([id, a], k) => [
    String(k + 1),
    id,
    `${a.oldClass} ${pad2(a.oldSeat)}`,
    a.name,
    [...new Set(a.subjects)].join('、'),
    String(a.subjects.length),
    [...a.days].sort((x, y) => order.indexOf(x) - order.indexOf(y)).map((d) => c.dayLabel(d)).join('、'),
  ]);
  return [
    {
      kind: 'table',
      title: '補考公假名單',
      subtitle: `給學務處　${i.title}　共 ${rows.length} 人`,
      legend: '欄位格式暫定（U-3），待與學務處核對；目前為「學生、班級、科目、日期」基本版。',
      heads: ['序號', '學號', '班級', '姓名', '補考科目', '科數', '日期'],
      widths: [0.8, 1.4, 1.5, 1.5, 3, 0.8, 2],
      rows,
    },
  ];
}
