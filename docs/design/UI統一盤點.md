# UI 統一盤點（稿 v2.72；DF-43／#413；2026-11-18；待使用者審，只盤點、不改程式、不改規範）

> 起因：使用者「明明就是現有的樣式，你又給我弄一套新的，然後整個程式裡面，一樣的工作有各種不同的UI」。
> 方法：讀 `src/ui/` 與 `src/styles/app.css`，對照元件（`src/ui/components/index.tsx`）。以下每一項都標了檔案與類別名；**標「推論」的是我只看了檔案開頭或註解、沒逐行驗證的**。
> 規則（使用者）：既有已通過的畫面不動，只把其他入口統一成它。使用者指定以哪套為準後，我才改 DESIGN.md 與稿。

## 最要使用者裁示的 10 項（嚴重度與有感程度排序）

| # | 同一件工作 | 現有畫法數 | 我建議以哪套為準 |
|---|---|---|---|
| 1 | 教室清單與座位編輯 | 4 套 | 考試 ③ 的 `RoomList`（使用者 2026-11-18 截圖指定）；座位編輯區用現行 `SeatGrid` |
| 2 | 刪除確認 | 5 套 | `ConfirmButton／ConfirmModal`（會刪掉／不會動＋復原提示），一律拿掉「輸入名稱」 |
| 3 | 還原預設／重置 | 3 套 | `ConfirmButton`＋任何時候可按 |
| 4 | 前往與返回的按鈕文字 | 8 種寫法 | 跳到別頁＝「到 ○○ ›」、返回＝「← 回到 ○○」、做完＝「回模擬考列表」 |
| 5 | 展開／收合 | 6 套 | 「標題＋▾／▴」一種符號、一種字樣 |
| 6 | 提示條 | 3 套 | 問題與警示一律 `Alert`；`hint` 只留欄位旁小提示 |
| 7 | 空白狀態 | 2 套 | `EmptyState` |
| 8 | 開／關控制 | 2 套 | 「列入／啟用」用 `Switch`，「勾選項目」用 checkbox，寫成規則 |
| 9 | 頁名與詞彙 | 多組同義詞 | 以 DESIGN 步驟名為準，一件事一個名字 |
| 10 | 窄寬度的表格與預覽 | 捲軸 vs 堆疊卡片 | 沿用 `ReconcilePanel` 的「表格＋卡片」做法，不用捲軸 |

兩類原因：**A 已有共用元件但被繞過**（2、3、6、7、8）；**B 根本沒有共用元件**（1 的座位編輯容器、4、5、9、10）。

## 逐項對照

### 1 教室清單與座位編輯（4 套）
| 畫法 | 位置 | 特徵 |
|---|---|---|
| A 考試 ③ 教室清單 | `src/ui/components/RoomList.tsx` `RoomList`（約 37 行；用在 `Step3.tsx:132`） | 列入開關＋名稱輸入框＋座位縮圖（`SeatThumb`）＋排×深位＋座位統計＋組別＋「▸ 編輯座位／▾ 收合座位」；展開區＝套用範圍＋`SeatGrid`（含「收合」鈕、步進器、座標格、講臺）。**使用者 2026-11-18 截圖指定「統一改成這種樣式」（DF-41／DF-42）** |
| B 共用設定教室清單 | 同檔 `RoomTable`（約 178 行；用在 `Settings.tsx:57`） | 表格：名稱／類型／橫排×深位／可排座位／「編輯座位／收合座位」（**無「▸ ▾」符號**）；無縮圖、無開關、有「複製」與刪除 |
| C 精靈步驟 4 | `src/ui/pages/EnvWizard.tsx` 約 206～209 | 班級教室唯讀表＋一顆「教室清單 ›」按鈕（名詞）；使用者 #367、#369、#370 已要求改 |
| D 分科 ③ | `src/ui/ast/AstStep3.tsx` 約 249～266、36、90～91 | 「教室與座位圖」自己的列與「收合本次座位圖」；另一套按鈕文字 |

建議：以 A 為準。B、C、D 改成 A 的列與同一個展開區；開關只在考試用清單出現（共用設定、精靈沒有「這次考試用不用」，推論）。需改畫面：共用設定「教室清單」、精靈步驟 4、分科 ③。

### 2 刪除確認（5 套）
| 畫法 | 位置 |
|---|---|
| A 標準 | `ConfirmButton／ConfirmModal`（`components/index.tsx:182、192`）；用在 `Settings.tsx:272`（刪班級）、`RoomList.tsx:134`、`Step1.tsx:69`（刪考科）等 |
| B 刪除考試 | `src/ui/pages/Exams.tsx:11～23` 自訂 `Modal`＋**輸入考試名稱** |
| C 刪除全部名單 | `src/ui/pages/RosterIO.tsx:175`（註解 160 行寫要求輸入確認文字，推論） |
| D 教室移除 | `RoomList.tsx:242～252` `RoomRemove` 自訂 `Modal`＋勾選「同時從共用設定刪除」 |
| E 瀏覽器原生 | `src/ui/ast/AstSchedule.tsx:29` `window.confirm` |

