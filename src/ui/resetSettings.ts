/**
 * 共用設定的兩種重置（#353、#354；D163、D164）。純邏輯，不碰 DOM；呼叫端交給 App 的 onChange，所以一步可用「↶ 復原」回來。
 * - 新學年重置：清學生名單（目前學年度，兩個部別）＋班級教室的座位配置（回到預設格子）；保留已建立的考試與其他設定。
 * - 全部重置：只重置共用設定（學生名單、班級、教室、節次、標籤預設、學校與表頭回到預設值）；
 *   選用功能開關、已建立的全部模擬考、資料夾連結保留（外觀存在瀏覽器，不在這份資料裡）。
 */
import type { ClassInfo, Classroom } from '../data';
import { defaultSeatGrid } from './classRooms';
import { emptyDoc, withDefaults } from './repository';
import type { Doc } from './store';

export interface ResetCounts { students: number; classes: number; classRooms: number; rooms: number }

export function resetCounts(doc: Doc): ResetCounts {
  return {
    students: doc.rosters.senior.length + doc.rosters.junior.length,
    classes: doc.settings.classes.length,
    classRooms: doc.settings.classrooms.filter((r) => r.kind === 'class').length,
    rooms: doc.settings.classrooms.length,
  };
}

/** 班級教室回到預設座位格子：拿掉停用座位、每排深位、自習容量與「不排座」旗標；名稱、id、文理組保留 */
function defaultSeatsOf(r: Classroom): Classroom {
  const g = defaultSeatGrid(0);
  const { disabled: _d, rowDepths: _r, studyCapacity: _s, noSeat: _n, ...rest } = r;
  void _d; void _r; void _s; void _n;
  return { ...rest, rows: g.rows, depth: g.depth, seatCount: g.rows * g.depth };
}

export function newYearReset(doc: Doc): Doc {
  return {
    ...doc,
    rosters: { senior: [], junior: [] },
    settings: { ...doc.settings, classrooms: doc.settings.classrooms.map((r) => (r.kind === 'class' ? defaultSeatsOf(r) : r)) },
  };
}

export function fullReset(doc: Doc): Doc {
  const fresh = withDefaults(emptyDoc()).settings;
  const keep: Pick<typeof doc.settings, 'features' | 'markMap' | 'env'> = {};
  if (doc.settings.features) keep.features = doc.settings.features;
  if (doc.settings.markMap) keep.markMap = doc.settings.markMap;
  if (doc.settings.env) keep.env = doc.settings.env;
  const next: Doc = { ...doc, rosters: { senior: [], junior: [] }, settings: { ...fresh, classes: fresh.classes as ClassInfo[], ...keep } };
  delete next.otherYears;
  return next;
}
