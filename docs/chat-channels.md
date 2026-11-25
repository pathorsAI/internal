# LINE／WhatsApp bot（聊天入口）

站內 AI 助理（[ai-assistant.md](./ai-assistant.md)）的另一個入口：員工在 LINE 或 WhatsApp 傳收據照片、
打字問帳務，bot 用同一套引擎（`runTurn`）回答，寫入一樣要按確認卡。這份文件講轉接層怎麼運作、
兩個平台的後台怎麼設定、上線前要做什麼。

程式碼：`src/lib/channels/`（轉接層）、`src/app/api/channels/`（webhook 與佇列處理端）、
`worker.ts` 的 `queue()`、`src/db/chat.ts`（資料表存取）。

## 架構

```
LINE / Meta 伺服器
   │  POST webhook（帶簽章）
   ▼
/api/channels/{line,whatsapp}/webhook
   驗簽（原始 body、constant-time）→ parse → 去重（chat_inbound_events）
   → 送進 Cloudflare Queue `pathors-internal-chat` → 立刻回 200
   │
   ▼
worker.ts queue()  ──（同 isolate 函式呼叫，一次性 token）──▶  /api/channels/process
   │
   ▼
dispatcher.handleEvent（一則事件）
   群組 → 回「請私訊我」（LINE 順便離開）
   沒綁定 → 只認「綁定 123456」，其他回綁定說明（不呼叫 AI、不下載檔案）
   按鈕（確認卡 c:<id>:<action>、組織選單 o:<orgId>）→ 直接處理（搶鎖）
   文字 → 寫進 chat_buffer，排 flush（4 秒後）
   照片／PDF → 下載（≤ 10 MB，只收 image/*、application/pdf）→ STORAGE chat/<orgId>/<uuid>-<檔名>
            → 建收件匣 document（transaction_id、invoice_id 都 NULL）→ 寫進 chat_buffer，排 flush（10 秒後）
   │
   ▼（Queue 的 delaySeconds）
dispatcher.handleFlush（安靜幾秒後）
   暫存區在排程之後又有新訊息 → 結束，交給較晚那次
   搶 chat_identities.busy_until 鎖；搶不到 5 秒後重排
   把未用的訊息依時間合成一題（文字換行串起來、附件全部帶上）
   整則就是指令 → 切換組織／新對話／解除綁定／說明／綁定
   解析引用（被引用的文字放最前面、檔案帶進附件、還開著的確認卡當成修改）
   每題重查角色（getOrgRole）→ runTurn（channel = line／whatsapp）
   → 最終文字（Markdown 轉純文字、[[選項：…]] 轉快速選項）＋待確認的寫入變成確認卡（chat_cards）
   放鎖；暫存區還有訊息就 2 秒後再 flush
```

沒有 `CHAT_QUEUE` binding 時（queue 還沒建、`next start`、本機），webhook 改用 OpenNext 的
`getCloudflareContext().ctx.waitUntil` 在背景處理、用 sleep 代替 delaySeconds；完全沒有
Cloudflare context 時就丟一個不等的 promise。這條路只是讓功能在沒 queue 時不會壞，**正式環境請建 queue**：
Workers 的 waitUntil 在回應送出後只保證 30 秒，照片要等 10 秒、AI 一題可能跑 20–40 秒，會被砍。

### 對話與稽核

- 每人＋每組織＋每平台一段進行中的對話，閒置 6 小時自動開新的；傳「新對話」也會開新的（下一題才開，
  不留空對話）。對話一樣出現在 `/dashboard/ai`，標平台。
- 寫入的 actor 是綁定的那個人，`activity_log.channel` 記 `line`／`whatsapp`。
- 紅色等級的工具（delete_*、merge_parties、pay_employee_salary）在聊天裡不開放，7 支 EXCLUDED_TOOLS 照樣不開。

### 確認卡

