"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, X, AlertTriangle, Users } from "lucide-react";
import {
  authClient,
  useActiveMember,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";

const LAST_ORG_KEY = "lastOrgId";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";

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
  const router = useRouter();
  const { data: session } = useSession();
  const { data: activeMember } = useActiveMember();
  const { data: activeOrg, isPending: orgPending } = useActiveOrganization();
  const { data: organizations } = useListOrganizations();
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";
  const isOwner = activeMember?.role === "owner";

  // 成員與邀請直接取自 useActiveOrganization() —— 它背後打的就是
  // /organization/get-full-organization，跟這裡原本手動 fetch 的是同一支 API，
  // 而且 better-auth 的 atom listener 會在任何 /organization/* 呼叫後自動重取。
  // 所以不需要自己維護 state、不需要 effect、也不必在邀請/取消後手動 reload，
  // 順便省掉掛載時重複打同一支 API 的那一次。
  const members = (activeOrg?.members ?? []) as unknown as Member[];
  const invitations = ((activeOrg?.invitations ?? []) as unknown as Invitation[]).filter(
    (i) => i.status === "pending",
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
  }

  async function onDeleteOrg() {
    if (!activeOrg) return;
    setDeleting(true);
    const { error } = await authClient.organization.delete({
      organizationId: activeOrg.id,
    });
    if (error) {
      setDeleting(false);
      toast.error(error.message || "刪除組織失敗");
      return;
    }
    setDeleteDialogOpen(false);
    // Drop the deleted org from the localStorage preference so the switcher
    // doesn't try to restore it on the next load.
    if (localStorage.getItem(LAST_ORG_KEY) === activeOrg.id) {
      localStorage.removeItem(LAST_ORG_KEY);
    }
    toast.success(`已刪除 ${activeOrg.name}`);
    // Move to another org if one remains, otherwise send the user back through
    // onboarding to create or join one.
    const next = (organizations ?? []).find((o) => o.id !== activeOrg.id);
    if (next) {
      await authClient.organization.setActive({ organizationId: next.id });
      localStorage.setItem(LAST_ORG_KEY, next.id);
      router.push("/");
    } else {
      router.push("/onboarding");
    }
    router.refresh();
  }

  if (orgPending) {
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
                <Select value={role} onValueChange={(v) => v && setRole(v)}>
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
          {members.length === 0 ? (
            <EmptyState icon={Users} message="尚無成員" />
          ) : (
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
          )}
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

      {isOwner && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              危險區域
            </CardTitle>
            <CardDescription>
              刪除組織會永久移除組織內所有資料，且無法復原。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={deleting}>
                  {deleting ? "刪除中…" : `刪除「${activeOrg?.name ?? "組織"}」`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    確定要刪除組織「{activeOrg?.name ?? "組織"}」嗎？
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    此動作無法復原，組織內所有資料將一併刪除。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={deleting}
                    onClick={(e) => {
                      e.preventDefault();
                      onDeleteOrg();
                    }}
                  >
                    {deleting ? "刪除中…" : "刪除"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
