# Default Theme 不可變與 Theme 編輯分流設計

**日期：** 2026-08-22  
**適用產品：** SlimWeb SaaS MCP、SlimWeb Standalone MCP、Webless SaaS、SlimWeb Standalone  
**一次性資料修復：** EasyDays（`swcb_bofnoha3vtoiehmq`）

## 目標

將 Default Theme 定義為不可變的系統版型。AI 可以讀取、預覽、啟用 Default，並讓網站資料套入 Default，但不能修改 Default 的 Theme 結構、Theme CSS 或設計描述。

當使用者要求修改 Theme 管理的元素時，MCP 必須先辨識目前使用中的 Theme：

- 目前為 Default：直接建立非 Default Theme，再於新版型完成修改。
- 目前為非 Default：先詢問使用者要建立新版型，或直接修改目前版型。

EasyDays 是既有 Default 已被寫入客製內容的歷史例外；必須先把完整外觀移至新版型並啟用，再透過非 MCP 的內部維護程序清除 Default 的歷史覆寫。

## Theme 邊界

下列內容屬於 Theme 管理範圍：

- `navbar` root fragment
- `floating_actions` root fragment
- `footer` root fragment
- root-elements Theme CSS
- Theme style profile，包括摘要、視覺關鍵字、色彩、字體、版面、插圖、避免事項及歷次設計要求
- Theme 名稱、來源、啟用狀態及預覽識別

下列內容是網站內容或網站資料，不屬於 Theme shell 修改：

- 首頁與其他頁面的 body HTML、頁面 CSS 及頁面 JavaScript
- 站名、Logo 媒體、網站類型與聯絡資料
- 導覽項目、商品分類、商品、會員、購物車及訂單資料
- SEO、付款、物流及郵件設定
- 網站層級的明亮／黑暗模式

Default 可以持續接收並呈現上述網站資料。不可變限制只保護 Theme shell、root CSS 與 style profile，不改變現有頁面內容和營運資料的編輯能力。

## MCP 決策流程

### 讀取目前 Theme

任何包含 Theme 管理元素的修改需求，AI 必須先呼叫設計／Theme context 工具。回應必須明確提供：

- 目前使用中的 Theme ID、名稱及 `is_default`
- Theme 管理元素清單
- `theme_edit_policy`
- 建議的下一步

`theme_edit_policy` 至少包含：

```json
{
  "default_is_immutable": true,
  "managed_elements": [
    "navbar",
    "floating_actions",
    "footer",
    "root_css",
    "style_profile"
  ],
  "when_active_theme_is_default": "create_new_theme",
  "when_active_theme_is_custom": "ask_create_or_modify"
}
```

### 目前為 Default

AI 不詢問是否直接修改 Default，因為此選項不存在。流程為：

1. 讀取目前 Default shell context。
2. 建立一個非 Default Theme，來源為目前使用中的 Default。
3. 在新建且尚未啟用的 Theme 上寫入 root fragments、CSS 與 style profile。
4. 預覽並完成 Theme 所需的桌面、手機、導覽、會員、購物車與浮動操作驗證。
5. 啟用新版型。
6. 重新讀取 active Theme，確認已不再使用 Default。

新 Theme 名稱應根據品牌或本次設計目的產生清楚名稱；名稱衝突時必須重新命名，不得退回修改 Default。

### 目前為非 Default

AI 必須先詢問使用者二選一：

1. 建立新版型：複製目前使用中的非 Default Theme，修改新 Theme，預覽驗證後再啟用。
2. 直接修改目前版型：取得使用者明確確認後，修改 active Theme。

直接修改 active custom Theme 的寫入請求必須帶 `confirmed_active_theme_edit: true`。後端只在目標 Theme 是目前使用中的非 Default Theme 時要求此欄位；新建且尚未啟用的 Theme 不需要此確認欄位。

### 建立新版型的來源

現有 `slimweb_themes_create_from_default` 保留相容性，繼續建立以 Default 為來源的新 Theme。

