/** D180（U-4）：教室設定不再讓人標「混班」；舊存檔的 mixed 讀回來當一般教室 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { MkStep3 } from './pages/MkStep3';
import { reviveSession } from './session';
import { fakeSession, rooms } from './testKit';

describe('U-4 教室設定', () => {
  const noop = () => undefined;
  it('畫面只有「一般／特別」兩種，說明混班由系統自動挑；不再有「暫定 U-4」', () => {
    const html = renderToString(<MkStep3 s={fakeSession({ rooms: rooms(2) })} onChange={noop} />);
    expect(html).toContain('混班教室由系統自動挑');
    expect(html).not.toContain('暫定 U-4');
    expect(html).not.toContain('由你在這裡標記');
    expect(html).not.toMatch(/>混班</);
  });
  it('舊存檔的 mixed 讀回來是 class，其他不動', () => {
    const s = fakeSession({ rooms: rooms(2) });
    const old = { ...s, rooms: s.rooms.map((r, i) => ({ ...r, use: (i === 0 ? 'mixed' : 'special') as 'mixed' | 'special' })) };
    expect(reviveSession(JSON.parse(JSON.stringify(old))).rooms.map((r) => r.use)).toEqual(['class', 'special']);
  });
});
