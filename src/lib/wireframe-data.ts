// Front-end placeholder data for the wireframe only.
// The real data comes from the DBA-owned Neon tables, wired up later via `pnpm db:pull`.

export const sampleAccounts = [
  {
    id: "1",
    name: "Jack",
    email: "jack@pathors.com",
    role: "owner",
    status: "active" as const,
    createdAt: "2026-01-12",
  },
  {
    id: "2",
    name: "Ops Team",
    email: "ops@pathors.com",
    role: "admin",
    status: "active" as const,
    createdAt: "2026-02-03",
  },
  {
    id: "3",
    name: "Finance",
    email: "finance@pathors.com",
    role: "member",
    status: "invited" as const,
    createdAt: "2026-03-21",
  },
];

export const sampleTransactions = [
  {
    id: "1",
    occurredAt: "2026-05-20",
    type: "income" as const,
    category: "POC 合約",
    description: "客戶 A POC 首期款",
    amount: 120000,
    currency: "TWD",
  },
  {
    id: "2",
    occurredAt: "2026-05-18",
    type: "expense" as const,
    category: "雲端服務",
    description: "Cloudflare + Neon 月費",
    amount: 18000,
    currency: "TWD",
  },
  {
    id: "3",
    occurredAt: "2026-05-15",
    type: "expense" as const,
    category: "廣告投放",
    description: "Meta Ads",
    amount: 9500,
    currency: "TWD",
  },
];

export const sampleStats = {
  accounts: sampleAccounts.length,
  income: sampleTransactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0),
  expense: sampleTransactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0),
};
