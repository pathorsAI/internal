"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// Copy-to-clipboard button. Pass label="" for an icon-only variant.
export function CopyButton({
  value,
  label = "複製",
  className,
}: Readonly<{ value: string; label?: string; className?: string }>) {
  const [copied, setCopied] = useState(false);
  const iconOnly = label === "";

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
      aria-label={iconOnly ? "複製" : label}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {!iconOnly && (copied ? "已複製" : label)}
    </Button>
  );
}
