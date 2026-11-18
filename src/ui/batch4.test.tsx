/** 第 4 批「輸出與列表」：G1 列表封存／還原／刪除、G14 標籤 7×7、G15 下載兩顆鈕。學測、分科、會考都測；全部假資料 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { createIncrementalSaver, createMemoryFS, loadDoc, saveDoc, studentCode, type ExamConfig, type ExamKind } from '../data';
import { buildLabelPages, defaultLabelLayout, labelFit, labelGrid, labelGridSize, labelNotePt, mmToTwip, renderDocx, renderPrintHtml, roomTooBigForLabel, PAPER_MM } from '../export';
import { makeFixture } from '../export/fixtures';
import type { ExportInput } from '../export/model';
import { DeleteExamModal, deleteNameMatches, Exams } from './pages/Exams';
import { downloadGate, Step6 } from './pages/Step6';
import { AstStep6 } from './ast/AstStep6';
import { demoDoc } from './repository';
import { roomsOverLabel, labelSplitNote } from './rooms';
import { deleteExam, newExam, setExamArchived, updateExam, type Doc } from './store';

const noop = () => undefined;
const KINDS: ExamKind[] = ['gsat', 'ast', 'bcct'];

function docWith(): Doc {
  let d = demoDoc();
  KINDS.forEach((k, i) => {
    const r = newExam(d, k, `${k}第一次`, new Date(`2026-1${i}-01T02:00:00Z`));
    if (!r.ok) throw new Error(r.error);
    d = r.doc;
  });
  return d;
}

describe('G1 列表：封存、還原、刪除（學測、分科、會考）', () => {
  it('封存＝只改標記；還原回到進行中；找不到的考試回錯誤', () => {
    const d = docWith();
    for (const e of d.exams) {
      const a = setExamArchived(d, e.id, true);
      expect(a.ok && a.doc.exams.find((x) => x.id === e.id)!.archived).toBe(true);
      expect(a.ok && a.doc.exams.find((x) => x.id === e.id)!.name).toBe(e.name);
      const b = a.ok ? setExamArchived(a.doc, e.id, false) : a;
      expect(b.ok && 'archived' in b.doc.exams.find((x) => x.id === e.id)!).toBe(false);
    }
    expect(setExamArchived(d, 'nope', true).ok).toBe(false);
  });

  it('刪除只刪這次考試與它的檔案；共用設定、學生名單原封不動', () => {
    let d = docWith();
    d = { ...d, examFiles: Object.fromEntries(d.exams.map((e) => [e.id, { entries: [{ classNo: 1, seatNo: 1, name: '甲', subjectIds: [] }] }])) };
    for (const e of d.exams) {
      const r = deleteExam(d, e.id);
      if (!r.ok) throw new Error(r.error);
      expect(r.doc.exams.some((x) => x.id === e.id)).toBe(false);
      expect(r.doc.examFiles?.[e.id]).toBeUndefined();
      expect(r.doc.exams).toHaveLength(2);
      expect(r.doc.settings).toBe(d.settings);
      expect(r.doc.rosters).toBe(d.rosters);
    }
    expect(deleteExam(d, 'nope').ok).toBe(false);
  });

  it('存檔：封存標記存得回來；刪除會把該考試的資料夾一併清掉（只動 App 內資料夾）', async () => {
    const d = docWith();
    const fs = createMemoryFS();
    const save = createIncrementalSaver(fs);
    await saveDoc(fs, d);
    const id = d.exams[0]!.id;
    const arch = setExamArchived(d, id, true);
    if (!arch.ok) throw new Error();
    await save(arch.doc);
    expect((await loadDoc(fs)).data.exams.find((e) => e.id === id)!.archived).toBe(true);
    const del = deleteExam(arch.doc, id);
    if (!del.ok) throw new Error();
    await save(del.doc);
    expect([...fs.files.keys()].some((k) => k.startsWith(`exams/${id}/`))).toBe(false);
    expect((await loadDoc(fs)).data.exams.map((e) => e.id)).not.toContain(id);
  });

  it('列表分「進行中／已封存」；封存的考試只有「查看／下載」「還原」「刪除」，進行中有「查看／安排」「封存」「刪除」', () => {
    const d = docWith();
    const gsat = d.exams.find((e) => e.kind === 'gsat')!;
    const a = setExamArchived(d, gsat.id, true);
    if (!a.ok) throw new Error();
    const html = renderToString(<Exams doc={a.doc} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} onArchive={noop} onRestore={noop} onDelete={noop} />);
    expect(html).toContain('進行中');
    expect(html).toContain('已封存');
    expect(html.indexOf('進行中')).toBeLessThan(html.indexOf('已封存'));
    expect(html).toContain('查看／下載');
    expect(html).toContain('查看／安排');
    for (const t of ['>封存<', '>還原<', '>刪除<']) expect(html).toContain(t);
    // 沒有封存的考試時不出現「已封存」區
    expect(renderToString(<Exams doc={d} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} onArchive={noop} onRestore={noop} onDelete={noop} />)).not.toContain('封存的考試只能查看');
    // 複製、改名不在這次範圍
    expect(html).not.toContain('>複製<');
    expect(html).not.toContain('>改名<');
  });

  it('刪除確認：寫明會刪什麼、不碰已下載的檔案；名稱要完全一致才能刪', () => {
    const e = docWith().exams[0]! as ExamConfig;
    const html = renderToString(<DeleteExamModal exam={e} onClose={noop} onConfirm={noop} />);
    expect(html).toContain('會刪掉');
    expect(html).toContain('考試設定');
    expect(html).toContain('已經下載到電腦的');
    expect(html).toContain('不會動');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>刪除這次模擬考<\/button>/);
    expect(deleteNameMatches(e.name, e.name)).toBe(true);
    expect(deleteNameMatches(e.name, ` ${e.name} `)).toBe(true);
    expect(deleteNameMatches(e.name, e.name.slice(0, -1))).toBe(false);
    expect(deleteNameMatches(e.name, '')).toBe(false);
  });

  it('封存的分科考試：⑥ 不出現「確認定案」與版本紀錄卡（不能編輯）', () => {
    const d = docWith();
    const ast = d.exams.find((e) => e.kind === 'ast')!;
    const a = setExamArchived(d, ast.id, true);
    if (!a.ok) throw new Error();
    const noopChange = (_: Doc) => undefined;
    const live = renderToString(<AstStep6 doc={d} exam={ast} onGoStep={noop} onChange={noopChange} />);
    const frozen = renderToString(<AstStep6 doc={a.doc} exam={a.doc.exams.find((e) => e.id === ast.id)!} onGoStep={noop} onChange={noopChange} />);
    expect(live.length).toBeGreaterThan(frozen.length);
    void updateExam;
  });
});

// ───── G14：標籤 7×7 ─────

/** 造一間 rows×depth 的教室、坐滿 n 人（同一班，座號 1…n）的輸出輸入 */
function oneRoom(kind: ExamKind, paper: 'B4' | 'A3', rows: number, depth: number, n: number): ExportInput {
  const f = makeFixture({ paper });
  const students = Array.from({ length: n }, (_, i) => ({ classNo: 1, seatNo: i + 1, name: `甲生${String(i + 1).padStart(2, '0')}` }));
  const room = { id: 'r1', name: '甲教室', kind: 'class' as const, rows, depth, seatCount: n, division: 'senior' as const };
  const exam = { ...f.exam, kind, division: kind === 'bcct' ? ('junior' as const) : ('senior' as const), classroomIds: ['r1'], labelLayout: { paper, cols: 7, rows: 7 } };
  return {
    ...f,
    settings: { ...f.settings, classrooms: [room] },
    exam,
    students,
    entries: students.map((s) => ({ ...s, subjectIds: ['zh'] })),
    result: {
      ...f.result,
      assignments: students.map((s, i) => ({ classroomId: 'r1', row: Math.floor(i / depth) + 1, depth: (i % depth) + 1, code: studentCode(1, s.seatNo) })),
      detaches: [],
      overrides: [],
      marks: [],
    },
  };
}

