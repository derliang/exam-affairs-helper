/** #552：補考 ① 不再有「座位標籤（O-6）產生」開關（⑦ 寫尚未提供、沒有輸出，開關是空的）；文案前後一致。全部假資料。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { MkStep1 } from './pages/MkStep1';
import { MkStep7 } from './pages/MkStep7';
import { fakeSession, rooms } from './testKit';

const noop = () => undefined;
describe('補考 O-6 座位標籤（#552、D193）', () => {
  it('① 沒有產生座位標籤的開關，座位表（O-5）開關仍在，並說明標籤尚未提供', () => {
    const h = renderToString(<MkStep1 s={fakeSession({ rooms: rooms(6), id: 'mk-552' })} onChange={noop} />);
    expect(h).not.toContain('產生座位標籤');
    expect(h).toContain('產生座位表');
    expect(h).toContain('座位標籤（O-6）這一版尚未提供');
  });
  it('⑦ 維持「這一版尚未提供」', () => {
    const h = renderToString(<MkStep7 s={fakeSession({ rooms: rooms(6), id: 'mk-552' })} onStep={noop} />);
    expect(h).toContain('這一版尚未提供');
  });
});