| | LINE | WhatsApp |
|---|---|---|
| 一張 | Flex bubble（≤ 30 KB，超過就從最後一列開始砍） | interactive button（≤ 3 顆、標題 ≤ 20 字、body ≤ 1,024 字） |
| 多張 | carousel，每則 ≤ 12 張、≤ 50 KB，超過分多則 | 每張一則 |
| 3 張以上 | 多一張「全部確認（N 筆）」 | 同左 |
| 按鈕 | postback `c:<cardId>:confirm／edit／cancel／all` | reply button，id 同左 |
| 快速選項 | quick reply（≤ 13 個，點了等於打那段字） | ≤ 3 個用按鈕（id `q:<原文>`），超過列成文字 |

卡上寫組織名、操作人、規則提示（ruleHint）；帳號類欄位與文字裡 10 碼以上的長串數字遮成末四碼。
只有開卡的那個人能按；按的時候再查一次角色；同一張卡按兩次只執行一次；卡 24 小時後過期；
問新的一題時舊卡一律收掉。「修改」= 取消那張卡並回「要改哪裡？」，使用者直接打字，AI 重出一張。

### 回覆（引用）前面的訊息

進來的每則與送出的每則都記一筆 `chat_message_refs`（LINE 回應的 `sentMessages[].id`、WhatsApp 的
`messages[0].id`），保留 90 天。使用者引用一則訊息時（LINE `quotedMessageId`、WhatsApp `context.id`）：

- 引用文字 → 題目最前面加「（回覆先前的訊息：「…」）」
- 引用照片／PDF → 那個檔案重新帶進這題的附件（只限目前組織的檔案）
- 引用還開著的確認卡 → 舊卡收掉、題目前加「（修改先前的確認卡：…）」
- 對不到（太舊、bot 上線前）→ 加「（回覆了一則找不到的舊訊息）」，讓 AI 問清楚

### LINE 的 reply token

reply token 1 分鐘內有效。flush 時用最後一則訊息的 token，還在 50 秒內就 reply（不算則數），
否則 push（算進方案的免費則數）。reply 回 400（token 失效）也自動改 push。收到訊息時先開 loading 動畫（60 秒）。

## 要設的 Worker secret

任一平台的 secret 沒設齊，那個平台就整個停用：webhook 回 404、設定頁顯示「尚未啟用」。

