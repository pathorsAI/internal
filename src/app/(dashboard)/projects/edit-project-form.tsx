"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateProject, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DialogFooter } from "@/components/ui/dialog";
import { submitAction } from "@/lib/form-action";
import { useRowDialogClose } from "@/components/row-dialog";
import { PartyField } from "@/components/party-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initial: ActionState = { ok: false };

type Project = {
  id: number;
  name: string;
  clientPartyId: number | null;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  clientName: string | null;
  status: string;
  description: string | null;
};

export function EditProjectForm({
  project,
  parties,
  footer,
}: Readonly<{
  project: Project;
  parties: { id: number; name: string }[];
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateProject(prev, formData);
      if (res.ok) {
        toast.success("已更新");
        close();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );

  return (
    <form onSubmit={submitAction(action)} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={project.id} />

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">專案名稱<Req /></Label>
        <Input id="name" name="name" required defaultValue={project.name} />
      </div>
      <PartyField
        parties={parties}
        name="clientPartyName"
        defaultName={project.clientName ?? ""}
      />
      <div className="space-y-1.5">
        <Label>狀態</Label>
        <Select name="status" defaultValue={project.status}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">進行中</SelectItem>
            <SelectItem value="archived">封存</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="description">說明</Label>
        <Input id="description" name="description" defaultValue={project.description ?? ""} />
      </div>

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
