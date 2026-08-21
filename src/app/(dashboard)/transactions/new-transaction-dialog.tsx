"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowLeft, Receipt, Banknote, HandCoins, ArrowLeftRight, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { createTransaction, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, SelectField, TextField } from "@/components/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DatePicker } from "@/components/date-picker";
import { submitAction } from "@/lib/form-action";
import { PartyCombobox } from "@/components/party-combobox";
import { CategoryCombobox } from "./category-combobox";
import { ContractCombobox, type ContractOption } from "./contract-combobox";

const initial: ActionState = { ok: false };

type Account = { id: number; name: string; currency: string };
type Scenario = "expense" | "income" | "advance" | "transfer";

// 憑證類型 / 交易情境的圖示與 key；顯示文字在 component 內用 t() 取得
const DOC_KIND_KEYS = ["e_invoice", "paper_invoice", "receipt", "other"] as const;

const SCENARIOS: {
  key: Scenario;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "expense", icon: Receipt },
  { key: "income", icon: Banknote },
  { key: "advance", icon: HandCoins },
  { key: "transfer", icon: ArrowLeftRight },
];

export function NewTransactionDialog({
  accounts,
  categories,
  parties,
  employees,
  projects,
  contracts,
}: Readonly<{
  accounts: Account[];
  categories: { id: number; name: string; kind: string }[];
  parties: { id: number; name: string }[];
  employees: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  contracts: ContractOption[];
}>) {
  const t = useTranslations("transactions");
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [billed, setBilled] = useState(true);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createTransaction(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toast.added"));
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setScenario(null);
  }

  const current = SCENARIOS.find((s) => s.key === scenario);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> {t("form.addTransaction")}
        </Button>
      </SheetTrigger>
      <SheetContent className="data-[side=right]:sm:max-w-xl">
        {scenario === null ? (
          <ScenarioPicker onPick={setScenario} />
        ) : (
          <form onSubmit={submitAction(action)} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="type" value={scenario} />
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScenario(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("form.reselect")}
                >
                  <ArrowLeft className="size-4" />
                </button>
                {current ? <current.icon className="size-4" /> : null}
                {current ? t(`form.scenario.${current.key}.label`) : null}
              </SheetTitle>
            </SheetHeader>

            <div className="grid flex-1 gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2">
              <Field label={t("form.date")} required>
                <DatePicker name="txnDate" />
              </Field>
              <TextField
                name="amount"
                label={t("form.amount")}
                required
                type="number"
                step="0.01"
                placeholder={t("form.amountPlaceholder")}
              />
              <Field label={t("form.currency")}>
                <CurrencySelect />
              </Field>

              {/* 帳戶互轉 */}
              {scenario === "transfer" && (
                <>
                  <SelectField
                    name="fromAccountId"
                    label={t("form.fromAccount")}
                    required
                    placeholder={t("form.accountPlaceholder")}
                  >
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name} ({a.currency})
                      </SelectItem>
                    ))}
                  </SelectField>
                  <SelectField
                    name="toAccountId"
                    label={t("form.toAccount")}
                    required
                    placeholder={t("form.accountPlaceholder")}
                  >
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name} ({a.currency})
                      </SelectItem>
                    ))}
                  </SelectField>
                </>
              )}

              {/* 支出 / 收入 / 代墊 共用：對象 + 分類 */}
              {scenario !== "transfer" && (
                <>
                  <Field
                    label={scenario === "income" ? t("form.client") : t("form.vendor")}
                    required
                    wide
                  >
                    <PartyCombobox
                      parties={parties}
                      name="partyName"
                      placeholder={scenario === "income" ? t("form.clientPlaceholder") : t("form.vendorPlaceholder")}
                    />
                  </Field>

                  {scenario === "advance" && (
                    <Field label={t("form.payer")} required wide>
                      <PartyCombobox parties={employees} name="settleEmployeeName" placeholder={t("form.payerPlaceholder")} />
                    </Field>
                  )}

                  <Field label={t("form.category")} required>
                    <CategoryCombobox categories={categories} />
                  </Field>

                  {/* 支出 / 收入 才有帳戶 */}
                  {scenario !== "advance" && (
                    <SelectField
                      name="accountId"
                      label={scenario === "income" ? t("form.receivingAccount") : t("form.payingAccount")}
                      required
                      placeholder={t("form.accountPlaceholder")}
                    >
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name} ({a.currency})
                        </SelectItem>
                      ))}
                    </SelectField>
                  )}

                  <SelectField
                    name="projectId"
                    label={t("form.project")}
                    wide
                    placeholder={t("form.projectPlaceholder")}
                  >
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectField>

                  <Field label={t("form.contract")} wide>
                    <ContractCombobox contracts={contracts} />
                    <p className="text-xs text-muted-foreground">
                      {scenario === "income"
                        ? t("form.contractHintIncome")
                        : t("form.contractHintOther")}
                    </p>
                  </Field>
                </>
              )}

              <TextField
                name="description"
                label={t("form.description")}
                wide
                placeholder={t("form.descriptionPlaceholder")}
              />

              {/* 報稅 + 統編 + 憑證（轉帳沒有） */}
              {scenario !== "transfer" && (
                <div className="space-y-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="reported" defaultChecked className="size-4" />
                    <span>{t("form.reported")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="billedToCompanyTaxId"
                      checked={billed}
                      onChange={(e) => setBilled(e.target.checked)}
                      className="size-4"
                    />
                    <span>{t("form.billedToCompanyTaxId")}</span>
                  </label>

                  <VoucherBox billed={billed} />
                </div>
              )}
            </div>

            <SheetFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t("form.saving") : t("form.save")}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScenarioPicker({ onPick }: Readonly<{ onPick: (s: Scenario) => void }>) {
  const t = useTranslations("transactions");
  return (
    <>
      <SheetHeader>
        <SheetTitle>{t("form.addTransaction")}</SheetTitle>
        <SheetDescription>{t("form.pickScenario")}</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-2 gap-3 p-4">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            className="flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <s.icon className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">{t(`form.scenario.${s.key}.label`)}</span>
            <span className="text-xs text-muted-foreground">{t(`form.scenario.${s.key}.desc`)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function VoucherBox({ billed }: Readonly<{ billed: boolean }>) {
  const t = useTranslations("transactions");
  // 有報公司統編時，憑證類型只能是電子發票 / 其他發票
  const kindKeys = billed ? (["e_invoice", "paper_invoice"] as const) : DOC_KIND_KEYS;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted-foreground" />
        {t("form.voucher.title")}
        {billed ? "" : t("form.voucher.optional")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* 標籤的必填星號跟著 billed 走，但 Select 本身一直沒有 required，維持原樣。 */}
        <Field label={t("form.voucher.kind")} required={billed}>
          <Select
            key={billed ? "billed" : "free"}
            name="docKind"
            defaultValue="e_invoice"
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindKeys.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`form.docKind.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={<>{t("form.voucher.attachment")}{billed ? t("form.voucher.optional") : ""}</>}
          htmlFor="attachment"
        >
          <Input
            id="attachment"
            name="attachment"
            type="file"
            accept="image/*,application/pdf"
            className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {billed ? t("form.voucher.hintBilled") : t("form.voucher.hintFree")}
      </p>
    </div>
  );
}
