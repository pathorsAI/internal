"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("statements.print");
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer /> {t("button")}
    </Button>
  );
}
