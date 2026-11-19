/**
 * G36 補做項 ②：考前對帳 M-5（自習容量）與第 3、4、5 步的自習容量計算用同一組數字（數字相等測試）。
 * 學測：M-5 的「上限」＝studyCapacity.avail、「使用」＝最吃緊時段需要的座位、紅燈＝容量不足。
 * 分科：M-5 的「上限」＝astCapacity.study.capacity、「使用」＝study.need、紅燈＝有時段不足或排不進。
 * 全部匿名假資料（reconcileFixtures）。
 */
import { describe, expect, it } from 'vitest';
import { astCapacity, astPlan } from './ast/model';
import { astOutputs } from './ast/output';
import { studyCapacity } from './capacity';
import { reconcile } from './reconcile';
import { astDoc, gsat270Doc, gsatDoc } from './reconcileFixtures';
import type { Doc } from './store';
import type { ExamConfig } from '../data';

const m5Of = (r: ReturnType<typeof reconcile>) => {
  if (r.state !== 'ready') throw new Error(`對帳沒有就緒：${r.state}`);
  return r.checks.find((c) => c.id === 'M-5')!;
};

describe('G36 ② M-5 與自習容量同一組數字（學測）', () => {
  const cases: [string, () => { doc: Doc; exam: ExamConfig }][] = [
    ['gsatDoc', () => gsatDoc()],
    ['gsatDoc 有未參加者', () => gsatDoc({ absentRoster: 2 })],
    ['gsat270', () => gsat270Doc()],
    ['gsat270 國中部', () => gsat270Doc({ junior: true })],
    ['gsat270 數B全不考', () => gsat270Doc({ libMathB: 'none' })],
    ['gsat270 未參加＋全科缺考、兩間預備教室', () => gsat270Doc({ notJoined: 4, fullyAbsent: 2, reserve2: true })],
  ];
  for (const [name, make] of cases) {
    it(name, () => {
      const { doc, exam } = make();
      const cap = studyCapacity(doc, exam);
      const m5 = m5Of(reconcile(doc, exam));
      if (!cap.applicable) { expect(m5.light).toBe('na'); return; }
      expect(m5.a).toBe(cap.avail);
      expect(m5.b).toBe(cap.worst?.seatsNeed ?? 0);
      expect(m5.light === 'fail').toBe(!cap.ok);
    });
  }
});

describe('G36 ② M-5 與自習容量同一組數字（分科）', () => {
  // (12,2,2)：綜合教室只有 2 座，自習位置不足（紅燈案例）
  for (const a of [[12, 12, 5], [12, 4, 5], [10, 12, 3], [8, 30, 2], [12, 2, 2]] as const) {
    it(`astDoc(${a.join(',')})`, () => {
      const { doc, exam } = astDoc(...a);
      const plan = astPlan(doc, exam)!;
      const cp = astCapacity(doc, exam, plan);
      const m5 = m5Of(reconcile(doc, exam, astOutputs(doc, exam, plan, 'B4')));
      expect(m5.a).toBe(cp.study.capacity);
      expect(m5.b).toBe(cp.study.need);
      expect(m5.light === 'fail').toBe(cp.study.slotsShort > 0 || plan.unplaced > 0 || cp.study.need > cp.study.capacity);
      if (a[1] === 2) expect(m5.light).toBe('fail');
    });
  }
});
