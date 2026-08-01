"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { payEmployeeSalary, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
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
const monthItems = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1} 月`]),
);
const bookItems: Record<string, string> = {
  both: "內外帳（both）",
  internal: "僅內帳（不報稅）",
  external: "僅外帳",
};

type ItemType = { id: number; name: string; direction: string; isTaxable: boolean; isStatutory: boolean };

function itemTypeSuffix(t: ItemType) {
  if (t.direction === "deduction") return "（扣除）";
  return t.isTaxable ? "（應稅）" : "（免稅）";
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
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await payEmployeeSalary(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已發放薪資，並在交易產生薪資支出");
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
  const optionTypes = useMemo(() => itemTypes.filter((t) => !t.isStatutory), [itemTypes]);

  function reset() {
    const base = itemTypes.find((t) => t.name === "底薪");
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
            <Banknote className="size-3.5" /> 發放薪資
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submitAction(action)}>
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="items" value={itemsJson} />

            <DialogHeader>
              <DialogTitle>發放薪資 — {employee.name}</DialogTitle>
              <DialogDescription>填實際發放的金額；確認後產生一筆薪資支出交易</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="periodYear">發薪年<Req /></Label>
                <Input id="periodYear" name="periodYear" type="number" required defaultValue={now.getFullYear()} />
              </div>
              <div className="space-y-1.5">
                <Label>發薪月<Req /></Label>
                <Select name="periodMonth" defaultValue={String(now.getMonth() + 1)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(monthItems).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>發薪日<Req /></Label>
                <DatePicker name="payDate" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>付款帳戶<Req /></Label>
                <Select name="fromAccountId" required>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="— 選擇帳戶 —" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}（{a.currency}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>帳別</Label>
                <Select name="book" defaultValue="both">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(bookItems).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-medium">薪資項目（底薪、加班費、獎金、請假扣…）</div>
              {rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      value={r.itemTypeId ? String(r.itemTypeId) : undefined}
                      onValueChange={(v) => pickType(r.key, v as string)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="選擇項目" />
                      </SelectTrigger>
                      <SelectContent>
                        {optionTypes.map((it) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            {it.name}
                            {itemTypeSuffix(it)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="金額"
                    value={r.amount}
                    onChange={(e) => setAmount(r.key, e.target.value)}
                    className="w-32"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(r.key)} aria-label="移除">
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-4" /> 新增項目
              </Button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">實發合計</span>
              <span className={cn("text-lg font-semibold tabular-nums", signColor(net))}>
                {formatCurrency(net)}
              </span>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "發放中…" : "確認發放"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
  );
}
