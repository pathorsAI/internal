"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markBillingRow } from "@/db/mutations";

type Field = "billedOn" | "paidOn" | "invoicedOn";

const label: Record<Field, string> = {
  billedOn: "已請款",
  paidOn: "已收款",
  invoicedOn: "已開發票",
};

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 看板上的一鍵標記：把今天寫進 billed_on / paid_on / invoiced_on。
 * 已經有日期時按鈕變成「取消標記」，把欄位清回 NULL。
 */
export function QuickMark({
  rowKey,
  field,
  value,
  disabled,
  disabledHint,
}: Readonly<{
  rowKey: string;
  field: Field;
  value: string | null;
  disabled?: boolean;
  disabledHint?: string;
}>) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const marked = value != null;

  function run() {
    start(async () => {
      const res = await markBillingRow(rowKey, field, marked ? null : todayISO());
      if (res.ok) {
        toast.success(marked ? `已取消「${label[field]}」` : `已標記${label[field]}`);
        router.refresh();
      } else {
        toast.error(res.error ?? "更新失敗");
      }
    });
  }

  if (disabled) {
    return (
      <Button type="button" size="sm" variant="outline" disabled title={disabledHint}>
        {label[field]}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={marked ? "ghost" : "outline"}
      disabled={pending}
      onClick={run}
    >
      {marked ? <Undo2 className="size-4" /> : <Check className="size-4" />}
      {marked ? `取消${label[field]}` : `標記${label[field]}`}
    </Button>
  );
}
