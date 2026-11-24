"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { DatePicker } from "@/components/date-picker";
import { GlowButton } from "@/components/ds/glow-button";
import { Field, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

function formText(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * 建立金鑰：表單 → 成功後同一個對話框換成「複製金鑰」畫面。完整金鑰只在這裡出現一次，
 * 關掉對話框就從記憶體消失（state 清空），之後只看得到 prefix。
 */
export function CreateApiKeyButton() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"read" | "write">("read");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [pending, start] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 關窗就把明文丟掉；重新整理列表，新金鑰（只有 prefix）才會出現。
      if (created) router.refresh();
      setCreated(null);
      setScope("read");
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      const res = await createApiKeyAction({
        name: formText(form, "name"),
        scope,
        expiresOn: formText(form, "expiresOn"),
      });
      if (res.ok) setCreated({ key: res.key, name: res.name });
      else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <GlowButton size="sm">
          <Plus className="size-4" /> {t("api.create.trigger")}
        </GlowButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("api.create.doneTitle", { name: created.name })}</DialogTitle>
              <DialogDescription>{t("api.create.doneDescription")}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs select-all">
                {created.key}
              </code>
              <CopyButton value={created.key} label="" />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("api.create.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{t("api.create.title")}</DialogTitle>
              <DialogDescription>{t("api.create.description")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <TextField
                name="name"
                label={t("api.create.nameLabel")}
                placeholder={t("api.create.namePlaceholder")}
                required
                maxLength={100}
                autoComplete="off"
              />
              <Field label={t("api.create.scopeLabel")} required>
                <Select value={scope} onValueChange={(v) => setScope(v === "write" ? "write" : "read")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">{t("api.scope.read")}</SelectItem>
                    <SelectItem value="write">{t("api.scope.write")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t(`api.create.scopeHint.${scope}`)}</p>
              </Field>
              <Field label={t("api.create.expiresLabel")}>
                <DatePicker name="expiresOn" allowEmpty placeholder={t("api.create.expiresPlaceholder")} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t("api.create.submitting") : t("api.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeApiKeyButton({ id, name }: Readonly<{ id: number; name: string }>) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function onConfirm() {
    start(async () => {
      const res = await revokeApiKeyAction(id);
      if (res.ok) {
        setOpen(false);
        toast.success(t("api.revoke.success"));
        router.refresh();
      } else {
        toast.error(res.error ?? t("api.errors.failed"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" /> {t("api.revoke.trigger")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("api.revoke.title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("api.revoke.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("api.revoke.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? t("api.revoke.confirming") : t("api.revoke.trigger")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
