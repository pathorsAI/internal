# In-app AI assistant

`/dashboard/ai` lets a member ask about and change the books in plain words, without
connecting an external agent. The homepage input box and ⌘K (Ctrl+K) send a question
there and open a new chat. Design proposal: Pensieve `internal/internal-ai-assistant`
(option C).

## How a question runs

```
homepage box / ⌘K ──► /dashboard/ai ──► POST /api/ai/chat (NDJSON stream)
                                          │ requireOrg → org + user, role
                                          │ pick tool groups (keywords → last question → ledger)
                                          ▼
                                   OpenRouter (AI_MODEL, streaming)
                                          │ tool calls
                                          ▼
                    src/lib/mcp/tools — called in-process (runToolWithAudit), never over HTTP
                     read  → runs now
                     write → saved as a pending tool result + confirmation card; runs on Confirm
```

| Piece | Where |
| --- | --- |
| Model name, limits, key lookup | `src/lib/ai/config.ts` (`AI_MODEL`, `OPENROUTER_API_KEY`) |
| Read / write / red classification, excluded tools, role rules | `src/lib/ai/tool-policy.ts` |
| Tool groups and keyword preselection, `load_tool_groups` | `src/lib/ai/tool-groups.ts` |
| Loop, confirmations | `src/lib/ai/engine.ts` |
| System prompt | `src/lib/ai/prompt.ts` |
| Endpoint | `src/app/api/ai/chat/route.ts` |
| Storage | `ai_conversations`, `ai_messages` (`migrations/0036_ai_assistant.sql`, `src/db/ai.ts`) |
| UI | `src/app/dashboard/ai/*`, `src/components/ai/*` |

## Rules worth knowing before you change it

- **Read vs write is decided by name prefix, not `readOnlyHint`.** Most tools don't set the
  hint. Anything that is not on the read list is a write and needs confirmation — a new tool is
  safe by default. `tool-policy.test.ts` walks every tool and fails if one is in no group.
