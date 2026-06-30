"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateEmployee, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DialogFooter } from "@/components/ui/dialog";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";

const initial: ActionState = { ok: false };
const typeItems: Record<string, string> = {
  full_time: "正職",
  part_time: "兼職",
  freelancer: "自由",
  contractor: "承攬",
};

type Employee = {
  id: number;
  name: string;
  nationalId: string | null;
  employmentType: string;
  hasPension: boolean;
  baseSalary: string | null;
  laborInsuredSalary: string | null;
  healthInsuredSalary: string | null;
  salaryAccount: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
};

export function EditEmployeeForm({
  employee,
  footer,
}: Readonly<{
  employee: Employee;
  footer?: React.ReactNode;
}>) {
  const [state, action, pending] = useActionState(updateEmployee, initial);
  const close = useRowDialogClose();
  useEffect(() => {
    if (state.ok) {
      toast.success("已更新");
      close();
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={employee.id} />
      <div className="space-y-1.5">
        <Label htmlFor="name">姓名<Req /></Label>
        <Input id="name" name="name" required defaultValue={employee.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nationalId">身分證 / 統編</Label>
        <Input id="nationalId" name="nationalId" defaultValue={employee.nationalId ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label>雇用類型</Label>
        <Select name="employmentType" defaultValue={employee.employmentType}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(typeItems).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="baseSalary">底薪</Label>
        <Input
          id="baseSalary"
          name="baseSalary"
          type="number"
          step="0.01"
          defaultValue={employee.baseSalary ?? ""}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="salaryAccount">薪資戶</Label>
        <Input
          id="salaryAccount"
          name="salaryAccount"
          defaultValue={employee.salaryAccount ?? ""}
          placeholder="例：永豐銀行 帳號末四碼 1234"
        />
      </div>

      <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
        <div className="text-sm font-medium">勞健保投保（記錄保多少；之後再依此試算保費）</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <InsField id="laborInsuredSalary" label="勞保投保薪資" value={employee.laborInsuredSalary} />
          <InsField id="healthInsuredSalary" label="健保投保薪資" value={employee.healthInsuredSalary} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hasPension"
            defaultChecked={employee.hasPension}
            className="size-4"
          />
          <span>有提撥勞退（股東可不勾）</span>
        </label>
      </div>
      <div className="space-y-1.5">
        <Label>到職日</Label>
        <DatePicker name="startDate" defaultValue={employee.startDate ?? undefined} allowEmpty />
      </div>
      <div className="space-y-1.5">
        <Label>離職日</Label>
        <DatePicker name="endDate" defaultValue={employee.endDate ?? undefined} allowEmpty />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isActive" defaultChecked={employee.isActive} className="size-4" />
        <span>在職</span>
      </label>
      <DialogFooter className="mt-2 border-t pt-4 sm:col-span-2">
        {footer ? <div className="mr-auto">{footer}</div> : null}
        <Button type="button" variant="outline" onClick={close}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "儲存中…" : "儲存變更"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function InsField({ id, label, value }: Readonly<{ id: string; label: string; value: string | null }>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} name={id} type="number" step="0.01" defaultValue={value ?? ""} />
    </div>
  );
}
