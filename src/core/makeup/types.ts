/**
 * 補考核心（K1）型別。全部是純資料：不讀寫檔、不碰畫面、不取現在時間。
 * 規格：docs/makeup-spec.md；決定：D113～D124。
 *
 * 名詞對照（程式 ↔ 規格）：
 * - entry（一筆「學生＋科目」）＝規格的「人次」
 * - subject（科目鍵）：科目名稱；選組拆分時加〔文組〕〔理組〕，例「歷史〔文組〕」。排考程以科目鍵為單位
 * - paper（卷鍵）：年級＋科目鍵，例「高一 數學」。備卷、C-4、C-10 以卷為單位（不同年級是不同卷）
 * - group（考程群組）：同一考日、同一套節次時間的一群年級（例：1/23 高中部、1/23 初中部、1/16 高三）
 * - slot（時段）：群組內的一節；最後一節是綜合節（kind='final'），提前開考是 kind='early'
 * - sitting（入座）：一位學生在一個時段、一間考場的一個座位；多科生一次入座可帶多科
 */

/** 年級鍵：J＝初中（國中）、S＝高中；數字＝年級 */
export type GradeKey = 'J1' | 'J2' | 'J3' | 'S1' | 'S2' | 'S3';
export type MakeupDivision = 'junior' | 'senior';
export type TrackLabel = '文組' | '理組';

/** 原始匯出檔的欄位（F-8） */
export type MakeupField =
  | 'studentId'
  | 'newClass'
  | 'newSeat'
  | 'oldClass'
  | 'oldSeat'
  | 'name'
  | 'subjectCode'
  | 'subjectName'
  | 'credit'
  | 'attr'
  | 'term'
  | 'score';

export type MakeupColumnMap = Partial<Record<MakeupField, number>>;

/** 正規化後的一列名單（一人一科） */
export interface MakeupRow {
  /** 列的唯一鍵：單一工作表為列號字串「12」，多工作表為「工作表名!12」；問題列處理以此對應 */
  rowId: string;
  /** 工作表名稱（單一工作表可為空字串） */
  sheet: string;
  /** 工作表列號（1 起），對帳與問題列回溯用 */
  srcRow: number;
  studentId: string;
  name: string;
  /** 舊班（D122：班級以舊班舊號為準），保留原文，例「101」「高一溫」 */
  oldClass: string;
  oldSeat: number;
  newClass: string;
  newSeat: number | null;
  subjectCode: string;
  subjectName: string;
  credit: string;
  /** 科屬性原文；是否「另行通知」由 MakeupImportOptions.notifyAttrs 判斷（U-1 參數化） */
  attr: string;
  term: string;
  score: string;
}

/** 問題列種類（F-10）：缺姓名、舊班舊號對不上、同學號同科重複、科目不認識 */
export type MakeupProblemKind = 'no-name' | 'no-id' | 'bad-class' | 'dup' | 'unknown-subject';

export interface MakeupProblem {
  rowId: string;
  srcRow: number;
  kind: MakeupProblemKind;
  /** 中文說明，可直接顯示；不含姓名 */
  message: string;
  /** 原始儲存格（非空），供對照 */
  cells: string[];
  /** 讀得到的內容；讀不到的欄位為空字串／NaN，讓使用者補 */
  draft: MakeupRow;
}

/** 略過原因（D123 第 5 點：略過須從清單選原因） */
export type SkipReason = 'transferred' | 'duplicate' | 'not-target' | 'other';
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  transferred: '已轉學',
  duplicate: '重複列',
  'not-target': '非補考對象',
  other: '其他',
};

/** 問題列的處理：補上／修改（給完整的一列）或略過（給原因） */
export type MakeupResolution =
  | { rowId: string; action: 'fix'; row: MakeupRow }
  | { rowId: string; action: 'skip'; reason: SkipReason; note?: string };

export interface SkippedRow {
  rowId: string;
  reason: SkipReason;
  note?: string;
  /** 被略過那一列的內容（對帳表要列出） */
  row: MakeupRow;
}

