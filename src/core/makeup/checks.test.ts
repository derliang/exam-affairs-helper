import { describe, expect, it } from 'vitest';
import { HEADER, fakeRow, fakeSettings, room, runAll } from './fixtures';
import {
  buildOutputs,
  buildSchedule,
  downloadGate,
  makeupEntries,
  makeupVersion,
  parseMakeupSheet,
  resolveMakeup,
  runMakeupChecks,
  type CheckResult,
  type MakeupCheckInput,
  type MakeupOutputs,
  type MakeupSchedule,
} from './index';

/** 假名單：兩班高中、一班初中、一位 4 科生（提前開考）、一位只有另行通知科目 */
function setup() {
  const rows: string[][] = [HEADER];
  let id = 0;
  const add = (cls: string, seat: number, subs: string[], attr = '0') => {
    const sid = `9${String(++id).padStart(5, '0')}`;
    for (const s of subs) rows.push(fakeRow(sid, cls, seat, s, attr));
  };
  for (let i = 1; i <= 12; i++) add('101', i, i <= 3 ? ['數學', '英文'] : ['數學']);
  for (let i = 1; i <= 12; i++) add('102', i, i <= 2 ? ['英文', '國文'] : ['英文']);
  add('102', 30, ['數學', '英文', '化學', '物理']);
  for (let i = 1; i <= 4; i++) add('701', i, ['數學']);
  add('701', 9, ['生命教育'], '1');
  rows.push(fakeRow('900002', '101', 2, '生涯規劃', '1'));
  rows.push(fakeRow('900099', '101', 40, '數學', '0', '')); // 問題列（缺姓名）：使用者選略過，C-1 用
  const parse = parseMakeupSheet(rows);
  const roster = resolveMakeup(parse, [{ rowId: String(rows.length), action: 'skip', reason: 'not-target' }]);
  const settings = fakeSettings(roster, [room(30, 'class', '高一溫室'), room(30, 'class', '高一良室'), room(40, 'mixed', '綜合教室一'), room(8, 'special', '特別教室')]);
  const all = runAll(roster, settings);
  const input: MakeupCheckInput = { roster, settings, plan: all.plan, outputs: all.outputs, currentVersion: makeupVersion(roster, settings, all.plan) };
  return { parse, roster, settings, ...all, input };
}

const byId = (cs: CheckResult[], id: string) => cs.find((c) => c.id === id) as CheckResult;
const clone = <T>(x: T): T => structuredClone(x);
const withOutputs = (input: MakeupCheckInput, f: (o: MakeupOutputs) => void): MakeupCheckInput => {
  const o = clone(input.outputs);
  f(o);
  return { ...input, outputs: o };
};
const fromSchedule = (base: ReturnType<typeof setup>, f: (s: MakeupSchedule) => void): MakeupCheckInput => {
  const s = clone(base.schedule);
  f(s);
  return { ...base.input, outputs: buildOutputs(s, base.entries, base.settings) };
};

describe('檢核基準：正常排程全綠（C-11 有提前開考 → 琥珀、C-14 待執行）', () => {
  const b = setup();
  const cs = runMakeupChecks(b.input);
  it.each(['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-12', 'C-13', 'C-15'])('%s 綠燈', (id) => {
    expect(byId(cs, id).status, byId(cs, id).summary).toBe('green');
    expect(byId(cs, id).diff).toBe(0);
  });
  it('C-11 琥珀：提前開考學生離場時間已印在點名單註欄、考程表、公告', () => {
    const c = byId(cs, 'C-11');
    expect(c.status).toBe('amber');
    expect(c.expected).toBe(1);
    expect(c.actual).toBe(1);
  });
  it('C-14 待執行：還沒有檔可回讀', () => expect(byId(cs, 'C-14').status).toBe('pending'));
  it('每項都有應有／實有／差異', () => {
    for (const c of cs) expect(c.diff).toBe(c.actual - c.expected);
  });
  it('C-1：略過要有原因並出現在明細；C-2 計入「全為另行通知」的學生', () => {
    expect(byId(cs, 'C-1').details.some((d) => d.text.includes('非補考對象'))).toBe(true);
    expect(byId(cs, 'C-2').summary).toContain('全為另行通知 1');
  });
});

