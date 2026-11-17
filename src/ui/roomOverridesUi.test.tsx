// #210 畫面：步驟③「本次調整座位」「本次專用」「還原成共用設定」
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { RoomList } from './components/RoomList';

const room: Classroom = { id: 'room-1', name: '試場3', kind: 'class', rows: 6, depth: 7, seatCount: 42, track: 'science', division: 'senior' };
const base = { rooms: [room], paper: 'B4' as const, onChange: () => {}, selected: ['room-1'], onSelect: () => {} };

describe('RoomList：本次調整座位', () => {
  it('勾選的教室有「本次調整座位」；沒有覆寫時沒有標記與還原鈕', () => {
    const html = renderToString(<RoomList {...base} onOverride={() => {}} />);
    expect(html).toContain('編輯座位');
    expect(html).not.toContain('本次專用');
    expect(html).not.toContain('還原成共用設定');
  });
  it('有覆寫：標「本次專用」、座位數以本次為準、編輯座位合併成單一入口', () => {
    const html = renderToString(<RoomList {...base} overrides={{ 'room-1': { rows: 7, depth: 8, seatCount: 56 } }} onOverride={() => {}} />);
    expect(html).toContain('本次專用');
    expect(html).not.toContain('編輯本次座位');
    expect(html).toContain('<b>56</b>');
  });
  it('沒勾選的教室不提供本次調整；設定頁（沒傳 onOverride）也不提供', () => {
    expect(renderToString(<RoomList {...base} />)).not.toContain('本次調整座位');
  });
});
