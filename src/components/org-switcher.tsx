"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
} from "@/lib/auth-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function OrgSwitcher() {
  const router = useRouter();
  const { data: organizations } = useListOrganizations();
  const { data: activeOrg } = useActiveOrganization();
  const [switching, setSwitching] = useState(false);

  const items = Object.fromEntries(
    (organizations ?? []).map((o) => [o.id, o.name]),
  );

  async function onChange(organizationId: string | null) {
    if (!organizationId || organizationId === activeOrg?.id) return;
    setSwitching(true);
    const { error } = await authClient.organization.setActive({ organizationId });
    setSwitching(false);
    if (error) {
      toast.error(error.message || "切換組織失敗");
      return;
    }
    router.refresh();
  }

  return (
    <Select
      items={items}
      value={activeOrg?.id ?? ""}
      onValueChange={onChange}
      disabled={switching || (organizations?.length ?? 0) === 0}
    >
      <SelectTrigger className="w-full" size="default">
        <Building2 className="size-4 text-muted-foreground" />
        <SelectValue placeholder="選擇組織" />
      </SelectTrigger>
      <SelectContent>
        {(organizations ?? []).map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
