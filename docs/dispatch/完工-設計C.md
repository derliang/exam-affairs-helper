# 完工記錄：設計員施工包 C（2026-11-21）

分支 `claude_desktop/design-overview-310238`，起點 origin/main 1.26.38。

## 做了什麼
1. **全站各頁成品稿總覽**（稿 v2.83）：`docs/design/mockups/全站各頁成品稿總覽.html`＋`overview-shots/`（24 張現行畫面截圖）。成品：https://claude.ai/artifact/C7VT8RQmGn9PhshLQW943L 。
2. **Drawer 元件**（稿 v2.81、程式 1.26.39）：`src/ui/components/Drawer.tsx`、`Drawer.test.tsx`、`app.css` 末段；設計系統頁 #v281 範例。設計系統成品（新網址）：https://claude.ai/artifact/PJFfc75qFnWoDq1hS1BBG2 。
3. **補考稿第 3 步與補考卡文案**（稿 v2.82）：補考稿型別按鈕「一般／特別」、U-4 提示；H0 稿補考卡文案。成品：補考 https://claude.ai/artifact/3AkeEceqtVfvBtQBZJDrqB 、H0 https://claude.ai/artifact/3edb4uyZ9C2Sk9itLVeqNv 。

## 驗證
- `npx tsc --noEmit`：無錯誤。
- `npx vitest run`：150 檔、1514 項通過、1 skipped（含 Drawer.test.tsx 3 項）。
- `npm run build`：成功。
- 設計系統頁 Drawer 示範在瀏覽器實開（右側面板、遮罩、關閉）；總覽用本機記憶體示範模式截圖（暫時修改已還原、未進版控）。

## 沒驗到
- Drawer 元件本身在補考儀表板的實際行為（Esc、焦點回到開啟鈕、375 底部面板）：專案無 DOM 測試環境，只測輸出結構與樣式，行為待換上 `MkSummaryBar` 時實測。
- 總覽：只有首屏截圖、寬度 1280／375，無 768；步驟 ②～⑥ 只有未匯入名單狀態；分科、預備教室、查詢、補考七步驟未截；各頁與稿的差異只確認 P04 兩項，其餘標「未逐項核對」。

## 需決定／注意
- 三個既有成品（設計系統、補考、H0）舊網址無法就地更新（設計系統 404；另兩份 1.3MB／85KB 未逐行讀過不能覆蓋），所以發了**新網址**，`稿版號.md` 成品清單已改，舊網址作廢。
- 版號：origin/main 歷史被改寫（hash 全變）且已到 1.26.41、稿 v2.80 被包 B 用掉，所以整包重做在新 main 上：程式 1.26.43、稿 v2.81～v2.83；若再撞號請調度員統一調整。舊 PR #520 已關，改開新 PR。
- H0 稿仍畫補考卡為停用＋「即將推出」，現行已啟用：要不要改稿？
- 程式 `NewExam.tsx` 補考卡文案待施工改成新文案。
- 規則對照見 DESIGN §10.46。
