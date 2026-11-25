"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GlowButton } from "@/components/ds/glow-button";
import { StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Field } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { Amount } from "@/components/amount";
import { DeleteButton } from "@/components/delete-button";
import { textareaClass } from "@/app/dashboard/vendor-billing/shared";
import { formatDate } from "@/lib/format";
import { createFixedAsset, deleteFixedAsset, updateFixedAsset } from "@/db/ledger-mutations";
import type { FixedAssetRow } from "@/db/ledger";
import { AccountPicker, type AccountOption } from "../account-picker";

const ASSET_TYPES = ["asset"] as const;

type Form = {
  name: string;
  acquiredOn: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: string;
  assetAccountId: number | null;
  sourceTransactionId: string;
  disposedOn: string;
  note: string;
};

function formOf(a: FixedAssetRow | null, today: string): Form {
  return {
    name: a?.name ?? "",
    acquiredOn: a?.acquiredOn ?? today,
    cost: a ? String(a.cost) : "",
    salvageValue: a ? String(a.salvageValue) : "0",
    usefulLifeMonths: a ? String(a.usefulLifeMonths) : "36",
    assetAccountId: a?.assetAccountId ?? null,
    sourceTransactionId: a?.sourceTransactionId ? String(a.sourceTransactionId) : "",
    disposedOn: a?.disposedOn ?? "",
    note: a?.note ?? "",
  };
}

/** 資產科目顯示：自己有綁就用自己的，否則用預設科目；都沒有回 null。 */
function accountLabel(a: FixedAssetRow, fallback: { code: string; name: string } | null): string | null {
  if (a.assetAccountCode) return `${a.assetAccountCode} ${a.assetAccountName}`;
  if (fallback) return `${fallback.code} ${fallback.name}`;
  return null;
}

type SharedProps = {
  accounts: AccountOption[];
  defaultAccount: { code: string; name: string } | null;
  today: string;
};

