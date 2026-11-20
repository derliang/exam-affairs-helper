import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { RoomList } from '../components/RoomList';
import { cardInfo, daysText, MakeupList } from './pages/MakeupList';
import { MakeupNew } from './pages/MakeupNew';
import { MakeupWorkspace } from './pages/MakeupWorkspace';
import { fromClassrooms, newRoom, toClassroom } from './pages/MkStep3';
import { stepDone, stepStates } from './steps';
import { fakeSession, NOW, rooms } from './testKit';
import { newMakeupSession } from './session';

const noop = () => undefined;
const ws = (s: ReturnType<typeof fakeSession>, step: 1 | 2 | 3 | 4 | 5 | 6 | 7) => renderToString(<MakeupWorkspace s={s} step={step} onChange={noop} onStep={noop} onList={noop} />);

describe('補考畫面（伺服器端渲染煙霧測試＋文案）', () => {
  const s = { ...fakeSession({ rooms: rooms(6) }), days: [{ id: 'd1', date: '2027-01-16', start: 480 }] };
  it('七個步驟都畫得出來', () => {
    for (const step of [1, 2, 3, 4, 5] as const) expect(ws(s, step)).toContain('補考');
    expect(ws(s, 6)).toContain('檢核與對帳');
    expect(ws(s, 7)).toContain('下載 Word');
  });
  it('① 設定：日期已過、年級未指定都有說明；暫定項標暫定', () => {
    const past = { ...s, days: [{ id: 'd1', date: '2020-01-01', start: 480 }] };
    expect(ws(past, 1)).toContain('這個日期已經過了');
    expect(ws({ ...s, gradeDay: { S1: 'd1' } }, 1)).toContain('還沒有指定考日');
    expect(ws(s, 1)).toContain('暫定 U-2');
    expect(ws(s, 1)).toContain('暫定 U-5');
  });
  it('② 匯入：C-1 對帳等式與四個數字；沒有名單時是拖放區', () => {
    const html = ws(s, 2);
    expect(html).toContain('匯入對帳：對上了（差異 0）');
    expect(html).toContain('納入排程');
    expect(html).toContain('另行通知');
    const { parse: _p, ...empty } = s;
    void _p;
    const h2 = ws(empty, 2);
    expect(h2).toContain('拖到這裡');
    expect(h2).toContain('只在你的電腦上讀取');
  });
  it('③ 教室：夠用／缺席數文案；沒有教室時擋下說明', () => {
    expect(ws(s, 3)).toContain('座位夠用');
    expect(ws({ ...s, rooms: [] }, 3)).toContain('還沒有可用的教室');
    expect(ws({ ...s, rooms: rooms(2, 5) }, 3)).toContain('座位不夠');
  });
  it('④ 統計：各班各科矩陣、驗算勾、科數分布', () => {
    const html = ws(s, 4);
    expect(html).toContain('班級 × 科目');
    expect(html).toContain('各科總計');
    expect(html).toContain('與 C-1 納入人次一致');
    expect(html).toContain('多科生科數分布');
    expect(html).toContain('Σ（科數 × 人數）');
  });
  it('⑤ 考程：遺漏 0 ✓、時段 × 教室、提前開考離場文案', () => {
    const html = ws(s, 5);
    expect(html).toContain('0 ✓');
    expect(html).toContain('時段 × 教室總覽');
    expect(html).toContain('科目怎麼排');
    expect(ws({ ...s, rooms: [] }, 5)).toContain('排不進去（遺漏）');
  });
  it('表格一律用卡片化容器（D168）：不出現 class="scroll"', () => {
    for (const step of [1, 2, 3, 4, 5] as const) expect(ws(s, step)).not.toContain('class="scroll"');
  });
});

