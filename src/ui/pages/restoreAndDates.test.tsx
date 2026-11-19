import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createMemoryRepository, demoDoc } from '../repository';
import { newExam } from '../store';
import { Exams } from './Exams';
import { Init } from './Init';
import { Step1 } from './Step1';

const noop = () => undefined;
const fsWith = (problem: unknown) => ({ restoreProblem: () => problem, hasFolder: () => false }) as never;
const init = (problem: unknown) => renderToString(<Init repo={createMemoryRepository()} fsSupported fs={fsWith(problem)} doc={demoDoc()} onDialog={noop} onRestore={async () => false} onDone={noop} />);

describe('#464 使用上次資料夾失敗：每種原因都有白話說明與下一步', () => {
  it('需要再允許一次：說明 Chrome 每次重開都會問、主按鈕是「允許使用上次資料夾」', () => {
    const h = init({ kind: 'needPermission', name: '模擬考資料' });
    expect(h).toContain('請再允許一次');
    expect(h).toContain('模擬考資料');
    expect(h).toContain('允許使用上次資料夾');
  });
  it('剛按不允許／沒跳視窗：可再試，也可改選資料夾', () => {
    const h = init({ kind: 'denied', name: 'X' });
    expect(h).toContain('沒有取得資料夾的讀寫許可');
    expect(h).toContain('再試一次');
    expect(h).toContain('選擇資料夾');
  });
  it('瀏覽器沒記住：不給「再試一次」，只引導重新選擇', () => {
    const h = init({ kind: 'noHandle', name: '' });
    expect(h).toContain('沒有記住上次的資料夾');
    expect(h).not.toContain('再試一次');
  });
  it('其他錯誤：顯示技術訊息', () => {
    const h = init({ kind: 'error', name: 'X', detail: 'SecurityError：boom' });
    expect(h).toContain('上次的資料夾打不開');
    expect(h).toContain('SecurityError：boom');
  });
});

describe('#473 已建立的考試要找得到修改日期與各節時間的入口', () => {
  const doc = (() => { const r = newExam(demoDoc(), 'gsat', '學測第一次', new Date('2026-10-01T02:00:00Z')); if (!r.ok) throw new Error(r.error); return r.doc; })();
  it('列表卡片：沒日期時有「填寫日期」', () => {
    const h = renderToString(<Exams doc={doc} onOpen={noop} onEditDates={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(h).toContain('填寫日期');
    expect(h).toContain('未填日期');
  });
  it('第 1 步：日期區塊有「修改考試日期」「修改各節開始時間」', () => {
    const h = renderToString(<Step1 doc={doc} exam={doc.exams[0]!} onChange={noop} onToSched={noop} />);
    expect(h).toContain('考試日期與各節時間');
    expect(h).toContain('修改考試日期');
    expect(h).toContain('修改各節開始時間');
  });
  it('從列表「修改日期」進來：修改基本資料視窗直接開著', () => {
    const h = renderToString(<Step1 doc={doc} exam={doc.exams[0]!} onChange={noop} openBasic />);
    expect(h).toContain('第 1 天');
  });
});
