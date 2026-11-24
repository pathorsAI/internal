import { getTranslations } from "next-intl/server";
import { Link2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyState } from "@/components/empty-state";
import { getDb } from "@/db";
import { listPendingLinks } from "@/lib/linking";
import { requireOrg } from "@/lib/session";
import { PendingLinksTable } from "./pending-links-table";
import { RescanButton } from "./rescan-button";

export const dynamic = "force-dynamic";

const LIMIT = 200;

export default async function PendingLinksPage() {
  const { orgId } = await requireOrg();
  const t = await getTranslations("links");
  const rows = await listPendingLinks(getDb(), orgId, { limit: LIMIT });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        <RescanButton />
      </PageHeader>

      {rows.length === 0 ? (
        <TableCard>
          <EmptyState icon={Link2} message={t("empty")}>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </EmptyState>
        </TableCard>
      ) : (
        <TableCard title={t("title")} action={t("count", { count: rows.length })}>
          <PendingLinksTable rows={rows} />
        </TableCard>
      )}
    </>
  );
}
