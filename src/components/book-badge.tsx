import { Badge } from "@/components/ui/badge";

const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  internal: { label: "內帳", variant: "secondary" },
  external: { label: "外帳", variant: "default" },
  both: { label: "內外", variant: "outline" },
};

export function BookBadge({ book }: { book: string }) {
  const cfg = map[book] ?? { label: book, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