新增 `slimweb_themes_create_from_theme`，使「目前為自訂 Theme，使用者選擇建立新版型」不會退回系統 Default 或遺失既有 shell：

```json
{
  "name": "新版型名稱",
  "source_theme_id": 42
}
```

來源 Theme 可以是 Default 或非 Default，但只能讀取與複製；此動作不修改來源 Theme。複製範圍包含 root fragments、root-elements assets 與 style profile，不複製首頁或其他 page body。

後端使用現有 `POST /themes` 路由建立 Theme：`slimweb_themes_create_from_default` 不傳 `source_theme_id`，`slimweb_themes_create_from_theme` 必須傳入 `source_theme_id`。Theme service 依是否存在 `source_theme_id` 選擇 Default 或指定來源，並回傳實際 `source_theme`。

## 強制保護

### MCP Core

共享 MCP Core 必須：

- 在工具說明中明確宣告 Default 不可修改。
- 要求所有 Theme 修改先讀取 active Theme 與 `theme_edit_policy`。
- 將 `confirmed_active_theme_edit` 納入 root-elements 與 style-profile 寫入 schema。
- 提供 `slimweb_themes_create_from_theme` 及其 `source_theme_id` schema。
- 對明確的 `theme_id: "default"` 寫入在呼叫後端前直接回傳驗證錯誤。
- 保留後端對數字 Default ID 的權威判斷。

SlimWeb-MCP 與 SlimWeb-Standalone-MCP 必須使用同一版本的 MCP Core，避免 SaaS 與單機版工具說明、schema 或流程分歧。

### SaaS 與 Standalone 後端

Webless SaaS 與 SlimWeb Standalone 的 Theme service 都必須在解析 Theme 後檢查 `is_default`，並拒絕：

- Default root-elements HTML 寫入
- Default root-elements CSS 寫入
- Default style profile upsert
- Default style profile request append

拒絕必須同時涵蓋字串 `default` 與 Default 的數字 ID，回傳一致且可供 MCP 映射的 validation error：

```text
Default theme is immutable. Create a new theme before changing theme-managed elements.
```

若目標是目前使用中的非 Default Theme，後端必須驗證 `confirmed_active_theme_edit === true`。若未確認，回傳要求先詢問使用者的 validation error。

後端保護是資料完整性的權威邊界；MCP 說明或前置檢查不能取代後端檢查。

## 不新增 Default 還原 MCP 工具

一般 MCP 不提供 Default reset、restore 或任意覆寫工具。新規則生效後，Default 不會再累積 Theme 客製內容，因此正常流程不需要還原功能。

歷史污染資料只能透過具名、可稽核的內部維護程序處理。該程序不列入 MCP 工具目錄，也不能被一般 AI 對話呼叫。

## EasyDays 一次性遷移

EasyDays 目前 active Theme 是 Default，且 Default 已含客製 navbar、footer、root CSS 與 style profile。遷移採 copy-first、verify-first，不直接搬移或覆寫來源。

### 遷移前備份

記錄並備份：

- Default Theme ID 與 active 狀態
- `navbar.blade.php`
- `floating-actions.blade.php`（若存在）
- `footer.blade.php`
- root-elements CSS 全部檔案
- Default style profile
- 每個備份檔案的路徑、大小與 SHA-256

不得備份、移動或刪除 `templates/default/pages/**`，因為它們是網站頁面內容，不在 Theme shell 修復範圍。

### 建立並驗證新 Theme

1. 在清理 Default 前建立名稱為 `EasyDays` 的非 Default Theme。
2. 複製目前 Default 的完整 Theme shell、root assets 與 style profile。
3. 比對來源與新 Theme 的 fragment 內容及 SHA-256。
4. 使用 preview URL 驗證新版型。
5. 啟用 `EasyDays` Theme。
6. 驗證正式前台的 navbar、footer、配色、響應式行為、會員、購物車、分類導覽、浮動操作及無水平溢位。

