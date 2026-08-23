"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
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

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

type Invite = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
};

export default function OnboardingPage() {
  const t = useTranslations("auth.onboarding");
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  // Until we know whether the user already belongs to an org, render nothing so
  // we don't flash the create-org UI at members who shouldn't see it.
  const [checkingMembership, setCheckingMembership] = useState(true);

  useEffect(() => {
    (async () => {
      // If the user already belongs to an org (e.g. added during sign-up or via
      // an accepted invite), skip onboarding entirely and drop them straight in.
      const { data: orgs } = await authClient.organization.list();
      if (orgs && orgs.length > 0) {
        await enter(orgs[0].id);
        return;
      }
      setCheckingMembership(false);

      const { data, error } = await authClient.organization.listUserInvitations();
      if (!error && data) setInvites(data as unknown as Invite[]);
      setLoadingInvites(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enter(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    router.push("/");
    router.refresh();
  }

  async function onAccept(inv: Invite) {
    setAcceptingId(inv.id);
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: inv.id,
    });
    if (error) {
      setAcceptingId(null);
      toast.error(error.message || t("invites.toast.acceptFailed"));
      return;
    }
    toast.success(t("invites.toast.joined", { name: inv.organizationName }));
    await enter(inv.organizationId);
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nameField = form.get("name");
    const name = (typeof nameField === "string" ? nameField : "").trim();
    const slug = slugify(name) || `org-${Date.now()}`;
    setCreating(true);
    const { data: org, error } = await authClient.organization.create({ name, slug });
    if (error || !org) {
      setCreating(false);
      toast.error(error?.message || t("create.toast.failed"));
      return;
    }
    toast.success(t("create.toast.created", { name: org.name }));
    await enter(org.id);
  }

  if (checkingMembership) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        {!loadingInvites && invites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailCheck className="size-5 text-muted-foreground" />
                {t("invites.title")}
              </CardTitle>
              <CardDescription>{t("invites.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{inv.organizationName}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("invites.role", { role: inv.role })}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onAccept(inv)}
                    disabled={acceptingId !== null}
                  >
                    {acceptingId === inv.id ? t("invites.accepting") : t("invites.accept")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              {t("create.title")}
            </CardTitle>
            {invites.length > 0 ? (
              <CardDescription>{t("create.descriptionWithInvites")}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("create.nameLabel")}</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder={t("create.namePlaceholder")}
                />
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? t("create.submitting") : t("create.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