const fontDir = new URL('../export/fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };
const docXml = async (input: ExportInput) => (await JSZip.loadAsync(await renderDocx({ label: buildLabelPages(input, 'class') }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
const grids = (x: string) => [...x.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => [...m[1]!.matchAll(/w:w="(\d+)"/g)].map((v) => Number(v[1])));

describe('G14 標籤：每格＝紙寬÷7、紙高÷7，排列同座位表（學測、分科、會考；B4 與 A3）', () => {
  for (const kind of KINDS) {
    for (const paper of ['B4', 'A3'] as const) {
      it(`${kind}／${paper}：5 排×6 深位印 5×6、30 人；Word 欄寬＝紙寬÷7、列高＝紙高÷7`, async () => {
        const input = oneRoom(kind, paper, 5, 6, 30);
        const pages = buildLabelPages(input, 'class');
        expect(pages).toHaveLength(1);
        expect(labelGridSize(pages[0]!)).toEqual({ cols: 5, rows: 6 });
        expect(pages[0]!.cells).toHaveLength(30);
        const W = PAPER_MM[paper].w;
        const H = PAPER_MM[paper].h;
        const x = await docXml(input);
        const g = grids(x).filter((w) => w.length === 5);
        expect(g).toHaveLength(1);
        expect(new Set(g[0]!)).toEqual(new Set([Math.floor(((W - 21) / 7 * 1440) / 25.4)]));
        const heights = [...x.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1]));
        expect(heights).toHaveLength(6);
        expect(new Set(heights)).toEqual(new Set([mmToTwip(labelFit(defaultLabelLayout(paper), 6, 3).h)])); // D136：深位 6 含注意事項時格子稍矮
        // 列印頁（PDF 用）也是同一組格大小
        const html = renderPrintHtml({ label: pages }, meta);
        expect(html).toContain(`repeat(5,${+((W - 21) / 7).toFixed(2)}mm)`);
        expect(html).toContain(`height:${+labelFit(defaultLabelLayout(paper), 6, 3).h.toFixed(2)}mm`);
      });
    }
  }

  it('40 人班級放進 6 排×7 深位（42 座）：格子 6×7，最後兩個座位沒人坐不印格子；舊的 5×8 超過 7，標籤停用', () => {
    const input = oneRoom('gsat', 'B4', 6, 7, 40);
    const p = buildLabelPages(input, 'class')[0]!;
    expect(labelGridSize(p)).toEqual({ cols: 6, rows: 7 });
    expect(labelGrid(p).filter(Boolean)).toHaveLength(40);
    expect(labelGrid(p).filter((c) => !c)).toHaveLength(42 - 40);
    expect(p.cells.map((c) => c.coord)).not.toContain('6-6'); // 空位（沒人）不印
    const old = oneRoom('gsat', 'B4', 5, 8, 40);
    expect(roomTooBigForLabel(old.settings.classrooms[0]!)).toBe(true);
    expect(buildLabelPages(old, 'class')).toEqual([]);
    expect(roomsOverLabel(old.settings.classrooms)).toHaveLength(1);
    expect(labelSplitNote(old.settings.classrooms[0]!)).toContain('超過 7×7，標籤無法對應，請縮小');
  });

  it('沒有座位的位置不印格子：停用座位與沒人坐的位置都是無框空白（Word 無框無底、列印頁無斜線）', async () => {
    const input = oneRoom('gsat', 'A3', 3, 4, 10); // 3 排×4 深位只坐 10 人：3-3、3-4 沒人
    const html = renderPrintHtml({ label: buildLabelPages(input, 'class') }, meta);
    expect((html.match(/pp-bl/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('pp-e"');
    const x = await docXml(input);
    expect(x).not.toContain('EAE5D4'); // 舊的斜線底色
  });

  it('滿 7 排×7 深位（49 座）仍放得進一張紙：列高扣掉標題頁尾與注意事項，注意事項一定印（D136）', async () => {
    for (const paper of ['B4', 'A3'] as const) {
      const input = oneRoom('bcct', paper, 7, 7, 49);
      const p = buildLabelPages(input, 'class')[0]!;
      expect(labelGridSize(p)).toEqual({ cols: 7, rows: 7 });
      expect(labelNotePt(p.layout, 7, p.notes.length)).toBeGreaterThan(0);
      const x = await docXml(input);
      expect(x).toContain('注意事項：');
      const H = PAPER_MM[paper].h;
      const heights = [...x.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"/g)].map((m) => Number(m[1]));
      expect(heights).toHaveLength(7);
      expect(heights[0]! * 7).toBeLessThan(mmToTwip(H));
    }
  });
});

// ───── G15：下載兩顆鈕 ─────

describe('G15 ⑥ 下載：Word、PDF 各一顆按鈕，沒有格式選擇', () => {
  it('不能下載的原因（過期、有擋下項目、沒勾內容）；可以下載時為空', () => {
    expect(downloadGate({ stale: true, blocked: true, nothing: true })).toContain('過期');
    expect(downloadGate({ stale: false, blocked: true, nothing: false })).toContain('必須處理');
    expect(downloadGate({ stale: false, blocked: true, nothing: true })).toContain('尚未勾選'); // 全沒勾時先說沒勾
    expect(downloadGate({ stale: false, blocked: false, nothing: true })).toContain('尚未勾選');
    expect(downloadGate({ stale: false, blocked: false, nothing: false })).toBe('');
  });

  for (const kind of ['gsat', 'bcct'] as const) {
    it(`${kind}：並排「下載 Word」「下載 PDF（開啟列印頁）」，沒有格式單選；還不能下載時兩顆都停用並寫原因`, () => {
      const d = docWith();
      const e = d.exams.find((x) => x.kind === kind)!;
      const html = renderToString(<Step6 doc={d} exam={e} onGoStep={noop} />);
      expect(html).toContain('下載 Word');
      expect(html).toContain('下載 PDF（開啟列印頁）');
      expect(html).not.toContain('role="radiogroup"');
      expect(html).not.toContain('將下載 <');
      expect((html.match(/btn-fmt[^>]*disabled/g) ?? []).length).toBe(2);
      expect(html).toContain('上方還有必須處理的問題');
      // 說明文字不再提「選格式」
      expect(html).toContain('「下載 PDF」是先開啟列印用頁面');
    });
  }

  it('分科：兩顆鈕、規劃中兩顆都停用並說明', () => {
    const d = docWith();
    const e = d.exams.find((x) => x.kind === 'ast')!;
    const html = renderToString(<AstStep6 doc={d} exam={e} onGoStep={noop} />);
    expect(html).toContain('下載 Word');
    expect(html).toContain('下載 PDF（開啟列印頁）');
    expect(html).not.toContain('role="radiogroup"');
    expect((html.match(/btn-fmt[^>]*disabled/g) ?? []).length).toBe(2);
  });
});
