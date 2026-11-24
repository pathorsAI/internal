import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { contracts, projects, subscriptions, transactions } from "@/db/schema";
import { contractReadyToClose, projectReadyToClose } from "./project-status";

/**
 * 狀態提示：寫入交易之後，順便看看相關的合約與專案是不是該結案了。
 * 只提示、不改狀態 —— 改不改由人決定（AI 要先問過使用者）。
 */
export type StatusHint =
  | {
      kind: "contract_fully_collected";
      contractId: number;
      title: string;
      status: string;
      currency: string;
      amount: number;
      received: number;
      message: string;
    }
  | { kind: "project_ready_to_close"; projectId: number; name: string; message: string };

function uniq(list: readonly (number | null | undefined)[]): number[] {
  return [...new Set(list.filter((n): n is number => typeof n === "number" && n > 0))];
}

/** 合約已收（同幣別收入；含經由請款項 / 訂閱繼承合約的交易）。 */
export async function contractReceived(db: Db, orgId: string, contractIds: readonly number[]) {
  const list = uniq(contractIds);
  if (list.length === 0) return new Map<number, number>();
  const rows = await db
    .select({
      id: contracts.id,
      received: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
    })
    .from(contracts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.contractId, contracts.id),
        eq(transactions.currency, contracts.currency),
        isNull(transactions.deletedAt),
      ),
    )
    .where(and(eq(contracts.organizationId, orgId), inArray(contracts.id, list)))
    .groupBy(contracts.id);
  return new Map(rows.map((r) => [r.id, Number(r.received)]));
}

export async function contractHints(db: Db, orgId: string, contractIds: readonly number[]): Promise<StatusHint[]> {
  const list = uniq(contractIds);
  if (list.length === 0) return [];
  const [rows, received] = await Promise.all([
    db
      .select({
        id: contracts.id,
        title: contracts.title,
        status: contracts.status,
        amount: contracts.amount,
        currency: contracts.currency,
      })
      .from(contracts)
      .where(and(eq(contracts.organizationId, orgId), inArray(contracts.id, list), isNull(contracts.deletedAt))),
    contractReceived(db, orgId, list),
  ]);
  const out: StatusHint[] = [];
  for (const c of rows) {
    const amount = c.amount == null ? null : Number(c.amount);
    const got = received.get(c.id) ?? 0;
    if (amount !== null && contractReadyToClose({ status: c.status, amount, received: got })) {
      out.push({
        kind: "contract_fully_collected",
        contractId: c.id,
        title: c.title,
        status: c.status,
        currency: c.currency,
        amount,
        received: got,
        message:
          `合約「${c.title}」已收 ${got} ${c.currency} ≥ 金額 ${amount}，但狀態仍是 ${c.status}。` +
          "請告訴使用者，並詢問是否改成 completed（已完成）；得到明確同意後才呼叫 update_contract，不要自行更改。",
      });
    }
  }
  return out;
}

/** 這些專案底下各自的合約 / 訂閱狀態。 */
export async function projectChildStatuses(db: Db, orgId: string, projectIds: readonly number[]) {
  const list = uniq(projectIds);
  const out = new Map<number, { contractStatuses: string[]; subscriptionStatuses: string[] }>();
  if (list.length === 0) return out;
  for (const id of list) out.set(id, { contractStatuses: [], subscriptionStatuses: [] });
  const [cs, ss] = await Promise.all([
    db
      .select({ projectId: contracts.projectId, status: contracts.status })
      .from(contracts)
      .where(and(eq(contracts.organizationId, orgId), inArray(contracts.projectId, list), isNull(contracts.deletedAt))),
    db
      .select({ projectId: subscriptions.projectId, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.organizationId, orgId), inArray(subscriptions.projectId, list), isNull(subscriptions.deletedAt)),
      ),
  ]);
  for (const c of cs) if (c.projectId != null) out.get(c.projectId)?.contractStatuses.push(c.status);
  for (const s of ss) if (s.projectId != null) out.get(s.projectId)?.subscriptionStatuses.push(s.status);
  return out;
}

export async function projectHints(db: Db, orgId: string, projectIds: readonly number[]): Promise<StatusHint[]> {
  const list = uniq(projectIds);
  if (list.length === 0) return [];
  const [rows, children] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(and(eq(projects.organizationId, orgId), inArray(projects.id, list), isNull(projects.deletedAt))),
    projectChildStatuses(db, orgId, list),
  ]);
  const out: StatusHint[] = [];
  for (const p of rows) {
    const ch = children.get(p.id) ?? { contractStatuses: [], subscriptionStatuses: [] };
    if (projectReadyToClose({ manualStatus: p.status, ...ch })) {
      out.push({
        kind: "project_ready_to_close",
        projectId: p.id,
        name: p.name,
        message:
          `專案「${p.name}」底下的合約都已完成或取消，也沒有進行中的訂閱，可以結案（封存）。` +
          "請先詢問使用者；同意後才呼叫 update_project({ id, status: \"archived\" })。",
      });
    }
  }
  return out;
}

export async function statusHints(
  db: Db,
  orgId: string,
  contractIds: readonly (number | null | undefined)[],
  projectIds: readonly (number | null | undefined)[],
): Promise<StatusHint[]> {
  const [c, p] = await Promise.all([contractHints(db, orgId, uniq(contractIds)), projectHints(db, orgId, uniq(projectIds))]);
  return [...c, ...p];
}
