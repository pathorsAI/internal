"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { UserPlus, X, AlertTriangle, Users, RotateCw } from "lucide-react";
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
import { Field } from "@/components/form-field";
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
import { formatDateTime } from "@/lib/format";

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
  expiresAt: string | Date;
};

const inviteRoles = ["member", "admin"] as const;

export function MembersClient() {
  const t = useTranslations("members");
  const roleLabel: Record<string, string> = {
    owner: t("role.owner"),
    admin: t("role.admin"),
    member: t("role.member"),
  };
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

  // 「現在時間」是元件外的可變狀態，直接在 render 裡讀 Date.now() 是不純的（同一次
  // render 重跑結果就會不一樣）。用 useState 的 lazy initializer 在掛載時取一次快照，
  // 之後所有 re-render 都拿同一個值。邀請的到期是以天為單位，不需要跟著時間跳動。
  const [now] = useState(() => Date.now());

  // 過期的邀請在 DB 裡 status 仍然是 pending（better-auth 不會改狀態），所以只靠
  // status 分不出「還能接受」與「按下去必定失敗」。這裡自己比對 expiresAt，把過期的
  // 標出來並排到後面，而不是像以前那樣一律顯示成「待接受」。
  const invitations = ((activeOrg?.invitations ?? []) as unknown as Invitation[])
    .filter((i) => i.status === "pending")
    .map((i) => ({ ...i, expired: new Date(i.expiresAt).getTime() < now }))
    .sort((a, b) => Number(a.expired) - Number(b.expired));

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
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
      toast.error(error.message || t("invite.toast.failed"));
      return;
    }
    toast.success(t("invite.toast.success", { email: value }));
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
      toast.error(error.message || t("invitations.toast.failed"));
      return;
    }
    toast.success(t("invitations.toast.success"));
  }

  // 重新邀請刻意走「先 cancel 舊的、再 invite 一筆新的」，而不是 inviteMember 的
  // resend: true。原因是 better-auth 的 findPendingInvitation() 會濾掉已過期的邀請，
  // 所以 resend 對「已過期」那筆完全沒作用 —— 它會判定沒有既有邀請而另建一筆，舊的
  // 過期 row 就永遠留在表裡變成殭屍。先 cancel 再 invite 對「已過期」和「還沒過期」
  // 兩種情況都正確，而且列表上不會疊出重複的 email。
  async function onResend(inv: Invitation) {
    setResendingId(inv.id);
    const { error: cancelError } = await authClient.organization.cancelInvitation({
      invitationId: inv.id,
    });
    if (cancelError) {
      setResendingId(null);
      toast.error(cancelError.message || t("invitations.toast.resendFailed"));
      return;
    }
    const { error } = await authClient.organization.inviteMember({
      email: inv.email,
      role: (inv.role ?? "member") as "member" | "admin",
    });
    setResendingId(null);
    if (error) {
      toast.error(error.message || t("invitations.toast.resendFailed"));
      return;
    }
    toast.success(t("invitations.toast.resent", { email: inv.email }));
  }

  async function onDeleteOrg() {
    if (!activeOrg) return;
    setDeleting(true);
    const { error } = await authClient.organization.delete({
      organizationId: activeOrg.id,
    });
    if (error) {
      setDeleting(false);
      toast.error(error.message || t("danger.toast.failed"));
      return;
    }
    setDeleteDialogOpen(false);
    // Drop the deleted org from the localStorage preference so the switcher
    // doesn't try to restore it on the next load.
    if (localStorage.getItem(LAST_ORG_KEY) === activeOrg.id) {
      localStorage.removeItem(LAST_ORG_KEY);
    }
    toast.success(t("danger.toast.success", { name: activeOrg.name }));
    // Move to another org if one remains, otherwise send the user back through
    // onboarding to create or join one.
    const next = (organizations ?? []).find((o) => o.id !== activeOrg.id);
    if (next) {
      await authClient.organization.setActive({ organizationId: next.id });
      localStorage.setItem(LAST_ORG_KEY, next.id);
      router.push("/dashboard");
    } else {
      router.push("/onboarding");
    }
    router.refresh();
  }

  if (orgPending) {
    return (
      <Card>
        <div className="p-8 text-center text-sm text-muted-foreground">{t("loading")}</div>
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
              {t("invite.title")}
            </CardTitle>
            <CardDescription>
              {t("invite.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
              <Field
                label={t("invite.emailLabel")}
                htmlFor="invite-email"
                className="min-w-[16rem] flex-1"
              >
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder={t("invite.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label={t("invite.roleLabel")} className="w-36">
                <Select value={role} onValueChange={(v) => v && setRole(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inviteRoles.map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`role.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={inviting}>
                {inviting ? t("invite.submitting") : t("invite.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("list.title", { count: members.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <EmptyState icon={Users} message={t("list.empty")} />
          ) : (
            <ul className="divide-y rounded-md border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {m.user.name || m.user.email}
                      {m.user.id === session?.user.id ? (
                        <span className="ml-2 text-xs text-muted-foreground">{t("list.you")}</span>
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
            <CardTitle>{t("invitations.title", { count: invitations.length })}</CardTitle>
            <CardDescription>{t("invitations.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {roleLabel[inv.role ?? "member"] ?? inv.role}
                      {!inv.expired && (
                        <span className="ml-2">
                          {t("invitations.expiresAt", { date: formatDateTime(inv.expiresAt) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant={inv.expired ? "destructive" : "outline"}>
                    {inv.expired ? t("invitations.expired") : t("invitations.pending")}
                  </Badge>
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onResend(inv)}
                        disabled={resendingId !== null || cancelingId !== null}
                        aria-label={t("invitations.resend")}
                      >
                        <RotateCw className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onCancel(inv.id)}
                        disabled={cancelingId !== null || resendingId !== null}
                        aria-label={t("invitations.cancel")}
                      >
                        <X className="size-4" />
                      </Button>
                    </>
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
              {t("danger.title")}
            </CardTitle>
            <CardDescription>
              {t("danger.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={deleting}>
                  {deleting
                    ? t("danger.deleting")
                    : t("danger.deleteTrigger", { name: activeOrg?.name ?? t("danger.defaultOrgName") })}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("danger.confirmTitle", { name: activeOrg?.name ?? t("danger.defaultOrgName") })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("danger.confirmDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>{t("danger.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={deleting}
                    onClick={(e) => {
                      e.preventDefault();
                      onDeleteOrg();
                    }}
                  >
                    {deleting ? t("danger.deleting") : t("danger.confirm")}
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
