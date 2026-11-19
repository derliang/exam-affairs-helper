/**
 * 標籤預覽（D171④、稿 v2.77）：⑤ 排座與預覽、⑥ 下載的預覽卡共用同一個畫法（同一份版面模型、同一句提示），不得各寫一套。
 * 自習生、不參加者不印標籤（D135⑤）；預備教室只有自習＝沒有標籤，顯示「不印標籤」提示。
 */
import { useMemo } from 'preact/hooks';
import type { Classroom, LabelPaper } from '../../data';
import { renderPrintHtml } from '../../export/htmlRender';
import { buildLabelPages, defaultLabelLayout, type ExportInput } from '../../export/model';
import { labelSplitNote } from '../rooms';
import { Alert } from './index';

/** 單一教室的標籤預覽頁（HTML）；排版失敗（例如座位超出標籤格數，#147）回傳 { error }，不讓整頁空白 */
export function labelPreviewHtml(input: ExportInput, paper: LabelPaper, room: Classroom): string | { error: string } {
  try {
    const withPaper = { ...input, includeStudyRef: true, exam: { ...input.exam, labelLayout: defaultLabelLayout(paper) } };
    const meta = { generatedAt: input.result.generatedAt, dataVersion: input.result.dataVersion, extraCss: `html{background:#e9ecf1;zoom:${paper === 'A3' ? 0.38 : 0.45}}body{margin:0;padding:8px}.sheet{width:${paper === 'A3' ? 297 : 250}mm;box-sizing:border-box;margin:0 auto 8px!important;box-shadow:0 1px 4px #0003}` };
    const pgs = buildLabelPages(withPaper, 'all').filter((x) => x.roomName === room.name || x.roomName.startsWith(`${room.name}（第`) || x.roomName.startsWith(`${room.name}　抽離考試`));
    return pgs.length ? renderPrintHtml({ label: pgs }, meta) : '';
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function LabelPreview(p: { input: ExportInput; paper: LabelPaper; room: Classroom | undefined; html?: string | { error: string } }) {
  const { room } = p;
  const html = useMemo(() => p.html ?? (room ? labelPreviewHtml(p.input, p.paper, room) : ''), [p.html, p.input, p.paper, room]);
  return (
    <>
      {room && labelSplitNote(room, p.paper) && <Alert tone="info">{labelSplitNote(room, p.paper)}</Alert>}
      {typeof html === 'object'
        ? <Alert tone="danger"><b>這間教室的預覽排不出來</b>：{html.error}。請回 ③ 調整教室的座位。</Alert>
        : html
        ? <iframe class="pvframe" title="標籤預覽" sandbox="" srcdoc={html} style="width:100%;height:660px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunken)" />
        : <Alert tone="info">{room?.kind === 'reserve' ? '這間預備教室沒有加考的人：抽離自習的人只排自習座位頁、不印標籤，名單另出。' : '這間教室沒有可預覽的內容。'}</Alert>}
    </>
  );
}
