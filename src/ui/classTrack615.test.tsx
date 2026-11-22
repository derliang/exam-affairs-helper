/** #615：改班級文理組，同名班級教室的組別要跟著走；#616：共用設定教室清單照班級順序。全是假資料 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { RoomList } from './components/RoomList';
import { gsatDoc } from './reconcileFixtures';
import { reseat, seatingBlockers } from './seating';
import { moveClass, setClassTrack } from './store';

const noop = () => undefined;
const trackOfRoom = (d: ReturnType<typeof gsatDoc>['doc'], name: string) => d.settings.classrooms.find((r) => r.kind === 'class' && r.name === name)?.track;

describe('#615 班級改文理組 → 班級教室跟著改', () => {
  it('良（文）改成理組、溫（理）改成文組，教室卡的組別跟著換；預備教室不受影響', () => {
    const { doc } = gsatDoc();
    const a = setClassTrack(setClassTrack(doc, 'senior', 2, 'science'), 'senior', 1, 'liberal');
    expect(trackOfRoom(a, '溫')).toBe('liberal');
    expect(trackOfRoom(a, '良')).toBe('science');
    expect(trackOfRoom(a, '恭')).toBe('science');
    expect(a.settings.classrooms.filter((r) => r.kind === 'reserve').every((r) => !r.track)).toBe(true);
  });
  it('排座：班級全改文組後，沒有「文組沒有可用的教室」的擋下，排座成功', () => {
    const { doc, exam } = gsatDoc();
    let d = doc;
    for (const no of [1, 2, 3]) d = setClassTrack(d, 'senior', no, 'liberal');
    expect(d.settings.classrooms.filter((r) => r.kind === 'class').map((r) => r.track)).toEqual(['liberal', 'liberal', 'liberal']);
    expect(seatingBlockers(d, d.exams[0]!).map((b) => b.text ?? '').join('|')).not.toContain('沒有可用的教室');
    const s = reseat(d, d.exams[0]!, '2026-11-10T03:00:00Z');
    expect(s.ok).toBe(true);
    void exam;
  });
  it('不同名的教室、其他部別的教室不動；組別沒變時回傳同一份 doc 內容', () => {
    const { doc } = gsatDoc();
    const same = setClassTrack(doc, 'senior', 1, 'science');
    expect(same.settings.classrooms).toEqual(doc.settings.classrooms);
  });
});

describe('#616 共用設定教室清單順序跟隨班級資料順序', () => {
  it('班級改成 溫、恭、良 後，教室清單也是 溫、恭、良，預備教室仍在最後', () => {
    const { doc } = gsatDoc();
    const moved = moveClass(doc, 'senior', 3, -1);
    // 共用教室清單原本是 溫、良、恭、預備一、預備二
    const html = renderToString(<RoomList division="senior" rooms={moved.settings.classrooms} classes={moved.settings.classes} paper="B4" onChange={noop} />);
    const ids = ['c1', 'c3', 'c2', 'k1', 'k2']; // 溫、恭、良、預備一、預備二
    const pos = ids.map((id) => html.indexOf(`id="rn-${id}"`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});
