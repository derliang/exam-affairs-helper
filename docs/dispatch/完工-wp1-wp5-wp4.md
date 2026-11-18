# 完工：#400 WP-1＋WP-5＋WP-4 引擎第一包（v1.26.5，D137）

- 派工：調度員（使用者 2026-11-18 說「開始修正」並同意順序），A 軌：交 PR，不併 main、不發布。
- 分支：`claude/fix-wp1-wp5-wp4-engine`，從 `origin/main` 475eff0（1.26.4）開。
- 版號：1.26.4 → **1.26.5**（`package.json`、`package-lock.json`、`public/version.json`）。
- 決定：**D137**（`docs/decisions.md`）；D135⑧⑨ 與 `docs/todo.md` G40 已更新認領與進度。
- 沒動：畫面版面與匯出檔樣式（只改說明文字字義）、PR #355、補考相關檔、IndexedDB 名稱、vite base、APP_URL。

## 改了什麼

| 項目 | 改法 | 檔案 |
|---|---|---|
| 一份排座名單 | `seatableEntries`＝考試名單（學測選「不排座」才去掉全科缺考者）＋`rosterOnlyEntries`（名冊有、名單沒有，以沒有考科的身分接在後面）；排座引擎輸入、③④⑤、標示建議、抽離預覽、容量、⑤驗證、對帳、輸出都用它 | `src/ui/seating.ts` |
| 引擎不再自己跳過人 | 拿掉 `fullyAbsentCodes`、`RunSeatingResult.fullyAbsent`；版本碼沿用舊鍵 `seatFullyAbsent`，只在真的有沒考科的人時放 | `src/core/run.ts`、`src/qa/invariants.ts` |
| D79 預設改排座 | `seatFullyAbsent` 沒設／true＝排；只有學測存 false 才不排；新考試不沿用 | `src/data/types.ts`、`src/ui/store.ts`、`src/ui/examList.ts` |
| 拿掉原班虛線參考座位 | 刪 `addHomeStudyRef`；對帳刪 `seatRef`／未參加特例，名冊每人從排座結果點去處，沒排座＝遺漏 | `src/export/model.ts`、`src/ui/reconcile.ts` |
| 自習生不印標籤 | 考試名單上考科為空的人有座位、不印標籤 | `src/export/model.ts` |
| 會考每人排座（WP-5） | 名單外、全科缺考都排；對帳「這節沒考」算未參加欄、會考自習應有 0 | `src/ui/seating.ts`、`src/ui/reconcile.ts` |
| 分科共用名單 | `astStudents` 改用同一個 `rosterOnlyEntries`（原本自己算一次） | `src/ui/ast/model.ts` |
| 容量（WP-4） | `classCapacity` 組別表改用 `examClasses`（與排座同一份） | `src/ui/capacity.ts` |
| 查詢、輸出名單 | 名單外的人查得到、輸出姓名有來源；有座位的全科缺考者逐科列去處 | `src/ui/lookup.ts`、`src/ui/exportInput.ts`、`src/ui/pages/Lookup.tsx` |
| 說明文字（只改字義） | ② 全科缺考與名單外說明、匯入精靈、⑤ 不排座說明、⑥ 含自習參考座位頁說明 | `Step2.tsx`、`ImportWizard.tsx`、`Step5.tsx`、`Step6.tsx` |

## 規則 × 考試類型對照表

| 規則 | 學測 | 分科 | 會考 | 補考 |
|---|---|---|---|---|
| 未參加者（名冊有、名單沒有）有座位 | 已改（進引擎） | 已確認符合（1.26.2 起 `astStudents` 已含；本次改用共用名單） | 已改（WP-5） | 不適用（另軌） |
| 全科缺考者預設排座（D79→D137） | 已改 | 已確認符合（`astStudents` 一向含全部名單） | 已改（一律排，不看設定） | 不適用 |
| 自習生也走多數留班／少數抽離、同室不混用 | 已改（測試逐時段逐教室驗） | 已確認符合（D99 `usage` 每教室每時段只有一種用途） | 不適用（沒有自習） | 不適用 |
| 自習生不印標籤、座位表列班級座號姓名 | 已改 | 已確認符合（標籤只看考試座位） | 已改（沒考的人不印標籤） | 不適用 |
| 拿掉繞過引擎的另貼座位（`addHomeStudyRef`）與對帳特例 | 已改 | 不適用 | 不適用 | 不適用 |
| 容量同一份名單（②③⑤、流程摘要、對帳、自習容量） | 已改＋測試 | 已確認符合＋補測試（`astCapacity`） | 已改＋測試 | 不適用 |
| 對帳：名冊每人每時段有座位，沒座位紅燈 | 已改（選「不排座」→M-3 紅） | 已確認符合（既有） | 已改 | 不適用（另軌） |
| 會考不可不參加 | 不適用 | 不適用 | 已改 | 不適用 |
| 教室夠不夠（整間）、對帳 12 項 | 未做（WP-3） | 未做（WP-3） | 未做（WP-3） | 不適用 |
| 自習盡量同一地點、取消自習座位固定 | 未做（WP-2） | 未做（WP-2） | 不適用 | 不適用 |

