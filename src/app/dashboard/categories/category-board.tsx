"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
      <div className="flex gap-1">
        {TABS.map((tb) => (
          <button
            key={tb.kind}
            type="button"
            onClick={() => setKind(tb.kind)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tb.kind === kind
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm text-muted-foreground">{t("count", { count: list.length })}</span>
          <CategoryFormDialog kind={kind} addLabel={tab.add} />
        </div>
        {list.length === 0 ? (
          <EmptyState message={t("empty")}>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {list.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2.5">
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
