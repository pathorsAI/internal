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
- **Roles:** owner / admin get everything above (writes still confirmed); members get reads only.
  Checked again when a card is confirmed, not just when tools are offered.
- **Org:** fixed to the signed-in org. `organizationId` is removed from every schema shown to the
  model and overwritten on every call.
- **Audit:** writes land in `activity_log` with `channel = 'ai'` and the member who confirmed as
  the actor; the summary is the line the confirmation card showed.
- **Conversations** are private to the user and scoped to the org they were started in.

## Setup

Set `OPENROUTER_API_KEY` (`wrangler secret put OPENROUTER_API_KEY` in production, `.env.local`
locally). Without it the page loads and answers that the assistant isn't set up.
Run `migrations/0036_ai_assistant.sql` before deploying the code.
