"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Field } from "@/components/form-field";
import { PartyCombobox } from "@/components/party-combobox";
import { cn } from "@/lib/utils";
import type { AdvancePayeeKind } from "@/lib/advance-payee";

const KINDS: AdvancePayeeKind[] = ["employee", "party"];

/**
 * 代墊的「代墊人」：員工或公司（交易對象）。新增與編輯交易共用。
 *
 * 送出 settleKind + settleEmployeeName 或 settlePartyName（只渲染目前選的那一欄，
 * 另一欄不會送；server 端也只讀 settleKind 指定的那一欄，見 mutations.ts resolveAdvance）。
 */
export function AdvancePayerField({
  employees,
  parties,
  defaultKind = "employee",
  defaultName = "",
}: Readonly<{
  employees: { id: number; name: string }[];
  parties: { id: number; name: string }[];
  defaultKind?: AdvancePayeeKind;
  defaultName?: string;
}>) {
  const t = useTranslations("transactions");
  const [kind, setKind] = useState<AdvancePayeeKind>(defaultKind);

  return (
    <Field label={t("form.payer")} required wide>
      <input type="hidden" name="settleKind" value={kind} />
      <div
        role="radiogroup"
        aria-label={t("form.payer")}
        className="inline-flex w-fit rounded-md border bg-muted/40 p-0.5"
      >
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors",
              kind === k
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`form.payerKind.${k}`)}
          </button>
        ))}
      </div>
      {/* key 讓切換時重設輸入內容：員工名稱不會被當成公司名稱送出，反之亦然 */}
      {kind === "party" ? (
        <PartyCombobox
          key="party"
          parties={parties}
          name="settlePartyName"
          defaultName={defaultKind === "party" ? defaultName : ""}
          placeholder={t("form.payerCompanyPlaceholder")}
        />
      ) : (
        <PartyCombobox
          key="employee"
          parties={employees}
          name="settleEmployeeName"
          defaultName={defaultKind === "employee" ? defaultName : ""}
          placeholder={t("form.payerPlaceholder")}
        />
      )}
      {kind === "party" ? (
        <p className="text-xs text-muted-foreground">{t("form.payerKindHint")}</p>
      ) : null}
    </Field>
  );
}