export interface MakeupImportOptions {
  /**
   * 「另行通知」（只統計、不排考程）的科屬性值。U-1 暫定：只有 '1'（D114）。
   * 使用者核對更多匯出檔後若要改，改這裡的預設值或由畫面傳入。
   */
  notifyAttrs?: readonly string[];
  /** 已知科目名稱；有給才檢查「科目不認識」（空白科目名一律算不認識） */
  knownSubjects?: readonly string[];
  /** 自訂舊班 → 年級；沒給用 gradeOfClass 的預設規則 */
  gradeOf?: (oldClass: string) => GradeKey | null;
}

/** 解析結果：尚未處理問題列 */
export interface MakeupParseResult {
  header: number;
  columns: MakeupColumnMap;
  /** 缺少的必要欄位；不為空時 rows 為空，畫面要請使用者指定欄位 */
  missing: MakeupField[];
  /** 資料列總數（表頭以下、非全空的列）＝ C-1 的「匯入列數」 */
  rawCount: number;
  /** 沒問題的列 */
  rows: MakeupRow[];
  problems: MakeupProblem[];
  /** F-12：同學號但姓名或舊班舊號不一致（不擋，提示） */
  warnings: string[];
}

/** 處理完問題列後的名單（排程的輸入） */
export interface MakeupRoster {
  rawCount: number;
  /** 納入排程的列（科屬性不是另行通知） */
  included: MakeupRow[];
  /** 另行通知（科屬性 1）：只統計、不排考程（R-6） */
  notified: MakeupRow[];
  skipped: SkippedRow[];
  /** 還沒處理的問題列（不為 0 時 C-1 紅燈、不可往下） */
  unresolved: MakeupProblem[];
  /** 舊班 → 年級（解析時決定，之後所有模組共用） */
  gradeOfClass: Record<string, GradeKey>;
}

// ───────────── 教室與設定 ─────────────

/** 教室用途（F-14）：一般班級教室、混班教室、特別教室（提前開考） */
export type MakeupRoomUse = 'class' | 'mixed' | 'special';

export interface MakeupRoom {
  id: string;
  name: string;
  rows: number;
  depth: number;
  seatCount: number;
  disabled?: string[];
  rowDepths?: number[];
  use: MakeupRoomUse;
}

export interface MakeupDay {
  id: string;
  /** 顯示用，例「1/23（六）」 */
  label: string;
}

/** 考程群組：同一考日、同一套時間的年級 */
export interface MakeupGroup {
  id: string;
  dayId: string;
  /** 顯示用，例「高中」「初中」「高三」 */
  label: string;
  grades: GradeKey[];
  /** 開始時間，從 0:00 起算的分鐘數，例 8:00 ＝ 480 */
  start: number;
  /** 每節分鐘（F-3：高中 50、初中 45） */
  periodMin: number;
  /** 節間休息分鐘（F-3：預設 10） */
  breakMin: number;
  /** 本群組可用的教室 id（依優先順序）；沒給＝全部教室 */
  roomIds?: string[];
}

/**
 * 提前開考參數（U-2 暫定，皆可由設定頁改）：
 * - suggestOverMin：各科時間加總「超過」此值的多科生建議提前開考（稿：150 分）
 * - capMin：提前開考學生總作答時間上限，超過 C-12 琥珀（稿：210 分）
 * - subjectMin：個別科目的考試分鐘；沒列的科目用該群組的 periodMin
 */
export interface EarlyStartRule {
  suggestOverMin: number;
  capMin: number;
  subjectMin?: Record<string, number>;
}

/** 選組拆分：指定科目依學生班級的文理組拆成兩份卷、各自統計（F-17） */
export interface TrackSplit {
  subjects: readonly string[];
  /** 舊班 → 文組／理組；查不到就不拆 */
  trackOfClass: Record<string, TrackLabel>;
}

