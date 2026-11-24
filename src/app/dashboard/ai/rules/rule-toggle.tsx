"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setAiRuleDisabled } from "./actions";

/** 停用／重新啟用一條規則。停用的規則不會放進 AI 的提示，也不會套到匯入。 */
export function RuleToggle({ id, disabled }: Readonly<{ id: number; disabled: boolean }>) {
  const t = useTranslations("ai.rules");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setAiRuleDisabled(id, !disabled);
          if (res.ok) router.refresh();
          else toast.error(t("updateFailed"));
        })
      }
    >
      {disabled ? t("enable") : t("disable")}
    </Button>
  );
}
