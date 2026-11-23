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
import { classroomSeats, seatLabel, type Classroom } from '../data';
import { addSeatLegend, type CellModel, type SeatPageModel, type TablePageModel } from './model';

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

/**
 * O-2 考程表（A4 橫式，D220／#646 重做，照學校歷年「補考時間、地點表」＋「補考監考表」）：每個考日兩頁——
 * ①補考時間、地點表（給學生）：欄＝年級組（上方分高中部／初中部），列＝節次（每節三列：時間、科目、補考地點）；
 * ②補考監考表（給監考老師）：欄＝監考教室（含座位數），列＝時段（每時段兩列：時間、考科與人數），最上列監考老師留空手寫。
 * 回讀驗算（makeupReadback）認第二張表：表頭第一格「監考時段」，各格「卷別(人數)」。提前開考的「HH:MM 前不得離場」印在兩張表的注意事項。
 */
export function buildTimetablePages(i: MakeupPaperInput): TablePageModel[] {
  const c = ctxOf(i);
  const dayOrder = (id: string): number => i.settings.days.findIndex((d) => d.id === id);
  const days = [...new Set(i.schedule.slots.map((s) => s.dayId))].sort((a, b) => dayOrder(a) - dayOrder(b));
  const leaves = leaveTimes(i);
  const kindsOf = (s: SlotInfo): string => (s.kind === 'final' ? '多科' : '單科');
  const timeText = (s: SlotInfo): string => (s.kind === 'final' ? `${fmtTime(s.start)}～考完為止` : s.kind === 'early' ? `${fmtTime(s.start)} 起` : `${fmtTime(s.start)}–${fmtTime(s.end)}`);
  const pages: TablePageModel[] = [];
  for (const dayId of days) {
    const day = c.dayLabel(dayId);
    const slots = i.schedule.slots.filter((s) => s.dayId === dayId);
    const sit = (slotId: string) => i.schedule.sittings.filter((x) => x.slotId === slotId);
    const groups = i.settings.groups.filter((g) => g.dayId === dayId && slots.some((s) => s.groupId === g.id));
    const hasEarly = leaves.length > 0 && slots.some((s) => s.kind === 'early' && sit(s.id).length > 0);
    const dayLeaves = [...new Set(i.schedule.early.filter((e) => slots.some((s) => s.groupId === e.groupId)).map((e) => fmtTime(e.leaveAt)))].sort();

    // ① 補考時間、地點表（給學生）
    const dept = (g: (typeof groups)[number]): string => (g.grades.some((x) => x.startsWith('S')) ? '高中部' : '初中部');
    const ordered = [...groups].sort((a, b) => (dept(a) === dept(b) ? 0 : dept(a) === '高中部' ? -1 : 1));
    const headGroups = [{ text: '', span: 1 }];
    for (const g of ordered) {
      const last = headGroups[headGroups.length - 1]!;
      if (last.text === dept(g)) last.span++;
      else headGroups.push({ text: dept(g), span: 1 });
    }
    const regular = (gid: string): SlotInfo[] => slots.filter((s) => s.groupId === gid && s.kind !== 'early').sort((a, b) => a.index - b.index);
    const maxN = Math.max(1, ...ordered.map((g) => regular(g.id).length));
    const place = (s: SlotInfo): string => {
      const by = new Map<string, Set<string>>();
      for (const x of sit(s.id)) {
        const set = by.get(x.roomId) ?? new Set<string>();
        set.add(x.oldClass);
        by.set(x.roomId, set);
      }
      return [...by].map(([rid, cls]) => (by.size > 1 ? `${c.roomName(rid)}（${[...cls].join('、')}）` : c.roomName(rid))).join('／') || '—';
    };
    const subj = (s: SlotInfo): string => {
      const used = new Set(sit(s.id).flatMap((x) => x.subjects));
      return [...used].join('、') || '—';
    };
    const r1: string[][] = [];
    for (let k = 0; k < maxN; k++) {
      const per = ordered.map((g) => regular(g.id)[k]);
      const name = `第${CN[k] ?? k + 1}節`;
      r1.push([`${name}・時間`, ...per.map((s) => (s ? timeText(s) : '—'))]);
      r1.push([`${name}・科目`, ...per.map((s) => (s ? subj(s) : '—'))]);
      r1.push([`${name}・補考地點`, ...per.map((s) => (s ? place(s) : '—'))]);
    }
    if (slots.some((s) => s.kind === 'early' && sit(s.id).length > 0)) {
      const per = ordered.map((g) => slots.find((s) => s.groupId === g.id && s.kind === 'early' && sit(s.id).length > 0));
      r1.push(['提前開考・時間', ...per.map((s) => (s ? timeText(s) : '—'))]);
      r1.push(['提前開考・科目', ...per.map((s) => (s ? subj(s) : '—'))]);
      r1.push(['提前開考・補考地點', ...per.map((s) => (s ? place(s) : '—'))]);
    }
    const hasFinal = slots.some((s) => s.kind === 'final');
    const notes1 = [
      '請攜帶學生證，依公告教室就座，自由入座。',
      '考試中請保持安靜，不得攜帶手機、智慧型手錶進入考場。',
      ...(hasFinal ? [`綜合節（${[...new Set(slots.filter((s) => s.kind === 'final').map(kindsOf))].join('')}）同學考完才可離場，時間可能較長，請先用餐。`] : []),
      ...(hasEarly ? [`提前開考的同學${dayLeaves.map((t) => `${t} 前不得離場`).join('、')}。`] : []),
    ];
    pages.push({
      kind: 'table',
      landscape: true,
      title: '補考時間、地點表',
      subtitle: `${i.title}　${day}`,
      legend: `請詳閱注意事項：${notes1.map((t, k) => `${k + 1}. ${t}`).join('　')}`,
      heads: ['節次', ...ordered.map((g) => g.label)],
      headGroups,
      widths: [1.7, ...ordered.map(() => 4)],
      rows: r1,
    });

    // ② 補考監考表（給監考老師）
    const dayRooms = i.settings.rooms.filter((r) => i.schedule.sittings.some((x) => x.roomId === r.id && slots.some((s) => s.id === x.slotId)));
    const seatsOf = (r: (typeof dayRooms)[number]): number => classroomSeats({ id: r.id, name: r.name, kind: 'class', rows: r.rows, depth: r.depth, seatCount: r.seatCount, ...(r.disabled ? { disabled: r.disabled } : {}), ...(r.rowDepths ? { rowDepths: r.rowDepths } : {}) } as Classroom).length;
    const timeKey = (s: SlotInfo): string => `${s.kind === 'early' ? 'e' : 'n'}|${s.start}|${s.kind === 'early' ? 0 : s.end}`;
    const keys = [...new Map(slots.filter((s) => sit(s.id).length > 0).map((s) => [timeKey(s), s] as const)).values()].sort((a, b) => (a.kind === 'early' ? 1 : 0) - (b.kind === 'early' ? 1 : 0) || a.start - b.start || a.end - b.end);
    const r2: string[][] = [['監考老師', ...dayRooms.map(() => '')]];
    let n = 0;
    for (const s of keys) {
      const same = slots.filter((x) => timeKey(x) === timeKey(s));
      const label = s.kind === 'early' ? '提前開考' : `時段${CN[n++] ?? n}`;
      const mine = (rid: string) => i.schedule.sittings.filter((x) => x.roomId === rid && same.some((y) => y.id === x.slotId));
      r2.push([`${label}・時間`, ...dayRooms.map((r) => (mine(r.id).length ? timeText(s) : ''))]);
      r2.push([
        `${label}・考科與人數`,
        ...dayRooms.map((r) => {
          const list = mine(r.id);
          if (!list.length) return '';
          const cnt = new Map<string, number>();
          for (const x of list) for (const p of x.papers) cnt.set(p, (cnt.get(p) ?? 0) + 1);
          const cls = [...new Set(list.map((x) => x.oldClass))];
          const leave = s.kind === 'early' ? Math.max(...list.map((x) => x.leaveAt ?? 0)) : 0;
          return [...cnt].map(([k, v]) => `${k}(${v})`).join('、') + (cls.length > 1 ? `　班級：${cls.join('、')}` : '') + (leave ? `　${fmtTime(leave)} 前不得離場` : '');
        }),
      ]);
    }
    pages.push({
      kind: 'table',
      landscape: true,
      title: '補考監考表',
      subtitle: `${i.title}　${day}　請於　　：　　到教務處櫃臺領卷`,
      legend: `注意事項：多科生的各科考卷合為一份，監考老師點交。各格「卷別(人數)」為該教室該時段應到人次。${hasEarly ? `提前開考的同學${dayLeaves.map((t) => `${t} 前不得離場`).join('、')}，請勿提前放行。` : ''}`,
      heads: ['監考時段', ...dayRooms.map((r) => `${r.name}（${seatsOf(r)}座位）`)],
      widths: [2.3, ...dayRooms.map(() => 3)],
      rows: r2,
    });
  }
  return pages;
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

/**
 * O-5 座位表（D220／#644：由清單改成格狀座位圖，比照學測座位表）：每考場每節一頁，每個座位一格、依排與深位排成方陣、講臺在下；
 * 格內：座標（右上）、舊號（大字）、舊班｜學號；沒人坐的可用座位畫斜線、停用座位畫斜紋（D220／#647）。
 * 仍依班級、座號排座（D119：現場自由入座，本表僅供檢核「每個人都有座位」）。回讀驗算數「出現的學號」（makeupReadback）。
 */
export function buildSeatTablePages(i: MakeupPaperInput): SeatPageModel[] {
  const c = ctxOf(i);
  const roll = new Map(i.outputs.rollCalls.map((r) => [`${r.slotId}@@${r.roomId}`, r]));
  const pages: SeatPageModel[] = [];
  for (const t of i.outputs.seatTables) {
    const s = c.slot(t.slotId);
    const room = i.settings.rooms.find((r) => r.id === t.roomId);
    if (!room) continue;
    const cls: Classroom = { id: room.id, name: room.name, kind: 'class', rows: room.rows, depth: room.depth, seatCount: room.seatCount, ...(room.disabled ? { disabled: room.disabled } : {}), ...(room.rowDepths ? { rowDepths: room.rowDepths } : {}) };
    const usable = new Set(classroomSeats(cls).map((x) => `${x.row}-${x.depth}`));
    const classes = [...new Set(t.seats.map((x) => x.oldClass))].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
    const cells = new Map<string, CellModel>();
    for (const x of t.seats) {
      if (!x.seat) continue;
      const [r, d] = x.seat.split('-').map(Number) as [number, number];
      // 2026-11-23（D223）：班級色不再用在座位表，補考座位表一律白底（舊班靠格內「舊班｜學號」文字分辨）
      const col = { bg: 'FFFFFF', line: '222222', fg: '22201B' };
      cells.set(x.seat, { coord: seatLabel({ row: r, depth: d }), seat: { row: r, depth: d }, code: pad2(x.oldSeat), classLabel: x.oldClass, name: x.studentId, colorBg: col.bg, colorLine: col.line, colorFg: col.fg, tags: [], marks: [] });
    }
    const sheet = roll.get(`${t.slotId}@@${t.roomId}`);
    const per = classes.map((k) => t.seats.filter((x) => x.oldClass === k).length);
    pages.push(addSeatLegend({
      kind: 'seat',
      title: `${i.title}　補考座位表`,
      examName: i.title,
      heading: `${i.title}　補考座位表`,
      roomName: sheet?.roomName ?? c.roomName(t.roomId),
      chips: [`${c.dayLabel(s.dayId)} ${slotName(s)} ${slotTime(s)}`, `共 ${t.seats.length} 人`, '現場自由入座，本表僅供檢核每個人都有座位'],
      detachStyle: false,
      rows: room.rows,
      depth: room.depth,
      cells,
      usable,
      stats: { perClass: classes.map((k, n) => ({ className: k, count: per[n]! })), total: t.seats.length, perSubject: [], table: { classes, headLabel: '補考人數', rows: [{ label: '本場人數', per, total: t.seats.length }] } },
    }));
  }
  return pages;
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
