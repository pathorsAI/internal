"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { collectReceivable, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Label, Req } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
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

const initial: ActionState = { ok: false };

export function CollectButton({
  id,
  accounts,
}: Readonly<{
  id: number;
  accounts: { id: number; name: string; currency: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(collectReceivable, initial);
  const router = useRouter();
  const accountItems = Object.fromEntries(
    accounts.map((a) => [String(a.id), `${a.name}（${a.currency}）`]),
  );

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已收款，並建立一筆收入交易");
      router.refresh();
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" size="sm" variant="outline" onClick={(e) => e.stopPropagation()} />}
      >
        <HandCoins className="size-4" /> 收款
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <DialogHeader>
            <DialogTitle>收款</DialogTitle>
            <DialogDescription>結清這筆應收，並自動建立一筆收入交易</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label>收款帳戶<Req /></Label>
              <Select name="accountId" items={accountItems}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇帳戶" />
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
              <Label>收款日期<Req /></Label>
              <DatePicker name="payDate" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "處理中…" : "確認收款"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
