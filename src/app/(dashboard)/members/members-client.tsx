"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { authClient, useActiveMember, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Member = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string; image?: string | null };
};
type Invitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
};

const roleLabel: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
};
const roleItems = { member: "成員", admin: "管理員" };

export function MembersClient() {
  const { data: session } = useSession();
  const { data: activeMember } = useActiveMember();
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await authClient.organization.getFullOrganization();
    if (error || !data) {
      setLoading(false);
      return;
    }
    setMembers((data.members ?? []) as unknown as Member[]);
    setInvitations(
      ((data.invitations ?? []) as unknown as Invitation[]).filter(
        (i) => i.status === "pending",
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setInviting(true);
    const { error } = await authClient.organization.inviteMember({
      email: value,
      role: role as "member" | "admin",
    });
    setInviting(false);
    if (error) {
      toast.error(error.message || "邀請失敗");
      return;
    }
    toast.success(`已邀請 ${value}`);
    setEmail("");
    setRole("member");
    load();
  }

  async function onCancel(id: string) {
    setCancelingId(id);
    const { error } = await authClient.organization.cancelInvitation({
      invitationId: id,
    });
    setCancelingId(null);
    if (error) {
      toast.error(error.message || "取消失敗");
      return;
    }
    toast.success("已取消邀請");
    load();
  }

  if (loading) {
    return (
      <Card>
        <div className="p-8 text-center text-sm text-muted-foreground">載入中…</div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-muted-foreground" />
              邀請成員
            </CardTitle>
            <CardDescription>
              用對方的 Google 帳號 email 邀請。對方用同一個 email 登入後即可在進入畫面接受邀請，不需要任何邀請碼。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="w-36 space-y-1.5">
                <Label>身分</Label>
                <Select items={roleItems} value={role} onValueChange={(v) => v && setRole(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleItems).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={inviting}>
                {inviting ? "邀請中…" : "送出邀請"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>成員（{members.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {m.user.name || m.user.email}
                    {m.user.id === session?.user.id ? (
                      <span className="ml-2 text-xs text-muted-foreground">（你）</span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.user.email}
                  </div>
                </div>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                  {roleLabel[m.role] ?? m.role}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>待接受的邀請（{invitations.length}）</CardTitle>
            <CardDescription>對方用該 email 登入後即可接受</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {roleLabel[inv.role ?? "member"] ?? inv.role}
                    </div>
                  </div>
                  <Badge variant="outline">待接受</Badge>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onCancel(inv.id)}
                      disabled={cancelingId !== null}
                      aria-label="取消邀請"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