function AssetSheet({
  asset,
  open,
  onOpenChange,
  accounts,
  defaultAccount,
  today,
}: Readonly<SharedProps & { asset: FixedAssetRow | null; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(() => formOf(asset, today));
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((prev) => ({ ...prev, [k]: v }));

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sourceId = form.sourceTransactionId.trim();
    const input = {
      name: form.name,
      acquiredOn: form.acquiredOn,
      cost: Number(form.cost.replaceAll(",", "")),
      salvageValue: Number(form.salvageValue.replaceAll(",", "") || 0),
      usefulLifeMonths: Number(form.usefulLifeMonths),
      assetAccountId: form.assetAccountId,
      sourceTransactionId: sourceId ? Number(sourceId) : null,
      disposedOn: form.disposedOn || null,
      note: form.note || null,
    };
    start(async () => {
      const res = asset ? await updateFixedAsset(asset.id, input) : await createFixedAsset(input);
      if (!res.ok) {
        toast.error(res.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(asset ? t("assets.updated") : t("assets.created"));
      onOpenChange(false);
      router.refresh();
    });
  }

  async function remove(id: number) {
    const res = await deleteFixedAsset(id);
    if (res.ok) onOpenChange(false);
    return res;
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b pr-10">
          <SheetTitle>{asset ? t("assets.editTitle") : t("assets.newTitle")}</SheetTitle>
          <SheetDescription className="text-xs">{t("assets.description")}</SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
          <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 pb-6 sm:grid-cols-2">
            <Field label={t("assets.name")} htmlFor="fa-name" required wide>
              <Input
                id="fa-name"
                value={form.name}
                required
                placeholder={t("assets.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label={t("assets.acquiredOn")} required>
              <DatePicker name="acquiredOn" defaultValue={form.acquiredOn} onValueChange={(v) => set("acquiredOn", v)} />
            </Field>
            <Field label={t("assets.life")} htmlFor="fa-life" required>
              <Input
                id="fa-life"
                value={form.usefulLifeMonths}
                required
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => set("usefulLifeMonths", e.target.value)}
              />
            </Field>
            <Field label={t("assets.cost")} htmlFor="fa-cost" required>
              <Input
                id="fa-cost"
                value={form.cost}
                required
                inputMode="decimal"
                className="text-right tabular-nums"
                onChange={(e) => set("cost", e.target.value)}
              />
            </Field>
            <Field label={t("assets.salvage")} htmlFor="fa-salvage">
              <Input
                id="fa-salvage"
                value={form.salvageValue}
                inputMode="decimal"
                className="text-right tabular-nums"
                onChange={(e) => set("salvageValue", e.target.value)}
              />
            </Field>
            <Field label={t("assets.account")} htmlFor="fa-account" wide>
              <AccountPicker
                id="fa-account"
                accounts={accounts}
                types={ASSET_TYPES}
                value={form.assetAccountId}
                onChange={(v) => set("assetAccountId", v)}
                noneLabel={defaultAccount ? t("assets.accountDefault", defaultAccount) : undefined}
              />
            </Field>
            <Field label={t("assets.sourceTxn")} htmlFor="fa-source" wide>
              <Input
                id="fa-source"
                value={form.sourceTransactionId}
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => set("sourceTransactionId", e.target.value.replaceAll(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">{t("assets.sourceTxnHint")}</p>
            </Field>
            <Field label={t("assets.disposedOn")}>
              <DatePicker
                name="disposedOn"
                defaultValue={form.disposedOn || undefined}
                allowEmpty
                placeholder={t("assets.disposedPlaceholder")}
                onValueChange={(v) => set("disposedOn", v)}
              />
            </Field>
            <Field label={t("assets.note")} htmlFor="fa-note" wide>
              <textarea
                id="fa-note"
                className={textareaClass}
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </div>
          <SheetFooter className="shrink-0 flex-row items-center justify-between border-t">
            <div>
              {asset ? (
                <DeleteButton
                  action={remove}
                  id={asset.id}
                  title={t("assets.deleteTitle")}
                  description={t("assets.deleteDescription")}
                />
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** 開 Sheet 的狀態：每次打開換一個 nonce，讓表單從目前的資料重新開始。 */
function useAssetSheet() {
  const [target, setTarget] = React.useState<{ asset: FixedAssetRow | null; nonce: number } | null>(null);
  const [open, setOpen] = React.useState(false);
  return {
    target,
    open,
    setOpen,
    show: (asset: FixedAssetRow | null) => {
      setTarget((prev) => ({ asset, nonce: (prev?.nonce ?? 0) + 1 }));
      setOpen(true);
    },
  };
}

export function NewFixedAssetButton(props: Readonly<SharedProps>) {
  const t = useTranslations("accounting");
  const sheet = useAssetSheet();
  return (
    <>
      <GlowButton size="sm" onClick={() => sheet.show(null)}>
        <Plus className="size-4" /> {t("assets.add")}
      </GlowButton>
      {sheet.target ? (
        <AssetSheet key={sheet.target.nonce} asset={null} open={sheet.open} onOpenChange={sheet.setOpen} {...props} />
      ) : null}
    </>
  );
}

export function FixedAssetsTable({
  assets,
  currency,
  ...props
}: Readonly<SharedProps & { assets: FixedAssetRow[]; currency: string }>) {
  const t = useTranslations("accounting");
  const sheet = useAssetSheet();
  const totals = assets.reduce(
    (s, a) => ({ cost: s.cost + a.cost, acc: s.acc + a.accumulatedDepreciation, book: s.book + a.bookValue }),
    { cost: 0, acc: 0, book: 0 },
  );

  return (
    <>
      <TableCard
        title={t("assets.title")}
        action={`${t("assets.count", { count: assets.length })} · ${t("assets.asOfToday")}`}
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("assets.name")}</TableHead>
                <TableHead className="w-28">{t("assets.acquiredOn")}</TableHead>
                <TableHead>{t("assets.account")}</TableHead>
                <TableHead className="text-right">{t("assets.cost")}</TableHead>
                <TableHead className="text-right">{t("assets.life")}</TableHead>
                <TableHead className="text-right">{t("assets.monthly")}</TableHead>
                <TableHead className="text-right">{t("assets.accumulated")}</TableHead>
                <TableHead className="text-right">{t("assets.bookValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.length === 0 ? (
                <EmptyRow colSpan={8} icon={Package} message={t("assets.empty")} />
              ) : (
                assets.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => sheet.show(a)}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {a.name}
                        {a.disposedOn ? (
                          <StatusTag tone="neutral">
                            {t("assets.disposedOn")} {formatDate(a.disposedOn)}
                          </StatusTag>
                        ) : null}
                        {a.sourceTransactionId ? (
                          <span className="text-xs text-muted-foreground tabular-nums">#{a.sourceTransactionId}</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{formatDate(a.acquiredOn)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {accountLabel(a, props.defaultAccount) ?? t("common.none")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount value={a.cost} currency={currency} kind="neutral" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t("assets.lifeShort", { months: a.usefulLifeMonths })}</TableCell>
                    <TableCell className="text-right">
                      <Amount value={a.monthlyDepreciation} currency={currency} kind="neutral" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount value={a.accumulatedDepreciation} currency={currency} kind="neutral" />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Amount value={a.bookValue} currency={currency} kind="neutral" />
                    </TableCell>
                  </TableRow>
                ))
              )}
              {assets.length > 1 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="font-medium">
                    {t("journal.total")}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount value={totals.cost} currency={currency} kind="neutral" />
                  </TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className="text-right font-medium">
                    <Amount value={totals.acc} currency={currency} kind="neutral" />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount value={totals.book} currency={currency} kind="neutral" />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </TableCard>
      {sheet.target ? (
        <AssetSheet
          key={sheet.target.nonce}
          asset={sheet.target.asset}
          open={sheet.open}
          onOpenChange={sheet.setOpen}
          {...props}
        />
      ) : null}
    </>
  );
}
