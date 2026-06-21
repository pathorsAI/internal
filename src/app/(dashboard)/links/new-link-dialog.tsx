"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createLink, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
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

export function NewLinkDialog({
  parties,
  projects,
}: Readonly<{
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLink, initial);
  const partyItems = Object.fromEntries(parties.map((p) => [String(p.id), p.name]));
  const projectItems = Object.fromEntries(projects.map((p) => [String(p.id), p.name]));

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增連結");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> 新增連結
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增連結</DialogTitle>
            <DialogDescription>
              貼上 Google Drive 或任何網址，可選擇掛到客戶 / 專案
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">標題<Req /></Label>
              <Input id="title" name="title" required placeholder="例：ABV 服務合約" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url">網址<Req /></Label>
              <Input
                id="url"
                name="url"
                required
                type="url"
                placeholder="https://drive.google.com/..."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>客戶 / 交易對象</Label>
                <Select name="partyId" items={partyItems}>
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
                <Label>專案</Label>
                <Select name="projectId" items={projectItems}>
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">備註</Label>
              <Input id="note" name="note" placeholder="選填" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
