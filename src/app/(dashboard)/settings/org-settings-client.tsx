"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import {
  authClient,
  useActiveMember,
  useActiveOrganization,
} from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function OrgSettingsClient() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const canEdit = activeMember?.role === "owner" || activeMember?.role === "admin";

  // `draft` is null until the user actually types, so the field simply *shows*
  // the active org's name rather than copying it into state via an effect.
  // Switching orgs therefore updates the field for free, and clearing the draft
  // after a save re-syncs it to whatever the server returned.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = draft ?? activeOrg?.name ?? "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeOrg) return;
    const value = name.trim();
    if (!value) {
      toast.error("組織名稱不可空白");
      return;
    }
    if (value === activeOrg.name) return;
    setSaving(true);
    const { error } = await authClient.organization.update({
      organizationId: activeOrg.id,
      data: { name: value },
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || "更新失敗");
      return;
    }
    toast.success("已更新組織名稱");
    setDraft(null);
    router.refresh();
  }

  if (!activeOrg) {
    return (
      <Card>
        <div className="p-8 text-center text-sm text-muted-foreground">載入中…</div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-5 text-muted-foreground" />
          基本資料
        </CardTitle>
        <CardDescription>
          {canEdit ? "修改組織名稱" : "只有擁有者或管理員可以修改組織資料"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-sm space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">組織名稱</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canEdit || saving}
              required
            />
          </div>
          {canEdit && (
            <Button type="submit" disabled={saving || name.trim() === activeOrg.name}>
              {saving ? "儲存中…" : "儲存"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
