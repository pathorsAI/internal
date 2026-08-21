"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { revokeMcpClient } from "@/db/mutations";
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

export function RevokeClientButton({
  clientId,
  name,
}: Readonly<{ clientId: string; name: string }>) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function onConfirm() {
    start(async () => {
      const res = await revokeMcpClient(clientId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("mcp.clients.revoke.toast.success"));
        router.refresh();
      } else {
        toast.error(res.error ?? t("mcp.clients.revoke.toast.failed"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <Trash2 className="size-4" /> {t("mcp.clients.revoke.trigger")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("mcp.clients.revoke.confirmTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("mcp.clients.revoke.confirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("mcp.clients.revoke.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? t("mcp.clients.revoke.confirming") : t("mcp.clients.revoke.trigger")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