describe('補考列表與新增', () => {
  it('空：第一次畫面、七個步驟說明', () => {
    const html = renderToString(<MakeupList sessions={[]} onNew={noop} onOpen={noop} onDelete={noop} />);
    expect(html).toContain('還沒有補考場次');
    expect(html).toContain('七個步驟');
  });
  it('有場次：考日、人次、學生、進度、對帳徽章；沒有名單不顯示紅燈', () => {
    const s = { ...fakeSession({ rooms: rooms(6) }), days: [{ id: 'd1', date: '2027-01-16', start: 480 }] };
    const html = renderToString(<MakeupList sessions={[s]} onNew={noop} onOpen={noop} onDelete={noop} today="2026-11-20" />);
    expect(html).toContain('考日 1 天：1/16（六）（全校）');
    expect(html).toContain('位學生');
    expect(daysText(s)).toContain('全校');
    const fresh = newMakeupSession({ id: 'z', name: '', year: 115, semester: 'first', now: NOW });
    expect(cardInfo(fresh, '2026-11-20').tone).toBe('none');
    expect(renderToString(<MakeupList sessions={[fresh]} onNew={noop} onOpen={noop} onDelete={noop} />)).toContain('尚未匯入名單');
  });
  it('有不通過的場次：紅色左邊條與「✕ N 項不通過」文字', () => {
    const s = { ...fakeSession({ rooms: [] }), days: [{ id: 'd1', date: '2027-01-16', start: 480 }] };
    const info = cardInfo(s, '2026-11-20');
    expect(info.tone).toBe('red');
    expect(info.missing).toBeGreaterThan(0);
    const html = renderToString(<MakeupList sessions={[s]} onNew={noop} onOpen={noop} onDelete={noop} today="2026-11-20" />);
    expect(html).toContain('mk-red');
    expect(html).toContain('項不通過');
  });
  it('新增場次：有上次就說沿用什麼，沒有就說第一個', () => {
    const prev = fakeSession();
    expect(renderToString(<MakeupNew now={NOW} prev={prev} onCancel={noop} onCreate={noop} />)).toContain('已沿用上一次補考');
    expect(renderToString(<MakeupNew now={NOW} prev={undefined} onCancel={noop} onCreate={noop} />)).toContain('第一個補考場次');
  });
});

describe('步驟狀態', () => {
  it('③ 教室不夠就不算完成；⑥ 沒有紅燈就算完成、⑦ 還沒下載就未完成', () => {
    const ok = { ...fakeSession({ rooms: rooms(6) }), days: [{ id: 'd1', date: '2027-01-16', start: 480 }] };
    const d = stepDone(ok, '2026-11-20');
    expect(d).toMatchObject({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: false });
    expect(stepDone({ ...ok, rooms: [] }, '2026-11-20')).toMatchObject({ 3: false, 5: false });
    expect(stepStates(ok, 3, '2026-11-20').map((x) => x.state)).toEqual(['done', 'done', 'cur', 'done', 'done', 'done', 'todo']);
  });
});

describe('教室清單接全站元件（RoomList flat）', () => {
  it('補考教室 ↔ Classroom 來回不丟用途與座位；新增教室 id 不重複', () => {
    const rs = rooms(2).map((r, i) => ({ ...r, use: (['mixed', 'special'] as const)[i]!, disabled: i === 0 ? ['1-1'] : [] }));
    const back = fromClassrooms(rs.map(toClassroom), rs);
    expect(back.map((r) => r.use)).toEqual(['mixed', 'special']);
    expect(back[0]!.disabled).toEqual(['1-1']);
    expect(back[1]).not.toHaveProperty('disabled');
    expect(newRoom(rs).id).toBe('room-3');
    expect(fromClassrooms([...rs.map(toClassroom), { ...toClassroom(newRoom(rs)) }], rs)[2]!.use).toBe('class');
  });
  it('flat：不寫「預備教室不計入座位合計」、每間可刪、表尾不說「班級教室跟著名冊」', () => {
    const html = renderToString(<RoomList flat rooms={rooms(2).map(toClassroom)} paper="B4" division="senior" track="none" reserveName="教室" addLabel="＋ 新增教室" onChange={noop} />);
    expect(html).not.toContain('不計入教室座位合計');
    expect(html).not.toContain('跟著名冊班級走');
    expect((html.match(/刪除/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const empty = renderToString(<RoomList flat rooms={[]} paper="B4" division="senior" track="none" reserveName="教室" addLabel="＋ 新增教室" onChange={noop} />);
    expect(empty).toContain('還沒有教室');
    expect(empty).not.toContain('依名冊帶出');
  });
});
