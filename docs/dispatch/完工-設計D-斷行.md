# 完工：設計員施工包 D（斷行修正 Issue 511、512、514、515、516）

分支 `claude/linebreak-fix`，程式 1.27.3（調度員最後統一調整）；稿 v2.86，成品 https://claude.ai/artifact/3zVxnKtrtVwyRaW8fyvNAE

## 規則（DESIGN 10.45、`mockups/斷行規則稿.html`）
- R1 全站 `body{text-wrap:pretty}`（#516、#515 句尾孤字、#514 部分短句）。
- R2 `.nb`（nowrap）：列表卡進度／日期範圍／最後修改時間、「最少排數」「最少深位」、「3 分鐘」（#511、#514）。
- R3 列表卡單欄斷點 700 → 960px（#511）。
- R4 步驟欄 208／230 → 248px、副標 balance；900px 以下步驟欄移到內容上方（原 760）（#512、#514 ③ 768）。

## 驗證
- tsc、`npx vitest run` 全套：`npx tsc --noEmit` 無錯誤；`npx vitest run` 159 檔 1552 通過 1 skipped；`npm run build` 成功；新增 `src/styles/css.test.ts` 斷行規則 2 項。
- 前後截圖（假資料、Chrome headless，`scripts/compare-shots` 播種）：`docs/verify/screenshots-linebreak/linebreak-D-{before,after}-*.jpg`（列表 768、步驟①／③、教室清單）。另用腳本掃描全部文字節點的折行（學測①②③⑤、會考③、共用設定三頁 × 375／768／1280），修改前後清單：步驟欄副標在 768／1280 不再折行、列表卡進度與日期不再被拆。
## 未驗到
- 剩餘折行多為正常段落自然換行（掃描只標「短文字或末行短」）；375 的 `th` 為隱藏表頭誤報；#515 提到的 375「學校與表頭」input 超出未處理（本次掃描該頁沒有偵測到橫向溢出，未逐項目視）。
- 分科、補考、暗色模式、隱私權／版權長段落未逐頁截圖（只靠 R1 全站規則）。
- `text-wrap:pretty` 為 Chrome／Edge 117+；其他瀏覽器忽略（退回原行為，不影響使用）。

## 規則對照
- D135／D137：不涉及（只改樣式與斷行）。
- 設計系統規範：樣式數值先定於 DESIGN 10.45 與稿，再實作；沿用 `.nb` 工具類別，未新增元件。
- #513（設計員 A 的 keep-all 規則）：並存，未動 `src/ui/makeup/*`。

## 我替你決定的事
稿版號 v2.86、程式版號 1.27.3（依當時 main）；步驟欄收合斷點由 760 改 900 會讓 768 平板直式的步驟欄移到上方，可改回。
