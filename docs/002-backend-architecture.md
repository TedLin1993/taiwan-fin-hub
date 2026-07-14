# 後端架構與維護約定

後端執行於 Cloudflare Worker。`apps/worker/src/index.ts` 是組裝入口，新增功能時應優先依下列邊界放置，避免再次把路由、SQL 與商業流程集中到入口檔。

## 目錄責任

- `apps/worker/src/routes/`：HTTP 路由、request schema、response mapping。
- `apps/worker/src/http.ts`：跨路由的錯誤格式、Demo 唯讀限制與分頁工具。
- `apps/worker/src/classification.ts`：可獨立測試的分類規則與分類服務。
- `apps/worker/src/esun.ts`、`cathaybk.ts`：需要 Browser Rendering binding 的 Worker connector。
- `packages/connectors/`：不依賴 Worker binding 的外部資料來源 client 與解析流程。
- `packages/db/`：D1 repository、同步工作狀態與 migration。
- `packages/core/`：前後端共用的資料契約與 connector 型別。

## API 約定

- Demo 模式只允許 `GET`、`HEAD`、`OPTIONS`；前端停用按鈕不能取代後端限制。
- 所有 body、query 與 path 參數都必須經過 Zod 驗證。
- 預期的輸入錯誤回傳穩定的 `4xx` error code；未預期錯誤只記錄在 Worker log，回應不得包含原始 exception message。
- 大型列表支援 `limit`、`offset`，`limit` 上限為 100。回應維持既有 array 格式，並透過 `X-Has-More`、`X-Next-Offset` 表示下一頁。
- `GET` 路由不得建立預設資料；初始化資料應放在 D1 migration。

## 同步工作

- 同一 connector 共用 `${connectorId}:all` lock，避免手動與排程同步重疊。
- lock lease 為 30 分鐘，執行期間每 5 分鐘續租。
- 每次 cron tick 最多依序處理 3 個到期工作，避免單一工作長期阻塞其他 connector。
- 需要使用者重新登入或輸入 OTP 時，工作狀態設為 `needs_user_action` 並停用排程。

## 驗證指令

```bash
npm run typecheck
npm run test:backend
npm run test:unit
npm run test:e2e
npm run build
```

新增 connector 行為時，必須將 synthetic self-check 接到 `packages/connectors` 的 `test:selfcheck`，不能只保留成無人執行的腳本。
