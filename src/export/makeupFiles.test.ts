/**
 * 補考產出紙面與回讀驗算（K4）：全部假資料。
 * 重點：下載檔回讀點出的人次、各卷、版本碼、離場時間與排程一致（C-14）；刻意弄壞產出模型一定被抓到；
 * 公告版不印姓名；依考日下載各自對得起來。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fakeRoster, fakeSettings, room, runAll, type FakeClass } from '../core/makeup/fixtures';
import { makeupVersion, runMakeupChecks, type MakeupOutputs } from '../core/makeup';
import { MAKEUP_DOC_KINDS, countMakeupPrintPages, produceMakeupFiles, produceMakeupMergedPrintHtml, produceMakeupPrintHtml, type ProduceMakeupInput } from './makeupFiles';
import { readDocxTables } from './makeupReadback';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const generatedAt = '2026-11-18T08:30:00Z';
// 每份 Word 都要嵌入字型，單項測試比一般慢
vi.setConfig({ testTimeout: 60000 });

function build(seed: number, twoDays = false): ProduceMakeupInput {
  const classes: FakeClass[] = [
    { oldClass: '高一溫', students: 22 },
    { oldClass: '高一良', students: 18 },
    { oldClass: '高二溫', students: 15 },
    { oldClass: '801', students: 12 },
    ...(twoDays ? [{ oldClass: '高三溫', students: 9 }] : []),
  ];
  const roster = fakeRoster({ seed, classes, maxSubjects: 5, notifyOnlyPerClass: 1, notifyExtraRatio: 0.2 });
  const rooms = [room(20, 'special'), room(40, 'mixed'), room(40), room(40), room(36)];
  const settings = fakeSettings(roster, rooms);
  if (twoDays) {
    settings.days.push({ id: 'D0', label: '1/16（六）' });
    settings.groups = settings.groups.map((g) => (g.grades.includes('S3') ? { ...g, grades: g.grades.filter((x) => x !== 'S3') } : g)).filter((g) => g.grades.length);
    settings.groups.push({ id: 'D0-S3', dayId: 'D0', label: '高三', grades: ['S3'], start: 480, periodMin: 50, breakMin: 10 });
  }
  const all = runAll(roster, settings);
  return { title: '115 學年第一學期補考', settings, roster, ...all };
}

const opts = { fonts, generatedAt };

describe('補考下載檔：產生後回讀，與排程一致', () => {
  for (const seed of [3, 7, 11, 19]) {
    it(`種子 ${seed}：每份檔回讀人次、各卷、版本碼、頁尾總人次都對，C-14 全綠`, async () => {
      const input = build(seed);
      const out = await produceMakeupFiles(input, opts);
      expect(out.files.map((f) => f.kind)).toEqual(expect.arrayContaining(['O-1', 'O-2', 'O-3', 'O-3t', 'O-4', 'O-5', 'O-7']));
      for (const v of out.verification) expect(v.problems, v.file).toEqual([]);
      expect(out.ok).toBe(true);
      expect(out.total).toBe(input.entries.length);
      // 回讀交給 C-14：不含 O-5（座位數不是人次）
      expect(out.readback).toHaveLength(out.files.length - 1);
      const currentVersion = makeupVersion(input.roster, input.settings, input.plan);
      const checks = runMakeupChecks({ roster: input.roster, settings: input.settings, plan: input.plan, outputs: input.outputs!, readback: out.readback, produced: out.produced, currentVersion });
      const c14 = checks.find((c) => c.id === 'C-14')!;
      expect(c14.status, c14.details.map((d) => d.text).join('；')).toBe('green');
      expect(checks.find((c) => c.id === 'C-15')!.status).toBe('green');
    });
  }

  it('每個學生每一科都印在點名單與公告上（用回讀的格子，不看模型）', async () => {
    const input = build(5);
    const out = await produceMakeupFiles(input, { ...opts, kinds: ['O-3', 'O-4'] });
    const roll = new Set<string>();
    const ann = new Set<string>();
    for (const f of out.files) {
      const { tables } = await readDocxTables(f.docx);
      for (const t of tables) {
        for (const r of t.slice(1)) {
          if (f.kind === 'O-4' && r[0] !== '統計') for (const s of r[4]!.split('、')) roll.add(`${r[0]}|${s}`);
          if (f.kind === 'O-3') ann.add(`${r[2]}|${r[3]}`);
        }
      }
    }
    const want = new Set(input.entries.map((e) => `${e.studentId}|${e.subject}`));
    expect(roll).toEqual(want);
    expect(ann).toEqual(want);
  });
});

describe('刻意弄壞產出模型，回讀一定抓到', () => {
  it('點名單少了一位學生：回讀人次與排程不同，C-14 紅燈', async () => {
    const input = build(7);
    const bad: MakeupOutputs = structuredClone(input.outputs!);
    bad.rollCalls[0]!.rows.pop();
    const out = await produceMakeupFiles({ ...input, outputs: bad }, opts);
    const v = out.verification.find((x) => x.kind === 'O-4')!;
    expect(v.ok).toBe(false);
    expect(out.ok).toBe(false);
    const currentVersion = makeupVersion(input.roster, input.settings, input.plan);
    const c14 = runMakeupChecks({ roster: input.roster, settings: input.settings, plan: input.plan, outputs: bad, readback: out.readback, produced: out.produced, currentVersion }).find((c) => c.id === 'C-14')!;
    expect(c14.status).toBe('red');
  });

  it('備卷份數少一份、公告少一列，各自被抓到', async () => {
    const input = build(7);
    const bad: MakeupOutputs = structuredClone(input.outputs!);
    bad.papers[0]!.count -= 1;
    bad.announcements[0]!.rows.pop();
    const out = await produceMakeupFiles({ ...input, outputs: bad }, opts);
    expect(out.verification.find((x) => x.kind === 'O-1')!.ok).toBe(false);
    expect(out.verification.find((x) => x.kind === 'O-3')!.ok).toBe(false);
    expect(out.verification.find((x) => x.kind === 'O-3t')!.ok).toBe(false);
  });

  it('座位表有人沒座位：被抓到', async () => {
    const input = build(7);
    const bad: MakeupOutputs = structuredClone(input.outputs!);
    bad.seatTables[0]!.seats[0]!.seat = null;
    const out = await produceMakeupFiles({ ...input, outputs: bad }, { ...opts, kinds: ['O-5'] });
    expect(out.verification[0]!.problems.join()).toContain('沒有座位');
  });
});

describe('公告：公告版不印姓名、導師存參版行數相同', () => {
  it('公告版任何格子都不是姓名；存參版有姓名、行數與公告版相同', async () => {
    const input = build(5);
    const out = await produceMakeupFiles(input, { ...opts, kinds: ['O-3', 'O-3t'] });
    const names = new Set(input.entries.map((e) => e.name));
    const rows = async (kind: string) => {
      const f = out.files.find((x) => x.kind === kind)!;
      return (await readDocxTables(f.docx)).tables.flatMap((t) => t.slice(1));
    };
    const pub = await rows('O-3');
    const tea = await rows('O-3t');
    expect(pub.length).toBe(tea.length);
    for (const r of pub) for (const c of r) expect(names.has(c), `公告版出現姓名 ${c}`).toBe(false);
    expect(tea.every((r) => names.has(r[2]!))).toBe(true);
  });
});

describe('提前開考：離場時間印在點名單註欄、公告、考程表', () => {
  it('有提前開考學生時，三處都印「HH:MM 前不得離場」且與排程一致', async () => {
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      if (found > 0) break;
      const input = build(seed);
      if (input.schedule.early.length === 0) continue;
      found++;
      const out = await produceMakeupFiles(input, { ...opts, kinds: ['O-2', 'O-3', 'O-4'] });
      for (const v of out.verification) expect(v.problems, v.file).toEqual([]);
      const t = (await readDocxTables(out.files.find((f) => f.kind === 'O-2')!.docx)).text;
      expect(t).toMatch(/\d{2}:\d{2} 前不得離場/);
      const o4 = (await readDocxTables(out.files.find((f) => f.kind === 'O-4')!.docx)).tables.flat(2).join(' ');
      expect(o4).toMatch(/\d{2}:\d{2} 前不得離場/);
      expect(o4).not.toContain('最早離場');
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('多考日：依考日下載', () => {
  it('每個考日各自對得起來，兩天人次相加＝全場次；全場次檔也全綠', async () => {
    const input = build(5, true);
    const all = await produceMakeupFiles(input, opts);
    expect(all.ok).toBe(true);
    let sum = 0;
    for (const d of input.settings.days) {
      const out = await produceMakeupFiles(input, { ...opts, dayId: d.id });
      for (const v of out.verification) expect(v.problems, v.file).toEqual([]);
      expect(out.readback).toEqual([]);
      expect(out.files.every((f) => f.name.includes(d.label.replace(/[\/:*?"<>|（）() ]/g, '')))).toBe(true);
      sum += out.total;
    }
    expect(sum).toBe(all.total);
  });
});

describe('PDF 用列印 HTML：同樣回讀驗算', () => {
  it('每種文件的列印頁回讀都和排程一致', () => {
    const input = build(5);
    for (const kind of MAKEUP_DOC_KINDS) {
      const r = produceMakeupPrintHtml(input, kind, { generatedAt });
      expect(r, kind).not.toBeNull();
      expect(r!.verification.problems, r!.name).toEqual([]);
    }
  });
});

describe('#592 多份文件併成單一列印頁', () => {
  it('頁數＝各份相加、只有一份 html、各份驗算無問題', () => {
    const input = build(5);
    const r = produceMakeupMergedPrintHtml(input, MAKEUP_DOC_KINDS, { generatedAt });
    expect(r).not.toBeNull();
    expect(r!.problems).toEqual([]);
    const sum = MAKEUP_DOC_KINDS.reduce((a, k) => a + (produceMakeupPrintHtml(input, k, { generatedAt }) ? 1 : 0), 0);
    expect(r!.kinds.length).toBe(sum);
    expect(r!.pages).toBe(countMakeupPrintPages(input, MAKEUP_DOC_KINDS));
    expect(r!.html.match(/<!doctype html>/g)?.length).toBe(1);
    expect(r!.pages).toBeGreaterThan(MAKEUP_DOC_KINDS.length - 1);
  });
  it('沒勾任何文件回 null', () => {
    expect(produceMakeupMergedPrintHtml(build(5), [], { generatedAt })).toBeNull();
  });
});
