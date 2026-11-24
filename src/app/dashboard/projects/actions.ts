"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts, projects } from "@/db/schema";
import { logWeb } from "@/db/activity";
import { createProjectForContract, parseProjectChoice } from "@/db/project-choice";
import { requireOrg } from "@/lib/session";

export type ActionState = { ok: boolean; error?: string };

function revalidateProjectPages() {
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/contracts");
}

/**
 * 「合約都已完成，可結案」旁邊的一鍵封存。封存是手動 override：推導狀態不管底下怎樣都顯示封存，
 * 之後要恢復就在編輯視窗把「封存」改回來。
 */
export async function archiveProject(id: number): Promise<ActionState> {
  const t = await getTranslations("errors");
  try {
    const { orgId } = await requireOrg();
    const [row] = await getDb()
      .update(projects)
      .set({ status: "archived" })
      .where(and(eq(projects.organizationId, orgId), eq(projects.id, id), isNull(projects.deletedAt)))
      .returning({ id: projects.id, name: projects.name });
    if (!row) return { ok: false, error: t("notFound.referencedRecord") };
    await logWeb(orgId, "update", "project", row.id, row.name);
    revalidateProjectPages();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("failed.update") };
  }
}

/**
 * 把一張還沒歸專案的合約歸到專案（專案頁「未歸類的合約」）。
 * projectChoice："new" = 建同名專案（客戶沿用合約的客戶）、或既有專案 id。
 *
 * 只改合約本身的 project_id：底下的請款項 / 訂閱沒有自己的專案時不跟著改，
 * 專案損益經由合約就會算進來（src/db/project-links.ts）。
 */
export async function assignContractProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations("errors");
  const contractId = Number(formData.get("contractId"));
  if (!Number.isSafeInteger(contractId) || contractId <= 0) return { ok: false, error: t("required.id") };
  const choice = parseProjectChoice(formData.get("projectChoice"));
  if (!choice || choice.kind === "none" || choice.kind === "invalid") {
    return { ok: false, error: t("notFound.referencedRecord") };
  }
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [contract] = await db
      .select({ id: contracts.id, title: contracts.title, customerPartyId: contracts.customerPartyId })
      .from(contracts)
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, contractId), isNull(contracts.deletedAt)))
      .limit(1);
    if (!contract) return { ok: false, error: t("notFound.referencedRecord") };

    let projectId: number;
    if (choice.kind === "new") {
      projectId = await createProjectForContract(db, orgId, contract);
      await logWeb(orgId, "create", "project", projectId, contract.title);
    } else {
      // 外鍵歸屬：別的 org 的專案 id 一樣是合法的 FK 值，必須自己擋（同 mutations.ts 的 unownedRefError）
      const [owned] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.organizationId, orgId), eq(projects.id, choice.id), isNull(projects.deletedAt)))
        .limit(1);
      if (!owned) return { ok: false, error: t("notFound.referencedRecord") };
      projectId = owned.id;
    }

    await db
      .update(contracts)
      .set({ projectId })
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, contract.id)));
    await logWeb(orgId, "update", "contract", contract.id, contract.title);
    revalidateProjectPages();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("failed.update") };
  }
}