describe('各項紅燈案例', () => {
  const b = setup();

  it('C-1：有未處理的問題列 → 紅', () => {
    const roster = resolveMakeup(b.parse); // 不處理那一列
    const c = byId(runMakeupChecks({ ...b.input, roster }), 'C-1');
    expect(c.status).toBe('red');
  });

  it('C-1：列數對不上（匯入列數被改）→ 紅', () => {
    const c = byId(runMakeupChecks({ ...b.input, roster: { ...b.roster, rawCount: b.roster.rawCount + 1 } }), 'C-1');
    expect(c).toMatchObject({ status: 'red', diff: -1 });
  });

  it('C-2／C-3：拿掉一位單科生 → 都紅，明細列出他', () => {
    const victim = b.schedule.sittings.find((x) => x.subjects.length === 1 && x.leaveAt === undefined && b.schedule.sittings.filter((y) => y.studentId === x.studentId).length === 1);
    const input = fromSchedule(b, (s) => (s.sittings = s.sittings.filter((x) => x.studentId !== victim?.studentId)));
    const cs = runMakeupChecks(input);
    expect(byId(cs, 'C-2').status).toBe('red');
    expect(byId(cs, 'C-2').details[0]?.studentId).toBe(victim?.studentId);
    expect(byId(cs, 'C-3')).toMatchObject({ status: 'red', diff: -1 });
  });

  it('C-3：重複排一筆 → 紅', () => {
    const input = fromSchedule(b, (s) => s.sittings.push({ ...(s.sittings[0] as MakeupSchedule['sittings'][number]), roomId: s.sittings[s.sittings.length - 1]?.roomId as string }));
    expect(byId(runMakeupChecks(input), 'C-3').status).toBe('red');
  });

  it('C-4：點名單表尾統計被改 → 紅', () => {
    const input = withOutputs(b.input, (o) => {
      const s = o.rollCalls[0] as MakeupOutputs['rollCalls'][number];
      const k = Object.keys(s.paperTotals)[0] as string;
      s.paperTotals[k] = (s.paperTotals[k] ?? 0) + 1;
    });
    expect(byId(runMakeupChecks(input), 'C-4').status).toBe('red');
  });

  it('C-5：超額一間教室（座位改少）→ 紅', () => {
    const big = b.outputs.rollCalls.reduce((m, s) => (s.rows.length > m.rows.length ? s : m));
    const settings = clone(b.settings);
    const r = settings.rooms.find((x) => x.id === big.roomId);
    if (r) r.seatCount = big.rows.length - 1;
    const c = byId(runMakeupChecks({ ...b.input, settings }), 'C-5');
    expect(c).toMatchObject({ status: 'red', actual: 1 });
  });

  it('C-5：同一間教室重疊時間被兩個時段使用 → 紅', () => {
    const input = withOutputs(b.input, (o) => {
      const junior = o.rollCalls.find((s) => s.slotId.startsWith('D1-junior'));
      const senior = o.rollCalls.find((s) => s.slotId === 'D1-senior#0');
      if (junior && senior) junior.roomId = senior.roomId;
    });
    expect(byId(runMakeupChecks(input), 'C-5').status).toBe('red');
  });

  it('C-6：座位重複、沒有座位、座位不在教室 → 紅', () => {
    for (const mutate of [
      (o: MakeupOutputs) => {
        const t = o.seatTables[0] as MakeupOutputs['seatTables'][number];
        (t.seats[1] as { seat: string | null }).seat = t.seats[0]?.seat ?? null;
      },
      (o: MakeupOutputs) => ((o.seatTables[0]?.seats[0] as { seat: string | null }).seat = null),
      (o: MakeupOutputs) => ((o.seatTables[0]?.seats[0] as { seat: string | null }).seat = '9-9'),
      (o: MakeupOutputs) => o.seatTables[0]?.seats.pop(),
    ]) {
      expect(byId(runMakeupChecks(withOutputs(b.input, mutate)), 'C-6').status).toBe('red');
    }
  });

  it('C-7：同一學生同時段兩個獨立科 → 紅', () => {
    const entries = makeupEntries(b.roster);
    const plan = clone(b.plan);
    const g = plan.groups.find((x) => x.groupId === 'D1-senior');
    if (g) {
      g.slots = [['數學', '英文']];
      g.combined = g.combined.filter((s) => s !== '數學' && s !== '英文');
      g.combined.push('化學');
      g.slots.push(['國文']);
    }
    const s = buildSchedule(entries, b.settings, plan);
    const c = byId(runMakeupChecks({ ...b.input, plan, outputs: buildOutputs(s, entries, b.settings) }), 'C-7');
    expect(c.status).toBe('red');
    expect(c.details.some((d) => d.text.includes('數學') && d.text.includes('英文'))).toBe(true);
  });

  it('C-7：同一學生在重疊時間出現在兩間教室 → 紅', () => {
    const input = fromSchedule(b, (s) => {
      const x = s.sittings.find((y) => y.slotId === 'D1-senior#0') as MakeupSchedule['sittings'][number];
      const y = s.sittings.find((z) => z.slotId === 'D1-junior#0') as MakeupSchedule['sittings'][number];
      y.studentId = x.studentId;
    });
    expect(byId(runMakeupChecks(input), 'C-7').status).toBe('red');
  });

  it('C-8：改掉一份公告的地點、刪掉一列 → 紅', () => {
    const moved = withOutputs(b.input, (o) => {
      const r = o.announcements[0]?.rows[0];
      if (r) r.roomId = 'nowhere';
    });
    expect(byId(runMakeupChecks(moved), 'C-8').status).toBe('red');
    const dropped = withOutputs(b.input, (o) => o.announcements[0]?.rows.pop());
    expect(byId(runMakeupChecks(dropped), 'C-8')).toMatchObject({ status: 'red', diff: -1 });
  });

  it('C-9：點名單出現名單外的學號 → 紅', () => {
    const input = withOutputs(b.input, (o) => {
      const r = o.rollCalls[0]?.rows[0];
      if (r) r.studentId = '999999';
    });
    expect(byId(runMakeupChecks(input), 'C-9').status).toBe('red');
  });

  it('C-10：備卷份數少一份、多科生卷數≠科數 → 紅', () => {
    const fewer = withOutputs(b.input, (o) => ((o.papers[0] as { count: number }).count -= 1));
    expect(byId(runMakeupChecks(fewer), 'C-10').status).toBe('red');
    const wrongCount = withOutputs(b.input, (o) => {
      const r = o.rollCalls.flatMap((s) => s.rows).find((x) => x.subjects.length > 1);
      if (r) r.paperCount = 1;
    });
    expect(byId(runMakeupChecks(wrongCount), 'C-10').status).toBe('red');
  });

  it('C-11：點名單註欄沒印離場時間、或印錯時間 → 紅（算不出來／沒印視同不通過）', () => {
    const blank = withOutputs(b.input, (o) => {
      const r = o.rollCalls.find((s) => s.kind === 'early')?.rows[0];
      if (r) r.note = '';
    });
    expect(byId(runMakeupChecks(blank), 'C-11').status).toBe('red');
    const wrong = withOutputs(b.input, (o) => {
      for (const n of o.timetableNotes) n.text = n.text.replace(/\d\d:\d\d/, '08:00');
    });
    expect(byId(runMakeupChecks(wrong), 'C-11').status).toBe('red');
  });

  it('C-11／C-12：沒有提前開考學生 → 綠', () => {
    const plan = clone(b.plan);
    plan.groups.forEach((g) => (g.early = []));
    const s = buildSchedule(b.entries, b.settings, plan);
    const cs = runMakeupChecks({ ...b.input, plan, outputs: buildOutputs(s, b.entries, b.settings) });
    expect(byId(cs, 'C-11').status).toBe('green');
    expect(byId(cs, 'C-12').status).toBe('green');
  });

  it('C-12：總作答超過上限 → 琥珀', () => {
    const settings = clone(b.settings);
    settings.early.capMin = 150;
    expect(byId(runMakeupChecks({ ...b.input, settings }), 'C-12').status).toBe('amber');
  });

  it('C-13：被拆班 → 琥珀；提前開考學生不算被拆班（D123）', () => {
    expect(byId(runMakeupChecks(b.input), 'C-13').status).toBe('green'); // 102 有一位提前開考在特別教室，不算拆班
    const input = fromSchedule(b, (s) => {
      const list = s.sittings.filter((x) => x.slotId === 'D1-senior#0' && x.oldClass === '101');
      const other = b.settings.rooms.find((r) => r.id !== list[0]?.roomId && r.use !== 'special');
      if (list[0] && other) list[0].roomId = other.id;
    });
    const c = byId(runMakeupChecks(input), 'C-13');
    expect(c).toMatchObject({ status: 'amber', actual: 1 });
  });

  it('C-14：回讀一致 → 綠；少一筆或版本不同 → 紅', () => {
    const total = b.roster.included.length;
    const v = b.input.currentVersion as string;
    expect(byId(runMakeupChecks({ ...b.input, readback: [{ file: '點名單.docx', total, version: v }] }), 'C-14').status).toBe('green');
    expect(byId(runMakeupChecks({ ...b.input, readback: [{ file: '點名單.docx', total: total - 1 }] }), 'C-14').status).toBe('red');
    expect(byId(runMakeupChecks({ ...b.input, readback: [{ file: '公告.docx', total, version: 'XXXX-XXXX-XXXX' }] }), 'C-14').status).toBe('red');
    expect(byId(runMakeupChecks({ ...b.input, readback: [{ file: '備卷.docx', total, byPaper: { '高一 數學': 1 } }] }), 'C-14').status).toBe('red');
  });

  it('C-15：已產出的檔版本不是目前版本 → 琥珀；名單一改版本碼就變', () => {
    const v = b.input.currentVersion as string;
    expect(byId(runMakeupChecks({ ...b.input, produced: [{ file: 'a.docx', version: v }] }), 'C-15').status).toBe('green');
    const roster2 = { ...b.roster, included: b.roster.included.slice(1) };
    const v2 = makeupVersion(roster2, b.settings, b.plan);
    expect(v2).not.toBe(v);
    expect(byId(runMakeupChecks({ ...b.input, produced: [{ file: 'a.docx', version: v }], currentVersion: v2 }), 'C-15').status).toBe('amber');
  });

  it('任何一項算不出來（例外）視同不通過', () => {
    const broken = { ...b.input, outputs: { ...b.input.outputs, papers: null as unknown as MakeupOutputs['papers'] } };
    const cs = runMakeupChecks(broken);
    expect(byId(cs, 'C-4').status).toBe('red');
    expect(byId(cs, 'C-4').summary).toContain('算不出來');
  });
});

