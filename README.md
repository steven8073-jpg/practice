# 商品掌櫃

使用 Supabase 儲存商品的靜態商品管理網頁。登入後可在不同裝置使用同一帳號管理商品。

## 啟動

1. 在 Supabase 專案的 SQL Editor 執行 [supabase/schema.sql](supabase/schema.sql)。資料表啟用 Row Level Security，每位登入使用者只能讀寫自己的商品。
2. 將專案 URL 與 **publishable key** 填入 `config.js`。本專案已依資料夾中的 `.env.local` 產生此檔。`.env.local` 已列入 `.gitignore`；不要將 secret 或 service role key 放入前端檔案。
3. 在專案目錄執行 `node server.js`，開啟 <http://localhost:8000>。請使用 HTTP 網址，避免直接以 `file://` 開啟。
4. 用電子郵件與密碼建立帳號。若 Supabase 要求驗證電子郵件，完成信箱中的驗證後再登入。專案的 Auth Redirect URLs 應允許 `http://localhost:8000/`。

## 功能

- 新增、編輯、刪除商品；記錄名稱、商品編號、分類、整數新台幣售價、庫存、說明與上下架狀態。
- 搜尋商品名稱、編號、分類，依分類或上下架狀態篩選。
- 在列表直接調整庫存與上下架狀態；庫存不得為負數，兩種狀態互不影響。
- 按「重新整理」讀取其他裝置上的最新變更。
- 匯出 JSON 備份；匯入備份會在確認後以一個資料庫交易取代目前帳號的商品。
- 若此瀏覽器有舊版 `localStorage` 商品，登入後可按「匯入舊版瀏覽器資料」搬移到 Supabase。成功後仍保留舊版資料作為備份。

`config.js` 的 publishable key 會出現在瀏覽器中，這是 Supabase 預期的用法。真正的資料隔離由登入狀態、資料表權限及 RLS 規則負責。
