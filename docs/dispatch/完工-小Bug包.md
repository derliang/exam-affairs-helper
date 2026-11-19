# 完工記錄：小 Bug 包（v1.26.18）

分支 `claude/small-bugs-1-26-18`（從 `origin/main` ded3085、v1.26.17 切出）。決定 D151、待辦 G42。已讀 D145～D150。

## 逐項

| 項 | 現況查證 | 處理 |
|---|---|---|
| #371 匯出班名表 | `src/export/model.ts` `ctxOf` 已只取本部別班級（`division === exam.division`），`attendance.ts` 同；`batchA.test.ts`「匯出班名表只用本部別的班級（#371）」已鎖住（1.26.2 修復包 A，b011128） | 已修，不需改；建議調度員關 Issue |
| #269 綜合教室座位表頁數 | `ast/output.ts` `estimatePages` 已含輪流清單並依 Word／Chrome 實測列數估頁（b011128、83c0fa9）；`output.test.tsx` 有測試 | 已修，不需改；沒有用 119 人實際資料重驗 |
| #374 確認鈕 | `ImportWizard.tsx` 原寫「確認匯入 N 人（取代本次名單）」 | 改成「確認匯入 N 人」（保留人數）；測試 `g18g19g20.test.tsx` 鎖住 |
| #362 已完成 N 步 | `StepNav` 數所有 `done` 步驟，停在第 1 步而後面步驟資料已符合條件就多算 | 只算目前步驟之前的 done 步驟；測試 `pageHead.test.tsx` 新增一項 |
| D145 快速模式只限會考、Settings 文案 | `features.ts` 的 `bcct-quick-mode` scope＝bcct、`isEnabled` 非會考回 false（`features.test.tsx` 已有）；`Settings.tsx:280` 已是「班級色只用在座位表…」 | 已落實，不需改 |
| 缺考／不參加徽章改灰 | 步驟② 已沒有「全科缺考」琥珀徽章（D146／D148 後改成文字說明；`Step2.tsx:354` 是 ≥20% 才出的 warn **Alert**，是提醒不是徽章） | 不需改；該 Alert 要不要改色屬樣式決定，未動 |

## 我替使用者決定
- #374 保留「N 人」。
- #362 用「只算目前步驟之前」；步驟旁的勾、總覽頁 ✓／▲ 沒動（要改成「走過才勾」需設計與使用者裁示）。

## 驗證
見 PR 描述（tsc、vitest 全套、build）。畫面只有一個按鈕文字與一行進度文字，沒用 dev server 逐一看三種寬度與深淺色（沒新增版面）。
