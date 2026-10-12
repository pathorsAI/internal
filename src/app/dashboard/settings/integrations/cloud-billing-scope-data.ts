import { formatDateTime } from "@/lib/format";
import { gcpAuthMode, workloadIdentityBindingCommand } from "@/lib/integrations/gcp";
import type { IntegrationSummary } from "@/lib/integrations/types";
import { parseAzureScope, parseGcpScope } from "@/lib/vendor-billing/scope";
import type { CloudScopeView } from "./cloud-billing-scope-client";

/**
 * 設定頁「計費範圍」區塊要的資料：只有非機密的 config 與本組織 id（workload identity 的
 * subject 就是 organization id，來自 server 端 session，不是使用者輸入）。
 */
export function loadCloudScopeView(orgId: string, summary: IntegrationSummary): CloudScopeView | null {
  const enabled = summary.enabled && summary.status === "connected";
  const fmt = (v: string | null) => (v ? formatDateTime(v) : null);
  if (summary.provider === "azure") {
    const scope = parseAzureScope(summary.config);
    return {
      provider: "azure",
      enabled,
      billingAccountId: scope.billingAccountId,
      candidates: scope.discovered.map((p) => ({ id: p.id, displayName: p.displayName, currency: null, reseller: false, closed: false })),
      selected: scope.billingProfileIds,
      discoveredAt: fmt(scope.discoveredAt),
      bigQuery: null,
      auth: null,
    };
  }
  if (summary.provider === "gcp") {
    const scope = parseGcpScope(summary.config);
    const c = summary.config;
    const email = typeof c.serviceAccountEmail === "string" ? c.serviceAccountEmail : null;
    return {
      provider: "gcp",
      enabled,
      billingAccountId: null,
      candidates: scope.discovered.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        currency: a.currencyCode,
        reseller: Boolean(a.masterBillingAccount),
        closed: !a.open,
      })),
      selected: scope.billingAccountIds,
      discoveredAt: fmt(scope.discoveredAt),
      bigQuery: scope.bigQueryExport,
      auth:
        gcpAuthMode(c) === "workload_identity"
          ? {
              mode: "workload_identity",
              email,
              subject: orgId,
              command: workloadIdentityBindingCommand(c.serviceAccountEmail, c.wifAudience, orgId),
            }
          : { mode: "key", email },
    };
  }
  return null;
}
