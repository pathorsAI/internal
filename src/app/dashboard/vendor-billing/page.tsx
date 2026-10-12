import { listBankAccounts, listOrgMembers, listParties } from "@/db/queries";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import {
  getAttention,
  listBillingAccounts,
  listPaymentMethods,
  listVendorInvoices,
} from "@/lib/vendor-billing/service";
import { taipeiToday } from "@/lib/vendor-billing/sync-plan";
import { VendorBillingClient, type View } from "./vendor-billing-client";

export const dynamic = "force-dynamic";

// view 放在網址上（?view=methods），重新整理或分享連結都停在同一個分頁。
function parseView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "methods" || v === "invoices" ? v : "accounts";
}

export default async function VendorBillingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string | string[] }> }>) {
  const { orgId, role } = await requireOrgWithRole();
  const { view } = await searchParams;
  const today = taipeiToday();
  const [accounts, methods, invoices, attention, parties, bankAccounts, members] = await Promise.all([
    listBillingAccounts(orgId),
    listPaymentMethods(orgId),
    listVendorInvoices(orgId, { limit: 300 }),
    getAttention(orgId, today),
    listParties(orgId),
    listBankAccounts(orgId),
    listOrgMembers(orgId),
  ]);

  // 停用的對象 / 帳戶不給挑，但已經被設定的仍要顯示得出名字
  const usedParties = new Set(accounts.flatMap((a) => [a.partyId, ...a.matchPartyIds]));
  const usedBankAccounts = new Set(methods.map((m) => m.settlesFromAccountId));

  return (
    <VendorBillingClient
      initialView={parseView(view)}
      canManage={canManageOrg(role)}
      today={today}
      accounts={accounts}
      methods={methods}
      invoices={invoices}
      attention={attention}
      parties={parties
        .filter((p) => p.isActive || usedParties.has(p.id))
        .map((p) => ({ id: p.id, name: p.name }))}
      bankAccounts={bankAccounts
        .filter((a) => a.isActive || usedBankAccounts.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
      members={members.map((m) => ({ userId: m.userId, name: m.name || m.email }))}
    />
  );
}