## 證據

**輸出 sha256 逐位比對**（一次性腳本，未進版控；修改前＝origin/main 475eff0 乾淨樹）：學測 `gsatDoc()`、`gsat270Doc()`／`{junior}`／`{libMathB:'none'}`、會考 `bcctDoc()`、分科 `astDoc` 四組參數（12,12,5／12,4,5／10,12,3／8,30,2）。每組比排座結果、標示規則、容量（自習、班級、預備需求）、對帳完整輸出、座位表與標籤頁面模型（含自習參考頁 true／false／沒給三種）；分科比 plan、容量、對帳、輸出（含／不含自習頁）。**68 項前後全部相同**。唯一改變的是有未參加者的 `gsatDoc({absentRoster:2})` 10 項（依新規則改變，預期內）。

**新測試** `src/ui/engineWp1.test.tsx` 11 項（前 10 項放到 origin/main 跑：7 項紅；3 項綠是「選不排座要紅燈」「沒有未參加者時人數一致」「自習容量與抽離人數一致」，這三項舊版本來就對）：
- 270 人（第 1、4 班各 4 人未參加、兩間預備教室）：每時段每人恰一個去處、同一教室不同時有考試與自習、抽離用途與身份一致；對帳無紅燈、總帳 270＝考試＋自習。
- 只有一間預備教室：排座擋下；自習容量算到未參加者（社會 50 人＞49 座）。
- 全科缺考預設排座：有座位、座位表列出、不印標籤。學測選「不排座」：M-3 紅、擋下載。
- 會考名單少 2 人＋2 人全科缺考：20 人都有座位，總帳〔20,16,0,4〕，標籤 16 張；選「不排座」也照排。
- 人數四處相等：`seatableEntries`、`classCapacity`、流程摘要、對帳名冊、② 匯入統計（考生＋未參加）、③ 畫面考生數、⑤ 畫面考生數。
- 分科 `astCapacity`：全體＝名冊、只自習人數、考場需求＝獨立點的最多考生數、每時段考試＋自習＋排不進＝名冊、自習需求一致。

**舊測試依新規則改寫**（原本在驗 D79 預設不排座或 G36 虛線格）：`core/d79d80`、`core/pickupAbsent`、`export/studyRefHome`、`qa/export.property`（INV-16 標籤數扣掉沒考科的人）、`qa/realStructure`、`ui/huikaoCheck`、`ui/lookup`、`ui/pages/listPages`、`ui/pages/steps123`、`ui/reconcileNotJoined`、`ui/seating`、`ui/statsExportGuard`。

| 指令 | 結果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 118 檔、1299 通過、1 略過（既有） |
| `npm run build` | 成功（chunk 大於 500 kB 警告為既有） |

## 沒驗到的地方

- 沒在瀏覽器實際點過（App 要先授權本機資料夾）；畫面只用 renderToString 檢查人數。
- 沒用真實名冊跑（公開 repo 只用假資料）；本機真實結構測試 `qa/realStructure` 有跑過並通過。
- 補考對帳（C 系列）是否誤套自習算式：沒查（G40 ⑦）。
- 舊存檔升級後會有一部分考試顯示「排座過期」要重排一次（D137⑥），沒在真實存檔上試。

## 我替你決定的事

1. **保留學測「全科缺考不排座」選項**：Issue 寫「改預設」沒說拿掉；但選了一定紅燈（每人都要有座位），建議之後由設計員拿掉這個選項。會考、分科不看它。改回：`skipsFullyAbsent` 改成永遠回 false。
2. **選「不排座」只影響名單上的全科缺考者**，名冊有、名單沒有的人一律排（D125 本來就要排）。
3. **引擎不再自己跳過人**（拿掉 `fullyAbsentCodes`），由畫面層決定輸入名單：避免「引擎一套、畫面一套」。
4. **版本碼沿用舊鍵**，讓沒有這類學生的考試不會全部變過期；代價是少數舊存檔要重排一次（結果相同）。
5. **沒有考科的人不印標籤**（會考也是）：D135⑤；會考這些座位「頂多沒人坐」，不印標籤避免桌上貼了沒人考的標籤。改回：拿掉 `buildLabelPages` 的考科過濾。
6. 夾具 `gsatDoc({absentRoster})` 在有未參加者時把數學 X 標示鎖定（未參加者算進後數學不考比例接近一半，會變成待決定）；沒有未參加者時夾具與舊版相同。
