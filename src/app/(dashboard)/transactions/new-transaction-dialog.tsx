"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowLeft, Receipt, Banknote, HandCoins, ArrowLeftRight, Paperclip } from "lucide-react";
import { createTransaction, type ActionState } from "@/db/mutations";
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
import { PartyCombobox } from "./party-combobox";
import { CategoryCombobox } from "./category-combobox";
import { ContractCombobox, type ContractOption } from "./contract-combobox";

const initial: ActionState = { ok: false };

// 憑證類型；電子發票會計師會自動看到，其他發票（三聯式等）要主動通知
const DOC_KINDS: Record<string, string> = {
  e_invoice: "電子發票",
  paper_invoice: "其他發票（三聯式等）",
  receipt: "收據",
  other: "其他",
};

type Account = { id: number; name: string; currency: string };
type Scenario = "expense" | "income" | "advance" | "transfer";

const SCENARIOS: {
  key: Scenario;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}[] = [
  { key: "expense", icon: Receipt, label: "一般支出", desc: "公司直接付錢" },
  { key: "income", icon: Banknote, label: "收入", desc: "收到客戶的錢" },
  { key: "advance", icon: HandCoins, label: "員工代墊", desc: "員工先付，之後再還" },
  { key: "transfer", icon: ArrowLeftRight, label: "帳戶互轉", desc: "自己帳戶間搬錢" },
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
        toast.success("已新增交易");
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
          <Plus className="size-4" /> 新增交易
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
                  aria-label="重選"
                >
                  <ArrowLeft className="size-4" />
                </button>
                {current ? <current.icon className="size-4" /> : null}
                {current?.label}
              </SheetTitle>
            </SheetHeader>

            <div className="grid flex-1 gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>日期<Req /></Label>
                <DatePicker name="txnDate" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">金額<Req /></Label>
                <Input id="amount" name="amount" type="number" step="0.01" required placeholder="正數" />
              </div>
              <div className="space-y-1.5">
                <Label>幣別</Label>
                <CurrencySelect />
              </div>

              {/* 帳戶互轉 */}
              {scenario === "transfer" && (
                <>
                  <div className="space-y-1.5">
                    <Label>轉出帳戶<Req /></Label>
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
                    <Label>轉入帳戶<Req /></Label>
                    <Select name="toAccountId" required>
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
                </>
              )}

              {/* 支出 / 收入 / 代墊 共用：對象 + 分類 */}
              {scenario !== "transfer" && (
                <>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>
                      {scenario === "income" ? "客戶" : "廠商 / 對象"}
                      <Req />
                    </Label>
                    <PartyCombobox
                      parties={parties}
                      name="partyName"
                      placeholder={scenario === "income" ? "輸入或選擇客戶…" : "輸入或選擇廠商…"}
                    />
                  </div>

                  {scenario === "advance" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>代墊人（員工）<Req /></Label>
                      <PartyCombobox parties={employees} name="settleEmployeeName" placeholder="輸入代墊的員工…" />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>分類<Req /></Label>
                    <CategoryCombobox categories={categories} />
                  </div>

                  {/* 支出 / 收入 才有帳戶 */}
                  {scenario !== "advance" && (
                    <div className="space-y-1.5">
                      <Label>
                        {scenario === "income" ? "收款帳戶" : "付款帳戶"}
                        <Req />
                      </Label>
                      <Select name="accountId" required>
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
                  )}

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>專案</Label>
                    <Select name="projectId">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="— 未指定 —" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>合約</Label>
                    <ContractCombobox contracts={contracts} />
                    <p className="text-xs text-muted-foreground">
                      {scenario === "income"
                        ? "綁合約後可在合約頁看到已收 / 未收。"
                        : "可綁合約來追蹤這單花了多少（成本不會從合約金額扣除）。"}
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">摘要</Label>
                <Input id="description" name="description" placeholder="選填" />
              </div>

              {/* 報稅 + 統編 + 憑證（轉帳沒有） */}
              {scenario !== "transfer" && (
                <div className="space-y-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="reported" defaultChecked className="size-4" />
                    <span>上外帳（要報稅）</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="billedToCompanyTaxId"
                      checked={billed}
                      onChange={(e) => setBilled(e.target.checked)}
                      className="size-4"
                    />
                    <span>這筆有報公司統編</span>
                  </label>

                  <VoucherBox billed={billed} />
                </div>
              )}
            </div>

            <SheetFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "儲存中…" : "儲存"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScenarioPicker({ onPick }: Readonly<{ onPick: (s: Scenario) => void }>) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>新增交易</SheetTitle>
        <SheetDescription>先選這是哪一種交易</SheetDescription>
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
            <span className="text-sm font-medium">{s.label}</span>
            <span className="text-xs text-muted-foreground">{s.desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function VoucherBox({ billed }: Readonly<{ billed: boolean }>) {
  // 有報公司統編時，憑證類型只能是電子發票 / 其他發票
  const kindOptions = billed
    ? { e_invoice: DOC_KINDS.e_invoice, paper_invoice: DOC_KINDS.paper_invoice }
    : DOC_KINDS;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted-foreground" />
        憑證 / 相關證明{billed ? "" : "（選填）"}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>類型{billed ? <Req /> : null}</Label>
          <Select
            key={billed ? "billed" : "free"}
            name="docKind"
            defaultValue="e_invoice"
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(kindOptions).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="attachment">附檔{billed ? "（選填）" : ""}</Label>
          <Input
            id="attachment"
            name="attachment"
            type="file"
            accept="image/*,application/pdf"
            className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {billed
          ? "有報公司統編，請選擇電子發票或其他發票。電子發票會計師自動看到;其他發票（三聯式等）會列入待通知清單。"
          : "電子發票會計師會自動看到;其他發票（三聯式等）系統會標記、要主動通知會計師。"}
      </p>
    </div>
  );
}
