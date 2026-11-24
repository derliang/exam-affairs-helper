/** 修正第 1 批（G2、G4、G7、G12）：三種考試類型（學測、分科、會考）各自驗證；全部假資料 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { ExamConfig, ExamKind } from '../data';
import { RoomList, RoomTable } from './components/RoomList';
import { scrollPageTop } from './nav';
import { NewExam } from './pages/NewExam';
import { Step1 } from './pages/Step1';
import { demoDoc } from './repository';
import { newExam, type Doc } from './store';

const noop = () => undefined;
function docWith(kind: ExamKind): { doc: Doc; exam: ExamConfig } {
  const r = newExam(demoDoc(), kind, '測試考', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams[r.doc.exams.length - 1] as ExamConfig };
}

describe('G7 本次考科副標與實際可否編輯一致', () => {
  const SUB = '依類型與次別自動帶出，可以新增、編輯、刪除';
  it('會考：不顯示「可以新增、編輯、刪除」，直接列七科，並說明固定', () => {
    const { doc, exam } = docWith('bcct');
    const html = renderToString(<Step1 doc={doc} exam={exam} onChange={noop} />);
    expect(html).not.toContain(SUB);
    expect(html).toContain('會考科目固定為七科');
    for (const s of ['國文', '英語閱讀', '英語聽力', '數學', '社會', '自然', '寫作測驗']) expect(html).toContain(s);
    expect(html).not.toContain('>新增考科<');
  });
  it('學測、分科：可編輯，副標照舊、有「新增考科」', () => {
    for (const kind of ['gsat', 'ast'] as const) {
      const { doc, exam } = docWith(kind);
      const html = renderToString(<Step1 doc={doc} exam={exam} onChange={noop} />);
      expect(html, kind).toContain(SUB);
      expect(html, kind).toContain('新增考科');
    }
  });
});

describe('G22 班級教室跟名冊走：不能新增、只有預備教室與舊教室可刪', () => {
  const rooms = [
    { id: 'a', name: '甲班', kind: 'class' as const, rows: 5, depth: 6, seatCount: 30, division: 'senior' as const, track: 'science' as const },
    { id: 'b', name: '乙班', kind: 'class' as const, rows: 5, depth: 6, seatCount: 30, division: 'senior' as const, track: 'liberal' as const },
    { id: 'p', name: '預備一', kind: 'reserve' as const, rows: 4, depth: 4, seatCount: 16, division: 'senior' as const },
  ];
  const classes = [{ name: '甲班', colorIndex: 1, division: 'senior', track: 'science' as const }, { name: '乙班', colorIndex: 2, division: 'senior', track: 'liberal' as const }];
  it('步驟③：只有「新增預備教室」，沒有「新增教室」「一次新增 N 間」；有對應班級的班級教室沒有刪除', () => {
    const html = renderToString(<RoomList rooms={rooms} paper="B4" onChange={noop} classes={classes} division="senior" selected={['a']} onSelect={noop} />);
    expect(html).toContain('新增預備教室');
    expect(html).not.toContain('>新增教室<');
    expect(html).not.toContain('一次新增');
    expect(html.match(/>刪除</g)).toHaveLength(1); // 只有預備一
  });
  it('步驟③：名冊已沒有這個班的舊班級教室，標示並可刪（從本次考試移除）', () => {
    const html = renderToString(<RoomList rooms={rooms} paper="B4" onChange={noop} classes={classes.slice(0, 1)} division="senior" selected={['a', 'b']} onSelect={noop} />);
    expect(html).toContain('名冊已沒有這個班');
    expect(html.match(/>刪除</g)).toHaveLength(2);
  });
  it('國中部（會考）：沒有任何新增鈕，也沒有預備教室', () => {
    const html = renderToString(<RoomList rooms={rooms.slice(0, 2)} paper="B4" onChange={noop} junior classes={classes} selected={['a']} onSelect={noop} />);
    expect(html).not.toContain('新增預備教室');
    expect(html).not.toContain('>新增教室<');
    expect(html).not.toContain('>刪除<');
  });
  it('共用設定教室清單：只有「新增預備教室」；班級教室不能刪、預備教室可刪；沒有「班級教室」字樣', () => {
    const html = renderToString(<RoomTable division="senior" rooms={rooms} paper="B4" onChange={noop} classes={classes} />);
    expect(html.match(/>刪除</g)).toHaveLength(1);
    expect(html).toContain('新增預備教室');
    expect(html).not.toContain('>新增教室<');
    expect(html).not.toContain('一次新增');
  });
  it('國中部空清單的提示：班級教室依名冊帶出，沒有新增鈕', () => {
    const html = renderToString(<RoomTable division="junior" rooms={[]} paper="B4" onChange={noop} />);
    expect(html).toContain('依名冊的班級自動帶出');
    expect(html).not.toContain('新增');
  });
});

describe('G4 換步驟回頁頂', () => {
  it('scrollPageTop 把視窗捲到 (0,0)；沒有視窗時不出錯', () => {
    const calls: [number, number][] = [];
    scrollPageTop({ scrollTo: (x, y) => { calls.push([x, y]); } });
    expect(calls).toEqual([[0, 0]]);
    expect(() => scrollPageTop(undefined)).not.toThrow();
  });
});

describe('G2 新增模擬考頁標題區不重複', () => {
  it('「新增模擬考」只出現在 h1，路徑列只列來源「模擬考」', () => {
    const html = renderToString(<NewExam doc={demoDoc()} onCancel={noop} onCreate={noop} />);
    expect(html).toContain('<h1>新增模擬考</h1>');
    expect(html).not.toContain('aria-current="page"');
    const nav = html.slice(html.indexOf('class="crumbs"'), html.indexOf('</nav>'));
    expect(nav).toContain('模擬考');
    expect(nav).not.toContain('新增模擬考');
  });
});

describe('分科也套用同一組規則（通則）', () => {
  it('分科 ③ 教室卡片標題與空清單提示稱「教室」；教室刪除在共用設定教室清單（RoomTable，已涵蓋）', async () => {
    const { AstStep3 } = await import('./ast/AstStep3');
    const { doc, exam } = docWith('ast');
    const html = renderToString(<AstStep3 doc={doc} exam={exam} onChange={noop} />);
    expect(html).toContain('教室與座位圖');
    expect(html).not.toContain('班級教室與座位圖');
  });
});

describe('G22 步驟③ 學測、會考的教室區都只有「新增預備教室」', () => {
  it('學測、會考：Step3 沒有「新增教室」；分科的綜合教室在 AstStep3', async () => {
    const { Step3 } = await import('./pages/Step3');
    for (const kind of ['gsat', 'bcct'] as const) {
      const { doc, exam } = docWith(kind);
      const html = renderToString(<Step3 doc={doc} exam={exam} onChange={noop} />);
      expect(html.includes('新增預備教室'), kind).toBe(kind === 'gsat'); // 會考（國中部）沒有預備教室
      expect(html, kind).not.toContain('>新增教室<');
      expect(html, kind).not.toContain('一次新增');
    }
  });
});