describe('下載閘門（6.2、D153：紅燈不可放行、琥珀只提示不擋、C-14 待執行不擋）', () => {
  const b = setup();
  const cs = runMakeupChecks(b.input);

  it('只有琥珀 → 可下載（不用確認），琥珀列在 warnings 只提示', () => {
    const g = downloadGate(cs);
    expect(g.allowed).toBe(true);
    expect(g.blockers).toEqual([]);
    expect(g.warnings.map((c) => c.id)).toEqual(['C-11']);
  });

  it('紅燈即使「確認」也不可放行', () => {
    const red = cs.map((c) => (c.id === 'C-3' ? { ...c, status: 'red' as const } : c));
    const g = downloadGate(red);
    expect(g.allowed).toBe(false);
    expect(g.blockers.map((c) => c.id)).toEqual(['C-3']);
  });

  it('C-14 以外的項目「待執行」或缺項 → 視同不通過', () => {
    const pending = cs.map((c) => (c.id === 'C-5' ? { ...c, status: 'pending' as const } : c));
    expect(downloadGate(pending).blockers.map((c) => c.id)).toEqual(['C-5']);
    const missing = cs.filter((c) => c.id !== 'C-9');
    expect(downloadGate(missing).blockers.map((c) => c.id)).toEqual(['C-9']);
  });
});
