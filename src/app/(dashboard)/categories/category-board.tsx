"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CategoryFormDialog } from "./category-form-dialog";

type Cat = { id: number; name: string; kind: string };

const TABS = [
  { kind: "income", label: "收入分類", add: "新增收入" },
  { kind: "cogs", label: "成本分類", add: "新增成本" },
  { kind: "expense", label: "費用分類", add: "新增費用" },
];

export function CategoryBoard({ categories }: Readonly<{ categories: Cat[] }>) {
  const [kind, setKind] = useState("income");
  const tab = TABS.find((t) => t.kind === kind) ?? TABS[0];
  const list = categories.filter((c) => c.kind === kind);

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setKind(t.kind)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              t.kind === kind
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm text-muted-foreground">{list.length} 個分類</span>
          <CategoryFormDialog kind={kind} addLabel={tab.add} />
        </div>
        {list.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            尚無分類，點右上角新增
          </p>
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
