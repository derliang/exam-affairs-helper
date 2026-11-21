# 補考 K-後續 完工記錄（v1.26.42，A 軌，不自行併 main）

## 做了什麼
1. 補考卡文案（`src/ui/pages/NewExam.tsx`）：「為缺考或不及格的學生另排場次、教室、座位與標籤，由教務系統名單匯入」；適用部別維持「高中部、國中部」。
2. U-8（D184）：`src/core/makeup/byDay.ts`（`reconcileByDay`、`crossDayDuplicates`）、`MkDashParts.tsx` 的 `DayReconcileCard`（既有 `Seg` 切換）、`MkStep6.tsx` 接上；測試 `byDay.test.ts`（3 項）、`dashboard.test.tsx`（2 項）；spec U-8、decisions D184。
3. 版號 1.26.41（package.json、package-lock.json、public/version.json）。

## 沒做／待決
- **#505 未做**：Issue 要求「拿掉新增模擬考的補考卡」，與使用者另裁的「補考卡文案改缺考或不及格」（卡片保留）衝突；補考空白頁兩顆新增鈕的重設計稿未定，需設計員補稿。
- Drawer 換掉 `MkSummaryBar` 的 Modal：等設計員 C 元件併入。
- 沒有做瀏覽器實測（只有 renderToString 測試）。

## 驗證
`npx tsc --noEmit` 無錯；`npx vitest run` 152 檔 1521 過、1 skipped；`npm run build` 成功。

## 我替你決定的事
- 跨考日重複判定：同學號＋同科目鍵、年級落在不同考日（年級對考日是一對一，故成因為同學號舊班不一致）。
- 「依考日對帳」只在考日≥2 才顯示，不改 C-1～C-15 與閘門。