建議：以 A 為準（有「會刪掉／不會動」與復原提示）；B 拿掉輸入名稱（使用者 #350 已要求）；C 同；D 的「勾選」保留在 A 的視窗內容裡；E 換成 A。

### 3 還原預設／重置（3 套）
A `ConfirmButton`（`Step1.tsx:50` 還原考科表、`AstStep3.tsx:92` 還原）；B `Settings.tsx:319` 注意事項的「還原預設」＝`Button disabled={isDefault}`（**使用者 #364 抱怨「無法按」的同類**）；C 新增的「新學年重置／全部重置」（稿 v2.62，尚無程式）。建議：全部用 A，且不 disabled（沒變動時按了給「已是預設」回饋，我的建議）。

### 4 前往與返回的按鈕文字（8 種）
「回模擬考列表」（`Step6.tsx` 多處、`AstStep6.tsx:167`）、「前往模擬考列表」、「← 回到 {頁名}」（`App.tsx:235`、`Privacy/Copyright`）、「← 返回」、「到共用設定看教室清單」（`Step3.tsx:124`、`AstStep3.tsx:253`）、「教室清單 ›」（`EnvWizard.tsx:207`）、「到學生名單」、「去 ② 考試名單」（`ReconcilePanel.tsx`）、「到 ③ 教室設定 ›」。
建議：**跳到別頁＝「到 ○○ ›」；返回＝「← 回到 ○○」（DESIGN 10.1 已規定要寫清楚哪一頁）；流程做完＝「回模擬考列表」**，其他寫法併入。

### 5 展開／收合（6 套）
`<More>`（說明，`index.tsx:370`）、`rc-more`「明細 ▾／▴」（`ReconcilePanel.tsx`）、`RoomList`「▸ 編輯座位／▾ 收合座位」、`EnvCard.tsx:50` `linkbtn aria-expanded`、`<details class="moremenu">「⋯」`（`RoomList.tsx:130`）、`Copyright.tsx:32 <summary>展開…`、`ImportWizard.tsx:159`（Button 切換）。符號（▾▴、▸▾）與字樣（明細／收合座位／展開）不一。建議：一種——「標題＋▾（收）／▴（開）」，字樣只用「展開／收合」或各處固定的名詞，由使用者指定。

### 6 提示條（3 套）
`Alert`（`index.tsx:36`，全站 159 處，tone ok／warn／danger／info）、`class="hint"`（38 處，`app.css`）、`<p class="small muted">`（空白與說明）。建議：問題、警示、完成回饋一律 `Alert`；`hint` 規定只用在欄位旁；`small muted` 只當補充說明。

### 7 空白狀態（2 套）
`EmptyState`（9 處）vs 自寫 `<p class="small muted">還沒有…`：`AstStep3.tsx:207、221、266`、`AstSchedule.tsx:85`、`AstLocks.tsx:73`、`Exams.tsx:95` 等。建議：`EmptyState`（標題＋說明＋動作）。

### 8 開／關控制（2 套）
`Switch`（`index.tsx:319`；只有 `RoomList.tsx:104` 列入開關、`Settings.tsx:369` 選用功能）vs 原生 checkbox（14 處：`AstStep6`、`FolderUi`、`ImportWizard`、`ReconcilePanel`、`RosterIO`、`Schedule`、`Step2`、`Step6` 等；用途我沒逐一讀，推論多是「勾選項目」）。建議：把「啟用／列入」寫成 `Switch`、「勾選項目」寫成 checkbox，列入 DESIGN 元件規則。

### 9 頁名與詞彙（多組同義詞）
教室：「教室清單」（設定頁籤、`EnvWizard`、`AstStep3`）／「教室設定」（`Step3` 標題與 `ReconcilePanel`）／「教室與座位」（`Step3` 小節）／「教室與座位圖」（`AstStep3`）／「教室與自習空間」（分科 ③）／「時段教室與座位」（分科 ⑤）。座位：「參考座位」46 處、「自習參考座位」21 處、「自習座位」1 處（已登記 #396）。建議：以 DESIGN 步驟名為準；同一件事全站一個名字，由使用者指定。

### 10 窄寬度的表格與預覽（2 套）
`class="scroll"` 26 處（橫向捲軸）vs `ReconcilePanel` 的 `rc-table`＋`rc-cards`（窄時改堆疊卡片，`app.css` 約 1080 行）。使用者已要求不要捲軸（#378、#408）。建議：以後者為準，列成規則；標籤範例 iframe 高度改量內容。

## 另外觀察（量少，列在此，待你要不要處理）
- 進度顯示：`StepNav` 的「第 N／6 步」（`index.tsx:100`）、`SummaryBar`、列表「進行中（N）」分區；#362 已登記。
- 視窗按鈕：「取消」17、「儲存」5、「關閉」2；新增編輯視窗用「儲存」，確認視窗用 `ConfirmCopy.confirm` 自訂字，沒有統一表。

## 沒做的
沒有量到每個畫面的實際截圖，只對照程式碼；匯出檔（座位表、標籤）的樣式差異已在 DF-31～DF-40 與稿 v2.63 處理，這份不重列。使用者指定以哪套為準後，我才改 DESIGN.md、稿與稿版號。
