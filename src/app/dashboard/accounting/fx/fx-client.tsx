"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ClipboardPaste, Download, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GlowButton } from "@/components/ds/glow-button";
import { Field } from "@/components/form-field";
import { CurrencyFlag } from "@/components/currency-flag";
import { SearchSelect } from "@/app/dashboard/vendor-billing/pickers";
import { textareaClass } from "@/app/dashboard/vendor-billing/shared";
import { CURRENCIES } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { fillMissingAmountTwd, importFxRatesFromWise, upsertFxRates } from "@/db/ledger-mutations";

/** 從已連接的 Wise 匯入每日匯率：交易用到的每個外幣各打一次。 */
export function ImportWiseRatesButton({ currencies }: Readonly<{ currencies: string[] }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending || currencies.length === 0}
      onClick={() =>
        start(async () => {
          let total = 0;
          for (const currency of currencies) {
            const res = await importFxRatesFromWise({ currency });
            if (!res.ok) {
              toast.error(`${currency}：${res.error ?? t("errors.saveFailed")}`);
              return;
            }
            total += res.count ?? 0;
          }
          toast.success(t("fx.importWiseDone", { count: total }));
          router.refresh();
        })
      }
    >
      <Download className="size-4" /> {t("fx.importWise")}
    </Button>
  );
}

/** 補齊外幣交易的台幣金額，結果用 toast 回報補了幾筆、略過幾筆。 */
export function FillAmountTwdButton({ missing }: Readonly<{ missing: number }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending || missing === 0}
      onClick={() =>
        start(async () => {
          const res = await fillMissingAmountTwd();
          if (!res.ok) {
            toast.error(res.error ?? t("errors.saveFailed"));
            return;
          }
          toast.success(t("fx.fillDone", { filled: res.filled ?? 0, skipped: res.skipped ?? 0 }));
          router.refresh();
        })
      }
    >
      <Wand2 className="size-4" /> {t("fx.fill")}
    </Button>
  );
}

/** 貼上一段「日期 匯率」寫進匯率表（同一天覆蓋）。 */
export function PasteRatesButton({
  currencies,
  functionalCurrency,
}: Readonly<{ currencies: string[]; functionalCurrency: string }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const options = React.useMemo(() => {
    const codes = [...new Set([...CURRENCIES.map((c) => c.code), ...currencies])].filter((c) => c !== functionalCurrency);
    return codes.map((c) => ({ value: c, label: c, hint: <CurrencyFlag currency={c} /> }));
  }, [currencies, functionalCurrency]);
  const [currency, setCurrency] = React.useState<string>(currencies[0] ?? options[0]?.value ?? "USD");
  const [text, setText] = React.useState("");
  const [pending, start] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      const res = await upsertFxRates({ currency, text });
      if (!res.ok) {
        toast.error(res.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("fx.saved", { count: res.count ?? 0 }));
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <GlowButton size="sm" onClick={() => setOpen(true)}>
        <ClipboardPaste className="size-4" /> {t("fx.paste")}
      </GlowButton>
      <Sheet open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader className="shrink-0 border-b pr-10">
            <SheetTitle>{t("fx.sheetTitle")}</SheetTitle>
            <SheetDescription className="text-xs">{t("fx.sheetDescription")}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
              <Field label={t("fx.currency")} htmlFor="fx-currency" required>
                <SearchSelect
                  id="fx-currency"
                  options={options}
                  value={currency}
                  onChange={(v) => v && setCurrency(v)}
                />
              </Field>
              <Field label={t("fx.lines")} htmlFor="fx-lines" required className="flex-1">
                <textarea
                  id="fx-lines"
                  required
                  value={text}
                  spellCheck={false}
                  placeholder={t("fx.linesPlaceholder")}
                  className={cn(textareaClass, "min-h-64 flex-1 font-mono tabular-nums")}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
            </div>
            <SheetFooter className="shrink-0 flex-row justify-end border-t">
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending || text.trim() === ""}>
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
