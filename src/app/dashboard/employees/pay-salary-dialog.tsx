"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { payEmployeeSalary, type ActionState } from "@/db/mutations";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/date-picker";
import { formatCurrency } from "@/lib/format";
import { signColor } from "@/components/amount";
import { submitAction } from "@/lib/form-action";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false };
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const bookKinds = ["both", "internal", "external"] as const;

type ItemType = { id: number; name: string; direction: string; isTaxable: boolean; isStatutory: boolean };

/** 薪資項目後綴：扣項 / 應稅 / 免稅。抽出來避免巢狀三元。 */
function itemSuffixKey(it: ItemType): "deduction" | "taxable" | "nontaxable" {
  if (it.direction === "deduction") return "deduction";
  return it.isTaxable ? "taxable" : "nontaxable";
}


type Employee = { id: number; name: string; baseSalary: string | null };
type Row = {
  key: number;
  itemTypeId: number | null;
  name: string;
  direction: string;
  isTaxable: boolean;
  amount: string;
};
type Account = { id: number; name: string; currency: string };

export function PaySalaryDialog({
  employee,
  itemTypes,
  accounts,
}: Readonly<{
  employee: Employee;
  itemTypes: ItemType[];
  accounts: Account[];
}>) {
  const t = useTranslations("employees");
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await payEmployeeSalary(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(t("paySalary.toast.success"));
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );
  const counter = useRef(0);
  const next = () => ++counter.current;
  const now = new Date();
  const [rows, setRows] = useState<Row[]>([]);

  // 非法定的項目（底薪/加班費/獎金/請假扣…）
  const optionTypes = useMemo(() => itemTypes.filter((it) => !it.isStatutory), [itemTypes]);

  function reset() {
    const base = itemTypes.find((it) => it.name === "底薪");
    setRows([
      {
        key: next(),
        itemTypeId: base?.id ?? null,
        name: "底薪",
        direction: "earning",
        isTaxable: true,
        amount: employee.baseSalary ?? "",
      },
    ]);
  }

  // 開啟時把明細列重設成預設的一列底薪。以往用 effect 監看 open，但那是「回應
  // 使用者操作」而不是同步外部狀態，直接在開關 handler 裡做才對。
  function handleOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function addRow() {
    setRows((r) => [
      ...r,
      { key: next(), itemTypeId: null, name: "", direction: "earning", isTaxable: true, amount: "" },
    ]);
  }
  function removeRow(key: number) {
    setRows((r) => r.filter((x) => x.key !== key));
  }
  function pickType(key: number, typeId: string) {
    const t = optionTypes.find((x) => x.id === Number(typeId));
    if (!t) return;
    setRows((r) =>
      r.map((x) =>
        x.key === key
          ? { ...x, itemTypeId: t.id, name: t.name, direction: t.direction, isTaxable: t.isTaxable }
          : x,
      ),
    );
  }
  function setAmount(key: number, v: string) {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, amount: v } : x)));
  }

  const net = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      const a = Number(r.amount) || 0;
      sum += r.direction === "deduction" ? -a : a;
    }
    return sum;
  }, [rows]);

  const itemsJson = JSON.stringify(
    rows
      .filter((r) => r.name && r.amount !== "")
      .map((r) => ({
        itemTypeId: r.itemTypeId,
        name: r.name,
        direction: r.direction,
        isTaxable: r.isTaxable,
        amount: Number(r.amount),
      })),
  );


  return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" onClick={(e) => e.stopPropagation()}>
            <Banknote className="size-3.5" /> {t("paySalary.trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submitAction(action)}>
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="items" value={itemsJson} />

            <DialogHeader>
              <DialogTitle>{t("paySalary.title", { name: employee.name })}</DialogTitle>
              <DialogDescription>{t("paySalary.description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 sm:grid-cols-3">
              <TextField
                name="periodYear"
                label={t("paySalary.periodYearLabel")}
                required
                type="number"
                defaultValue={now.getFullYear()}
              />
              {/* 標籤有必填星號但 Select 本身沒有 required，維持原樣不動。 */}
              <Field label={t("paySalary.periodMonthLabel")} required>
                <Select name="periodMonth" defaultValue={String(now.getMonth() + 1)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {t("paySalary.monthLabel", { month: m })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("paySalary.payDateLabel")} required>
                <DatePicker name="payDate" />
              </Field>
              <SelectField
                name="fromAccountId"
                label={t("paySalary.fromAccountLabel")}
                required
                wide
                placeholder={t("paySalary.selectAccountPlaceholder")}
              >
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {t("paySalary.accountOption", { name: a.name, currency: a.currency })}
                  </SelectItem>
                ))}
              </SelectField>
              <SelectField name="book" label={t("paySalary.bookLabel")} defaultValue="both">
                {bookKinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`paySalary.bookOptions.${k}`)}
                  </SelectItem>
                ))}
              </SelectField>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-medium">{t("paySalary.itemsSection")}</div>
              {rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      value={r.itemTypeId ? String(r.itemTypeId) : undefined}
                      onValueChange={(v) => pickType(r.key, v as string)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("paySalary.selectItemPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {optionTypes.map((it) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            {it.name}
                            {t(`paySalary.itemSuffix.${itemSuffixKey(it)}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={t("paySalary.amountPlaceholder")}
                    value={r.amount}
                    onChange={(e) => setAmount(r.key, e.target.value)}
                    className="w-32"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(r.key)} aria-label={t("paySalary.removeItem")}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-4" /> {t("paySalary.addItem")}
              </Button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">{t("paySalary.net")}</span>
              <span className={cn("text-lg font-semibold tabular-nums", signColor(net))}>
                {formatCurrency(net)}
              </span>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("paySalary.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("paySalary.submitting") : t("paySalary.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
  );
}