- **Never offered to the in-app assistant:** `simpany_issue_invoice`, `simpany_void_invoice`,
  `simpany_send_payslips`, `simpany_upload_tax_files`, `simpany_create_tax_upload_slots`,
  `simpany_apply_salary_filing`, `simpany_settle_salary_filing` (they act outside the books and
  can't be taken back), plus the org-switching tools. They stay available over MCP.
- **Roles:** owner / admin get everything above (writes still confirmed); members get reads, plus
  `submit_advance` for their own advances and personal rules (see below). Checked again when a
  card is confirmed, not just when tools are offered.
- **Org:** fixed to the signed-in org. `organizationId` is removed from every schema shown to the
  model and overwritten on every call.
- **Audit:** writes land in `activity_log` with `channel = 'ai'` (web) or `'line'` / `'whatsapp'`
  (chat) and the member who confirmed as the actor; the summary is the line the confirmation card
  showed. The activity log page labels all four.
- **Conversations** are private to the user and scoped to the org they were started in.

## Chat entry: LINE and WhatsApp

The same assistant answers in LINE and WhatsApp. Both the web route and the chat bots call
`runTurn()` (`src/lib/ai/turn.ts`), so prompt, tools, rules and confirmations are shared; the
channel only changes the prompt section (short plain text, at most one question) and what is
offered. Architecture, platform setup (LINE Developers, Meta), secrets, the queue and limits are in
[chat-channels.md](chat-channels.md).

- **Linking** is personal: 設定 › 聊天帳號 (`/dashboard/settings/chat`, every member) issues a
  6-digit code valid for 10 minutes, with an "Open LINE / WhatsApp" link and a QR code that open the
  bot with `綁定 123456` filled in. The page polls and closes itself once the bot has linked the
  account; it also shows the linked name, the org the bot works in, and Unlink. A platform whose
  secrets are not set shows "Not available".
- **Chats show up in `/dashboard/ai`** with a LINE / WhatsApp tag. One open chat per person, org
  and platform; after 6 idle hours (or `新對話`) the bot starts a new one.
- **Files** sent in chat land in an inbox (`documents` with no transaction or invoice,
  `source = line | whatsapp`, `uploaded_by`) and are attached when a card is confirmed. MCP / REST
  clients add to the same inbox with `upload_document` (`source = mcp`, owner/admin only). The
  transaction detail shows "由 <name> 透過 LINE 上傳". Inbox files nobody attached are deleted
  after 30 days by the daily cron (`src/lib/chat-cleanup.ts`, run from
  `/api/cron/integrations-autosync`, which also purges webhook dedupe rows after 7 days, the
  message buffer after 7 days, reply references after 90 days and expires open cards).
- **Red tools** (`delete_*`, `merge_parties`, `pay_employee_salary`) are not offered in chat; the
  bot links to the web page instead. The web assistant is unchanged.
- **Quick replies:** when the model asks a question with a few obvious answers it ends with
  `[[選項：A|B|C]]` (`src/lib/ai/options.ts`). Chat turns it into LINE quick replies / WhatsApp
  buttons; the web turns it into chips under the last reply that send that text, and strips the
  marker from older messages (`src/app/dashboard/ai/split-options.ts`).

## Rules

Users teach the assistant in plain words ("以後 Google Workspace 都歸軟體工具"). Rules live in
`ai_rules` (`src/db/ai-rules.ts`); matching is one pure function, `matchCategoryRule`
(`src/lib/ai/rules.ts`), used everywhere.

- **Scope:** `org` rules apply to everyone; only owner / admin can create, turn off or delete
  them. `user` rules belong to one person, are visible only to them and anyone can make their own.
  The role check is inside the tools (`src/lib/mcp/tools-ai-rules.ts`) and again in the rules
  page's server actions.
- **In the assistant:** org rules plus the person's own rules (up to 60) are in the system prompt.
  When a `create_transaction` / `submit_advance` card's category differs from what a rule says, the
  card shows the hint ("依規則：Google Workspace → 軟體工具"), on the web and in chat.
- **On imports:** the Wise sync and the cloud-billing "create unmatched" ledger rows run
  `applyImportCategoryRules` (`src/lib/ai/import-rules.ts`): only **org** category rules, only rows
  that are needs-review income / expense with no category, and only when the category still exists
  and fits the type. It fills the category and **keeps needs_review** — someone still looks once.
  `apply_count` goes up by the number of rows actually inserted. A failure reading rules never
  fails the import.
- **Page:** `/dashboard/ai/rules` (linked from the chat list) lists what was said, when → then,
  scope, who taught it, from where, times applied, last applied, with turn off / delete for the
  rules you may change.

## Advances submitted by members

Any member can record money they paid themselves with `submit_advance` (web, chat or MCP). The
payer is always the caller's own employee record (`employees.user_id`); without one the tool tells
them an owner or admin has to link their account on the Employees page. The entry is an `advance`
with `needs_review = true`, attached to the receipt photos they sent, and an owner or admin repays
it later as usual.

## Connecting an external agent

The homepage also has a dismissible "Connect your AI agent to internal" pill above the input box.
It copies one setup prompt (`src/lib/ai/setup-prompt.ts`, in the UI language) that any agent can
follow on its own: the current org's MCP URL (`orgMcpUrl`), Streamable HTTP + OAuth, how to add it
in Claude Code / Cursor / Claude / ChatGPT, and a final `list_organizations` call to confirm the
connection. The logos on the pill are decoration only. Once dismissed (localStorage), the same
details stay on the MCP settings page.

## Setup

Set `OPENROUTER_API_KEY` (`wrangler secret put OPENROUTER_API_KEY` in production, `.env.local`
locally). Without it the page loads and answers that the assistant isn't set up.
Run `migrations/0036_ai_assistant.sql` before deploying the code; the chat bots, rules and
inbox need `migrations/0042_chat_channels.sql`.
