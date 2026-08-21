"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Copy-to-clipboard button. Pass label="" for an icon-only variant.
export function CopyButton({
  value,
  label,
  className,
}: Readonly<{ value: string; label?: string; className?: string }>) {
  const t = useTranslations("common");
  const resolvedLabel = label ?? t("copyButton.label");
  const [copied, setCopied] = useState(false);
  const iconOnly = resolvedLabel === "";

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable (e.g. non-HTTPS context) — ignore
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : "sm"}
      onClick={onCopy}
      className={className}
      aria-label={iconOnly ? t("copyButton.label") : resolvedLabel}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {!iconOnly && (copied ? t("copyButton.copied") : resolvedLabel)}
    </Button>
  );
}