| secret | 哪裡拿 |
|---|---|
| `LINE_CHANNEL_SECRET` | LINE Developers → channel → Basic settings → Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API 分頁 → Channel access token（long-lived）→ Issue |
| `LINE_BOT_BASIC_ID` | Messaging API 分頁 → Bot basic ID（含 `@`，例如 `@123abcde`） |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business 的 System User 永久 token（`whatsapp_business_messaging` 權限） |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → Phone number ID |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | 自己產一串亂數，跟 Meta 後台 webhook 設定填的一樣 |
| `WHATSAPP_DISPLAY_NUMBER` | bot 的電話號碼（`+886 9xx xxx xxx`，wa.me 連結用） |

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put LINE_BOT_BASIC_ID
# WhatsApp 那 5 個同樣用 wrangler secret put
```

`OPENROUTER_API_KEY` 是站內 AI 本來就要的；沒設時 bot 會回「AI 助理還沒設定好」。

## 建 queue（第一次部署前）

```bash
wrangler queues create pathors-internal-chat
```

`wrangler.jsonc` 已經有 producer（binding `CHAT_QUEUE`）與 consumer（max_batch_size 1、max_retries 2）。
queue 不存在時 `wrangler deploy` 會失敗，所以要先建。Queues 包含在 Workers Paid 方案裡。

## LINE Developers 後台

1. [LINE Official Account Manager](https://manager.line.biz/) 新開一個內部用的官方帳號（例如「Pathors Internal」），
   不要跟對客戶的派斯官方帳號混用。
2. 帳號設定 → Messaging API → 啟用，選（或新建）一個 provider。
3. [LINE Developers Console](https://developers.line.biz/console/) → 那個 channel：
   - Basic settings：抄 Channel secret。
   - Messaging API：Issue 一個 long-lived Channel access token；抄 Bot basic ID。
   - Webhook URL：`https://internal.pathors.com/api/channels/line/webhook` → Verify（應該回 Success）→ 打開 Use webhook。
     這兩條 webhook 路徑由前哨 Worker `pathors-internal-webhook-ack` 先回 200、再在背景轉給主站驗簽與進佇列
     （主站冷啟動 1–4 秒，LINE 的 Verify 等不了）。所以驗簽失敗時平台也會看到 200，要看 log 的 `[webhook-ack]`。
     見 [deployment.md](deployment.md#webhook-front-pathors-internal-webhook-ack)。
   - 「Auto-reply messages」與「Greeting messages」關掉（在 Official Account Manager 的回應設定），
     不然 LINE 自己的自動回覆會跟 bot 搶著回。
   - 「Allow bot to join group chats」關掉（第一版不支援群組；就算被拉進去 bot 也會說「請私訊我」並離開）。
4. 設好三個 secret、部署。
5. 到 internal → 個人設定 → 聊天帳號 → LINE → 產生綁定碼，點連結加好友，送出預填的「綁定 123456」。

## Meta（WhatsApp Cloud API）後台

1. [Meta for Developers](https://developers.facebook.com/apps/) 建一個 Business 類型的 app，加 WhatsApp 產品，
   綁到公司的 Meta Business 帳號（要先完成商家驗證）。
2. WhatsApp → API Setup：加一支**專用**號碼（不能是手機上正在用的 WhatsApp），完成顯示名稱審核；抄 Phone number ID。
3. Business Settings → System users：建一個 system user，給這個 app 與 WhatsApp 帳號的權限，
   產生永久 token（勾 `whatsapp_business_messaging`、`whatsapp_business_management`）。
4. App settings → Basic：抄 App secret。
5. WhatsApp → Configuration → Webhook：
   - Callback URL：`https://internal.pathors.com/api/channels/whatsapp/webhook`
   - Verify token：跟 `WHATSAPP_VERIFY_TOKEN` 一樣
   - 先設好 secret、部署，再按 Verify and save（Meta 會打 GET 驗證）。
   - Webhook fields 訂閱 `messages`。
6. App 切到 Live 模式（開發模式只收得到測試號碼的訊息）。
7. 到 internal → 聊天帳號 → WhatsApp → 產生綁定碼，點 wa.me 連結送出預填的文字。

Graph API 版本寫在 `src/lib/channels/whatsapp.ts` 的 `WHATSAPP_GRAPH_VERSION`，升級時改那裡。

## 限制

- **群組不支援**：一律回「請私訊我」，LINE 會順便離開群組。
- **WhatsApp 24 小時視窗**：只能在使用者最後一則訊息後 24 小時內自由回覆。bot 只回覆、不主動推，
  所以正常不會碰到；確認卡放超過 24 小時才按，結果訊息可能送不出去。
- **LINE push 則數**：reply 不算則數；AI 超過 50 秒才答完、或分很多則時改 push，算進輕用量方案每月 200 則。
- **檔案**：單檔 10 MB、只收照片與 PDF；更大的請回網頁上傳。沒有確認掛上交易的檔案 30 天後由每日 cron 刪除。
- **語系**：目前沒有存使用者的語系偏好，bot 一律用繁體中文回覆（`src/lib/channels/strings.ts` 有英文版，
  之後有偏好欄位再接）。指令兩種語言都認。
- **統編比對**：轉接層目前跟網頁一樣沒有帶組織統編進 prompt（`orgTaxId`），組織資料有統編欄位後再補。
- **佇列重送**：處理端失敗會重送最多 2 次；照片已經存進 STORAGE 後才失敗的話，重送可能多一份收件匣檔案
  （沒掛上的會被 30 天清理刪掉）。
- **waitUntil 備援**：見上面「架構」最後一段，正式環境要建 queue。