若新 Theme 的複製或驗證失敗，停止流程，保留 Default active，不執行清理。

### 清理 Default 歷史覆寫

新版型啟用並通過驗證後，使用 Webless 內部維護命令清除以下 Default 客製資料：

- `templates/default/root-elements/**`
- `templates/default/assets/root-elements/**`
- Default Theme 對應的 style profile row

內部命令必須：

- 僅接受明確的 EasyDays site code。
- 確認 active Theme 已是指定的非 Default `EasyDays` Theme。
- 確認備份清單及 SHA-256 已存在。
- 支援 dry-run，先列出將刪除的精確物件與資料列。
- 不得接觸 `templates/default/pages/**`。
- 將操作結果寫入可保存的遷移報告。

清理後以 Default preview 驗證系統內建 navbar、footer 與 CSS fallback，再重新驗證 active `EasyDays` Theme 外觀未變。

## 錯誤處理與中止條件

- active Theme 無法確認：不執行任何 Theme 寫入。
- Default 寫入：拒絕並指示建立新版型。
- active custom Theme 未取得明確確認：拒絕直接修改。
- Theme 複製不完整或 checksum 不符：不啟用新 Theme。
- 新 Theme 預覽失敗：保持原 active Theme。
- EasyDays 尚未成功啟用非 Default Theme：禁止清理 Default。
- EasyDays 備份或 dry-run 清單不完整：禁止清理 Default。
- Default 清理不得以遞迴刪除整個 `templates/default` 目錄實作。

## 測試策略

### MCP Core

- 工具說明列出 Theme 管理元素與 active Theme 分流規則。
- `theme_id: "default"` 的 root-elements、style-profile upsert 與 append 在 repository call 前失敗。
- active custom Theme 直接寫入 schema 包含確認欄位。
- 指定來源 Theme 的建立工具正確傳遞 `source_theme_id`。
- SaaS 與 Standalone tool profile 都包含一致工具與 schema。

### Webless SaaS 與 SlimWeb Standalone

- Default 字串 ID 拒絕 root-elements 寫入。
- Default 數字 ID 拒絕 root-elements 寫入。
- Default 拒絕 style profile upsert 與 append。
- active custom Theme 未帶確認欄位時拒絕寫入。
- active custom Theme 帶明確確認時允許寫入。
- inactive custom Theme 可在建立新版型流程中寫入。
- 從指定 custom Theme 建立新 Theme 時，shell、assets 與 style profile 完整複製，pages 不複製。
- Default 的讀取、預覽、啟用與網站資料套用不受影響。

### EasyDays 驗收

- 後台顯示 `Default` 與 `EasyDays` 兩個 Theme，active 是 `EasyDays`。
- 正式前台在遷移前後保持相同 navbar、footer 與整體 Theme 外觀。
- Default preview 使用系統內建 shell，不含 `.ed-shell-*` 客製樣式。
- `templates/default/pages/index/content.blade.php` 與其他頁面內容仍存在且內容未變。
- MCP 對 EasyDays Default 的字串與數字 ID 寫入都回傳不可變錯誤。
- 必要寬度的前台驗證沒有水平溢位，導覽、會員、購物車與浮動操作可用。

## 發佈與版本順序

1. 在共享 MCP Core 完成合約與測試。
2. 在 Webless SaaS 與 SlimWeb Standalone 完成後端強制保護及測試。
3. 發布新的 MCP Core 版本。
4. 更新 SlimWeb-MCP 與 SlimWeb-Standalone-MCP 依賴並通過各自測試。
5. 部署／發布 SaaS 與 Standalone 對應版本並確認工具契約一致。
6. 執行 EasyDays 新 Theme 建立、複製、預覽、啟用。
7. 執行 EasyDays Default 內部 dry-run 與歷史覆寫清理。
8. 完成 Default preview、active Theme、前台與 MCP 拒寫驗收。
