"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tags } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { CategoryFormDialog } from "./category-form-dialog";

type Cat = { id: number; name: string; kind: string };

const KINDS = ["income", "cogs", "expense"] as const;

export function CategoryBoard({ categories }: Readonly<{ categories: Cat[] }>) {
  const t = useTranslations("categories");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("income");
  const TABS = KINDS.map((k) => ({
    kind: k,
    label: t(`tabs.${k}.label`),
    add: t(`tabs.${k}.add`),
  }));
  const tab = TABS.find((tb) => tb.kind === kind) ?? TABS[0];
  const list = categories.filter((c) => c.kind === kind);

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-0.5 rounded-lg border bg-muted/60 p-0.5">
        {TABS.map((tb) => (
          <button
            key={tb.kind}
            type="button"
            aria-pressed={tb.kind === kind}
            onClick={() => setKind(tb.kind)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              tb.kind === kind
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-medium text-muted-foreground tabular-nums">
            {t("count", { count: list.length })}
          </span>
          <CategoryFormDialog kind={kind} addLabel={tab.add} />
        </div>
        {list.length === 0 ? (
          <EmptyState icon={Tags} message={t("empty")}>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {list.map((c) => (
              <li
                key={c.id}
                className="flex h-10 items-center justify-between px-4 transition-colors hover:bg-muted/40"
              >
                <span className="text-sm">{c.name}</span>
                <CategoryFormDialog kind={kind} category={{ id: c.id, name: c.name }} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
