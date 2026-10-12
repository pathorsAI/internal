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

type IntegrationsT = ReturnType<typeof useTranslations<"integrations">>;
type BigQueryInput = { projectId: string; dataset: string };

function isDirty(view: CloudScopeView, selected: string[], bq: BigQueryInput): boolean {
  if (selected.length !== view.selected.length || selected.some((id) => !view.selected.includes(id))) return true;
  if (view.provider !== "gcp") return false;
  return bq.projectId !== (view.bigQuery?.projectId ?? "") || bq.dataset !== (view.bigQuery?.dataset ?? "");
}

function ScopeMeta({ view, t }: Readonly<{ view: CloudScopeView; t: IntegrationsT }>) {
  const auth = view.auth;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {view.billingAccountId ? <p className="break-all">{t("scope.billingAccount", { id: view.billingAccountId })}</p> : null}
      {auth?.mode === "key" && auth.email ? <p className="break-all">{t("scope.auth.key", { email: auth.email })}</p> : null}
      {auth?.mode === "workload_identity" && auth.email ? (
        <p className="break-all">{t("scope.auth.workloadIdentity", { email: auth.email })}</p>
      ) : null}
      {view.discoveredAt ? <p>{t("scope.discoveredAt", { date: view.discoveredAt })}</p> : null}
    </div>
  );
}

/** Workload identity：本組織的 subject 與給 GCP 管理員的綁定指令。 */
function WorkloadIdentityBox({
  subject,
  command,
  t,
}: Readonly<{ subject: string; command: string | null; t: IntegrationsT }>) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t("scope.auth.subject")}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{subject}</code>
      </div>
      {command ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("scope.auth.command")}</span>
            <CopyButton value={command} />
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">{command}</pre>
        </div>
      ) : (
        <p className="text-xs text-amber-600">{t("scope.auth.invalid")}</p>
      )}
    </div>
  );
}

function CandidateRow({
  provider,
  candidate,
  checked,
  disabled,
  onToggle,
  t,
}: Readonly<{
  provider: string;
  candidate: CloudScopeCandidate;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string, on: boolean) => void;
  t: IntegrationsT;
}>) {
  const id = `scope-${provider}-${candidate.id}`;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4 accent-primary"
        checked={checked}
        onChange={(e) => onToggle(candidate.id, e.target.checked)}
        disabled={disabled}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {candidate.displayName}
          {candidate.currency ? <Badge variant="outline">{candidate.currency}</Badge> : null}
          {candidate.reseller ? <Badge variant="secondary">{t("scope.reseller")}</Badge> : null}
          {candidate.closed ? <Badge variant="outline">{t("scope.closed")}</Badge> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{candidate.id}</span>
      </label>
    </li>
  );
}

function BigQueryInputs({
  value,
  onChange,
  disabled,
  t,
}: Readonly<{ value: BigQueryInput; onChange: (v: BigQueryInput) => void; disabled: boolean; t: IntegrationsT }>) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("scope.bigQuery.title")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gcp-bq-project">{t("scope.bigQuery.projectId")}</Label>
          <Input
            id="gcp-bq-project"
            value={value.projectId}
            onChange={(e) => onChange({ ...value, projectId: e.target.value })}
            disabled={disabled}
            spellCheck={false}
            placeholder="internal-498514"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gcp-bq-dataset">{t("scope.bigQuery.dataset")}</Label>
          <Input
            id="gcp-bq-dataset"
            value={value.dataset}
            onChange={(e) => onChange({ ...value, dataset: e.target.value })}
            disabled={disabled}
            spellCheck={false}
            placeholder="billing_export"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("scope.bigQuery.hint")}</p>
    </div>
  );
}

export function CloudBillingScopeSection({ view, canManage }: Readonly<{ view: CloudScopeView; canManage: boolean }>) {
  const t = useTranslations("integrations");
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>(view.selected);
  const [bq, setBq] = useState<BigQueryInput>({
    projectId: view.bigQuery?.projectId ?? "",
    dataset: view.bigQuery?.dataset ?? "",
  });
  const dirty = isDirty(view, selected, bq);
  const locked = !canManage || pending;

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
        <ScopeMeta view={view} t={t} />
        {auth?.mode === "workload_identity" ? <WorkloadIdentityBox subject={auth.subject} command={auth.command} t={t} /> : null}

        {view.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scope.noCandidates")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {view.candidates.map((c) => (
              <CandidateRow
                key={c.id}
                provider={view.provider}
                candidate={c}
                checked={selected.includes(c.id)}
                disabled={locked}
                onToggle={toggle}
                t={t}
              />
            ))}
          </ul>
        )}
        {selected.length === 0 ? <p className="text-xs text-amber-600">{t("scope.empty")}</p> : null}

        {view.provider === "gcp" ? <BigQueryInputs value={bq} onChange={setBq} disabled={locked} t={t} /> : null}

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
