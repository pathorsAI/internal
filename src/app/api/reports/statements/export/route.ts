import { getTranslations } from "next-intl/server";
import { buildLedger } from "@/lib/ledger";
import { requireOrg } from "@/lib/session";
import { writeXlsx, XLSX_CONTENT_TYPE } from "@/lib/xlsx-write";
import { loose } from "@/app/dashboard/reports/statements/labels";
import { loadStatementsContext } from "@/app/dashboard/reports/statements/load";
import { buildStatementsWorkbook } from "./workbook";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/statements/export?ledger=&period=&from=&to=&asOf=&compare=
 *
 * 財務報表 Excel（試算表、資產負債表、綜合損益表、現金流量表、權益變動表、總分類帳、待處理）。
 * 跨租戶隔離：組織一律從 session 取（requireOrg），網址上沒有組織參數可以猜。
 */
export async function GET(req: Request) {
  const { orgId } = await requireOrg();
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) raw[k] = v;

  const ctx = await loadStatementsContext(orgId, raw);
  const t = loose(await getTranslations("statements"));
  const { inputs, params } = ctx;
  const built = buildLedger(inputs, { ledger: params.ledger, asOf: params.period.to });
  const bytes = writeXlsx(buildStatementsWorkbook(t, inputs, built, params));

  const fileName = t("export.fileName", {
    org: inputs.orgName.replaceAll(/[\\/:*?"<>|]/g, "_"),
    ledger: t(`ledger.${params.ledger}`),
    date: params.period.to,
  });
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      // filename* 用 RFC 5987 編碼，中文檔名才不會壞掉；filename 給不支援的舊用戶端一個 ASCII 版本。
      "Content-Disposition": `attachment; filename="financial-statements-${params.ledger}-${params.period.to}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
