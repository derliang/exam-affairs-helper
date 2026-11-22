/** #612：改過班級順序（▲▼）後，匯入檔的班名仍要對到該班級（依編號），不是清單位置 */
import { describe, expect, it } from 'vitest';
import { gsatDoc } from './reconcileFixtures';
import { moveClass } from './store';
import { classNamesByNo } from './classNames';
import { parseExamWorkbook, parseRosterWorkbook } from './step2';

const examRows = [['班級', '座號', '姓名', '組別'], ['溫', '1', '測試溫01', '0-全科'], ['良', '1', '測試良01', '0-全科'], ['恭', '1', '測試恭01', '0-全科']];
const rosterRows = [['班級', '座號', '姓名'], ['溫', '1', '測試溫01'], ['良', '1', '測試良01'], ['恭', '1', '測試恭01']];

describe('#612 班名依編號對應', () => {
  it('classNamesByNo：索引＝編號−1，不受清單順序影響', () => {
    const { doc } = gsatDoc();
    const moved = moveClass(doc, 'senior', 3, -1); // 溫、恭、良
    expect(moved.settings.classes.map((c) => c.name)).toEqual(['溫', '恭', '良']);
    expect(classNamesByNo(moved.settings.classes, 'senior')).toEqual(['溫', '良', '恭']);
  });
  for (const moveIt of [false, true]) {
    it(`考試名單匯入：${moveIt ? '改過' : '沒改'}班級順序，班別不變`, () => {
      const { doc, exam } = gsatDoc();
      const d = moveIt ? moveClass(doc, 'senior', 3, -1) : doc;
      const r = parseExamWorkbook([{ name: 's', rows: examRows }], exam, classNamesByNo(d.settings.classes, exam.division));
      expect(r.entries.map((e) => [e.classNo, e.name])).toEqual([[1, '測試溫01'], [2, '測試良01'], [3, '測試恭01']]);
    });
    it(`學生名單匯入：${moveIt ? '改過' : '沒改'}班級順序，班別不變`, () => {
      const { doc } = gsatDoc();
      const d = moveIt ? moveClass(doc, 'senior', 3, -1) : doc;
      const r = parseRosterWorkbook([{ name: 's', rows: rosterRows }], classNamesByNo(d.settings.classes, 'senior'));
      expect(r.students.map((s) => [s.classNo, s.name])).toEqual([[1, '測試溫01'], [2, '測試良01'], [3, '測試恭01']]);
    });
  }
});

describe('#612 守門：匯入入口不得再用清單順序組班名表', () => {
  it('Step2／RosterIO／QuickPanel 都走 classNamesByNo', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['Step2', 'RosterIO', 'QuickPanel']) {
      const src = readFileSync(`src/ui/pages/${f}.tsx`, 'utf8');
      expect(src, f).toContain('classNamesByNo(');
      expect(src, f).not.toMatch(/classes\.filter\([^)]*\)\.map\(\(c\) => c\.name\)/);
    }
  });
});
