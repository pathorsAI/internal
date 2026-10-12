"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Cloud, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/copy-button";
import { refreshCloudDiscoveryAction, saveCloudBillingScopeAction } from "./cloud-billing-actions";

/** 一個候選計費範圍（Azure billing profile / GCP billing account），server 已整理好。 */
export type CloudScopeCandidate = {
  id: string;
  displayName: string;
  currency: string | null;
  reseller: boolean;
  closed: boolean;
};

export type CloudScopeView = {
  provider: "azure" | "gcp";
  /** 整合開啟且正常（重新探索要打平台，必須開啟）。 */
  enabled: boolean;
  billingAccountId: string | null;
  candidates: CloudScopeCandidate[];
  selected: string[];
  /** 已格式化的時間字串。 */
  discoveredAt: string | null;
  bigQuery: { projectId: string; dataset: string } | null;
  auth:
    | { mode: "key"; email: string | null }
    | { mode: "workload_identity"; email: string | null; subject: string; command: string | null }
    | null;
};

export function CloudBillingScopeSection({ view, canManage }: Readonly<{ view: CloudScopeView; canManage: boolean }>) {
  const t = useTranslations("integrations");
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>(view.selected);
  const [bq, setBq] = useState({ projectId: view.bigQuery?.projectId ?? "", dataset: view.bigQuery?.dataset ?? "" });
  const dirty =
    selected.length !== view.selected.length ||
    selected.some((id) => !view.selected.includes(id)) ||
    (view.provider === "gcp" &&
      (bq.projectId !== (view.bigQuery?.projectId ?? "") || bq.dataset !== (view.bigQuery?.dataset ?? "")));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  function save() {
    start(async () => {
      const res = await saveCloudBillingScopeAction(view.provider, {
        ids: selected,
        bigQuery: view.provider === "gcp" ? bq : undefined,
      });
      if (res.ok) toast.success(t("scope.saved"));
      else toast.error(res.error ?? t("toast.failed"));
    });
  }

  function refresh() {
    start(async () => {
      const res = await refreshCloudDiscoveryAction(view.provider);
      if (res.ok) toast.success(t("scope.refreshed"));
      else toast.error(res.error ?? t("toast.failed"));
    });
  }

  const auth = view.auth;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cloud className="size-4" />
          {t(`scope.title.${view.provider}`)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">{t("scope.description")}</p>
        {canManage ? null : <p className="text-xs text-muted-foreground">{t("scope.readOnly")}</p>}

        <div className="space-y-1 text-xs text-muted-foreground">
          {view.billingAccountId ? <p className="break-all">{t("scope.billingAccount", { id: view.billingAccountId })}</p> : null}
          {auth?.mode === "key" && auth.email ? <p className="break-all">{t("scope.auth.key", { email: auth.email })}</p> : null}
          {auth?.mode === "workload_identity" && auth.email ? (
            <p className="break-all">{t("scope.auth.workloadIdentity", { email: auth.email })}</p>
          ) : null}
          {view.discoveredAt ? <p>{t("scope.discoveredAt", { date: view.discoveredAt })}</p> : null}
        </div>

        {auth?.mode === "workload_identity" ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{t("scope.auth.subject")}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{auth.subject}</code>
            </div>
            {auth.command ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("scope.auth.command")}</span>
                  <CopyButton value={auth.command} />
                </div>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">{auth.command}</pre>
              </div>
            ) : (
              <p className="text-xs text-amber-600">{t("scope.auth.invalid")}</p>
            )}
          </div>
        ) : null}

        {view.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scope.noCandidates")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {view.candidates.map((c) => {
              const id = `scope-${view.provider}-${c.id}`;
              return (
                <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={selected.includes(c.id)}
                    onChange={(e) => toggle(c.id, e.target.checked)}
                    disabled={!canManage || pending}
                  />
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {c.displayName}
                      {c.currency ? <Badge variant="outline">{c.currency}</Badge> : null}
                      {c.reseller ? <Badge variant="secondary">{t("scope.reseller")}</Badge> : null}
                      {c.closed ? <Badge variant="outline">{t("scope.closed")}</Badge> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{c.id}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {selected.length === 0 ? <p className="text-xs text-amber-600">{t("scope.empty")}</p> : null}

        {view.provider === "gcp" ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("scope.bigQuery.title")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gcp-bq-project">{t("scope.bigQuery.projectId")}</Label>
                <Input
                  id="gcp-bq-project"
                  value={bq.projectId}
                  onChange={(e) => setBq((p) => ({ ...p, projectId: e.target.value }))}
                  disabled={!canManage || pending}
                  spellCheck={false}
                  placeholder="internal-498514"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gcp-bq-dataset">{t("scope.bigQuery.dataset")}</Label>
                <Input
                  id="gcp-bq-dataset"
                  value={bq.dataset}
                  onChange={(e) => setBq((p) => ({ ...p, dataset: e.target.value }))}
                  disabled={!canManage || pending}
                  spellCheck={false}
                  placeholder="billing_export"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("scope.bigQuery.hint")}</p>
          </div>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {view.enabled ? null : (
              <span className="mr-auto text-xs text-muted-foreground">{t("scope.refreshNeedsEnabled")}</span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={pending || !view.enabled}>
              <RefreshCw className="size-4" /> {t("scope.refresh")}
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
              <Save className="size-4" /> {pending ? t("scope.saving") : t("scope.save")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
