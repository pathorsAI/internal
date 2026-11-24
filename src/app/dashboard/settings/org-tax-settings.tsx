"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Percent } from "lucide-react";
import { updateOrgTaxSettings, type ActionState } from "@/db/mutations";
import { submitAction } from "@/lib/form-action";
import { Button } from "@/components/ui/button";
import { TaxFields } from "@/components/tax-fields";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TaxSetting } from "@/lib/tax-treatment";

const initial: ActionState = { ok: false };

/**
 * 組織的營業稅別預設（organization.tax_treatment / amount_basis）。
 *
 * 跟組織名稱分開存：名稱走 better-auth 的 organization.update，這兩欄是本系統自己的，
 * 由 server action（updateOrgTaxSettings）重新檢查角色後寫入 session 所在的組織。
 * 這頁的光暈按鈕已經給了組織名稱，這裡用一般按鈕。
 */
export function OrgTaxSettings({
  setting,
  canEdit,
}: Readonly<{ setting: TaxSetting; canEdit: boolean }>) {
  const t = useTranslations("settings.tax");
  const tTax = useTranslations("common.tax");
  const router = useRouter();
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateOrgTaxSettings(prev, formData);
      if (res.ok) {
        toast.success(t("toast.updated"));
        router.refresh();
      } else {
        toast.error(res.error ?? t("toast.updateFailed"));
      }
      return res;
    },
    initial,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="size-5 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        {canEdit ? null : <CardDescription>{t("descriptionReadOnly")}</CardDescription>}
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <form onSubmit={submitAction(action)} className="max-w-lg space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* key 讓存檔、router.refresh 之後下拉回到伺服器的值 */}
              <TaxFields
                key={`${setting.treatment}:${setting.basis}`}
                treatment={setting.treatment}
                basis={setting.basis}
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </form>
        ) : (
          <dl className="grid max-w-lg gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{tTax("treatmentLabel")}</dt>
            <dd>{tTax(`treatment.${setting.treatment}`)}</dd>
            <dt className="text-muted-foreground">{tTax("basisLabel")}</dt>
            <dd>{tTax(`basis.${setting.basis}`)}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
