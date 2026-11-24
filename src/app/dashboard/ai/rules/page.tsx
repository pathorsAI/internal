import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { DeleteButton } from "@/components/delete-button";
import { EmptyRow } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAiRules, type AiRuleRow } from "@/db/ai-rules";
import { listCategories } from "@/db/queries";
import { ruleConditionLabel } from "@/lib/ai/rules";
import { formatDate } from "@/lib/format";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { cn } from "@/lib/utils";
import { deleteAiRuleAction } from "./actions";
import { RuleToggle } from "./rule-toggle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.rules");
  return { title: t("metaTitle") };
}

/**
 * AI 規則：使用者在對話裡教 AI 的事（「Google Workspace 都歸軟體工具」「我的代墊預設用公司卡」）。
 * 組織規則大家都看得到、只有 owner／admin 能停用或刪除；個人規則只有本人看得到。
 */
export default async function AiRulesPage() {
  const t = await getTranslations("ai.rules");
  const locale = (await getLocale()) === "en" ? "en" : "zh-TW";
  const { orgId, userId, role } = await requireOrgWithRole();
  const [rules, categories] = await Promise.all([
    listAiRules(orgId, userId, { includeDisabled: true }),
    listCategories(orgId),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const manage = canManageOrg(role);

  const effect = (r: AiRuleRow): string => {
    if (r.kind !== "category") return t(`kind.${r.kind}`);
    const id = r.action.categoryId;
    const target =
      (typeof id === "number" ? categoryName.get(id) : undefined) ?? r.action.categoryName ?? (id ? `#${id}` : "—");
    const cond = ruleConditionLabel(r, locale);
    return cond ? `${cond} → ${target}` : target;
  };

  return (
    <>
      <PageHeader title={t("title")} />
      <TableCard>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.text")}</TableHead>
                <TableHead>{t("columns.effect")}</TableHead>
                <TableHead>{t("columns.scope")}</TableHead>
                <TableHead>{t("columns.createdBy")}</TableHead>
                <TableHead>{t("columns.source")}</TableHead>
                <TableHead className="text-right">{t("columns.applyCount")}</TableHead>
                <TableHead>{t("columns.lastApplied")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <EmptyRow colSpan={8} message={t("empty")} />
              ) : (
                rules.map((r) => {
                  const canEdit = r.scope === "user" ? r.userId === userId : manage;
                  const disabled = r.disabledAt !== null;
                  return (
                    <TableRow key={r.id} className={cn(disabled && "text-muted-foreground")}>
                      <TableCell className="max-w-[36ch]">
                        <div className="flex items-center gap-2">
                          <span className="truncate" title={r.text}>
                            {r.text}
                          </span>
                          {disabled ? <StatusTag tone="neutral">{t("disabled")}</StatusTag> : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[32ch] truncate" title={effect(r)}>
                        {effect(r)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {t(`scope.${r.scope}`)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.createdByName ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {t(`source.${r.source}`)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.applyCount}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {r.lastAppliedAt ? formatDate(r.lastAppliedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {canEdit ? (
                          <span className="inline-flex items-center gap-1">
                            <RuleToggle id={r.id} disabled={disabled} />
                            <DeleteButton
                              action={deleteAiRuleAction}
                              id={r.id}
                              title={t("deleteTitle")}
                              description={t("deleteDescription")}
                            />
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </TableCard>
    </>
  );
}
