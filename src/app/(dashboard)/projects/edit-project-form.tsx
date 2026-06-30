"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateProject, type ActionState } from "@/db/mutations";
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

const initial: ActionState = { ok: false };

type Project = {
  id: number;
  name: string;
  clientPartyId: number | null;
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
  const [state, action, pending] = useActionState(updateProject, initial);

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
      <input type="hidden" name="id" value={project.id} />

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">專案名稱<Req /></Label>
        <Input id="name" name="name" required defaultValue={project.name} />
      </div>
      <div className="space-y-1.5">
        <Label>客戶</Label>
        <Select
          name="clientPartyId"
          defaultValue={project.clientPartyId == null ? undefined : String(project.clientPartyId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— 未指定 —" />
          </SelectTrigger>
          <SelectContent>
            {parties.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