export interface MakeupSettings {
  days: MakeupDay[];
  groups: MakeupGroup[];
  rooms: MakeupRoom[];
  early: EarlyStartRule;
  trackSplit?: TrackSplit;
  /** 科目人數達此值才建議成為獨立節（其餘併入綜合節）；預設 DEFAULT_INDEPENDENT_MIN */
  independentMin?: number;
}

// ───────────── 考程（使用者可調） ─────────────

/** 每個群組的節次安排（F-20、F-21） */
export interface GroupPlan {
  groupId: string;
  /** 獨立節：依時段順序，每個時段一組科目（通常一科）；同時段多科時同一學生不可兩科都有（C-7） */
  slots: string[][];
  /** 併入最後一節（綜合節）的科目；最後一節＝slots 的最後一個時段（沒有獨立節時自成一節） */
  combined: string[];
  /** 提前開考的學生學號（系統建議或使用者指定） */
  early: string[];
}

/** 指定某班某時段的考場（「移動某班」「換教室」） */
export interface RoomPin {
  groupId: string;
  /** 時段索引（0 起）；提前開考用 -1 */
  slot: number;
  oldClass: string;
  roomId: string;
}

export interface MakeupPlan {
  groups: GroupPlan[];
  pins?: RoomPin[];
}

// ───────────── 排程結果 ─────────────

export type SlotKind = 'independent' | 'final' | 'early';

export interface SlotInfo {
  /** `${groupId}#${index}`；提前開考 `${groupId}#early` */
  id: string;
  groupId: string;
  dayId: string;
  /** 0 起；提前開考為 -1 */
  index: number;
  kind: SlotKind;
  start: number;
  /** 名目結束時間（獨立節、綜合節＝start＋periodMin；提前開考＝本場學生最晚的最早離場時間） */
  end: number;
  subjects: string[];
}

/** 一位學生在一個時段、一間考場 */
export interface Sitting {
  studentId: string;
  oldClass: string;
  oldSeat: number;
  grade: GradeKey;
  slotId: string;
  roomId: string;
  /** 本次入座要考的科目鍵（排序後） */
  subjects: string[];
  /** 對應的卷鍵（與 subjects 同順序） */
  papers: string[];
  /** 座位「排-深位」；超額時為 null（C-6 會抓） */
  seat: string | null;
  /** 最早可離場時間（分鐘）：提前開考學生才有（R-7、D124） */
  leaveAt?: number;
}

export interface Unplaced {
  studentId: string;
  subject: string;
  groupId: string | null;
  reason: string;
}

export interface EarlyInfo {
  studentId: string;
  groupId: string;
  subjects: string[];
  /** 總作答時間（分） */
  totalMin: number;
  leaveAt: number;
}

export interface MakeupSchedule {
  slots: SlotInfo[];
  sittings: Sitting[];
  early: EarlyInfo[];
  /** 排不進去的人次（教室不夠、群組沒設定等）；正常應為空，C-2／C-3 會抓 */
  unplaced: Unplaced[];
  /** 不得不拆開的「同班同科」（整班超過任何一間教室） */
  splits: { slotId: string; oldClass: string; rooms: string[] }[];
}

// ───────────── 檢核 ─────────────

/** 燈號：綠＝通過、琥珀＝警示（須逐項確認）、紅＝不通過（擋下載）、待執行（C-14 尚無檔可讀） */
export type CheckStatus = 'green' | 'amber' | 'red' | 'pending';

export interface CheckDetail {
  text: string;
  studentId?: string;
  subject?: string;
  oldClass?: string;
  roomId?: string;
  slotId?: string;
}

export interface CheckResult {
  id: 'C-1' | 'C-2' | 'C-3' | 'C-4' | 'C-5' | 'C-6' | 'C-7' | 'C-8' | 'C-9' | 'C-10' | 'C-11' | 'C-12' | 'C-13' | 'C-14' | 'C-15';
  title: string;
  status: CheckStatus;
  expected: number;
  actual: number;
  diff: number;
  summary: string;
  details: CheckDetail[];
}
