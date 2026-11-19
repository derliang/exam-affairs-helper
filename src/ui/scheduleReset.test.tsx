/** #364、D156、D158④：節次與時長「還原預設」常駐可按、主色外框、先確認；「↶ 復原」涵蓋它（程式端查證）。全部假資料。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { removeRow, scheduleOf, withSchedule } from '../core/periods';
import { describeChange } from './describeChange';
import { confirmCopy } from './flow';
import { ScheduleTab } from './pages/Schedule';
import { demoDoc } from './repository';
import { canUndo, commit, newHistory, nextUndoLabel, undo } from './undo';

const noop = () => undefined;

describe('還原預設按鈕', () => {
  it('與預設相同（沒改過）時也不停用，樣式是主色外框', () => {
    const html = renderToString(<ScheduleTab doc={demoDoc()} onChange={noop} />);
    const m = html.match(/<button[^>]*>↺ 還原「學測第 1、2 次」預設<\/button>/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('disabled');
    expect(m![0]).toContain('btn-accent-outline');
    expect(html).not.toContain('已是預設值'); // 沒按過確認前不顯示
  });
  it('改過之後同樣可按', () => {
    const doc = demoDoc();
    const t = removeRow(scheduleOf(doc.settings, 'g12'), { day: 1, index: 0 });
    const changed = { ...doc, settings: withSchedule(doc.settings, 'g12', t) };
    const html = renderToString(<ScheduleTab doc={changed} onChange={noop} />);
    expect(html.match(/<button[^>]*>↺ 還原「學測第 1、2 次」預設<\/button>/)![0]).not.toContain('disabled');
  });
  it('確認文案：改過→會被取代並提示可復原；與預設相同→不會有任何變更', () => {
    const a = confirmCopy.resetSchedule('分科', false);
    expect(a.body).toContain('要把「分科」的節次與時長還原成預設嗎？你改過的科目與時長會被取代');
    expect(a.body).toContain('↶ 復原');
    const b = confirmCopy.resetSchedule('分科', true);
    expect(b.body).toBe('目前已與預設相同，不會有任何變更。');
  });
});

describe('「↶ 復原」涵蓋還原預設（App 的 edit＝commit(describeChange)）', () => {
  it('還原預設是一步可復原的動作：復原後回到改過的節次表', () => {
    const doc = demoDoc();
    const t = removeRow(scheduleOf(doc.settings, 'ast'), { day: 1, index: 0 });
    const changed = { ...doc, settings: withSchedule(doc.settings, 'ast', t) };
    expect(describeChange(doc, changed)).toBe('修改節次與時長');
    let h = newHistory(changed);
    const restored = { ...changed, settings: withSchedule(changed.settings, 'ast', undefined) };
    expect(describeChange(changed, restored)).toBe('修改節次與時長');
    h = commit(h, restored, describeChange(h.present, restored));
    expect(h.present.settings.schedules?.ast).toBeUndefined();
    expect(canUndo(h)).toBe(true);
    expect(nextUndoLabel(h)).toBe('修改節次與時長');
    h = undo(h);
    expect(h.present.settings.schedules?.ast).toEqual(t);
  });
  it('已與預設相同時還原預設不改資料，也不多記一步', () => {
    const doc = demoDoc();
    const same = { ...doc, settings: withSchedule(doc.settings, 'ast', undefined) };
    const h = commit(newHistory(doc), same, describeChange(doc, same));
    expect(canUndo(h)).toBe(false);
  });
});
