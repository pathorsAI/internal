"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
} from "@/lib/auth-client";

const LAST_ORG_KEY = "lastOrgId";
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
  // Guard so the localStorage-driven auto-switch only runs once per mount.
  const restoredRef = useRef(false);

  const items = Object.fromEntries(
    (organizations ?? []).map((o) => [o.id, o.name]),
  );

  // On first load, if the user previously picked a different org than the
  // session's active one, restore that choice from localStorage.
  useEffect(() => {
    if (restoredRef.current) return;
    if (!organizations || organizations.length === 0 || !activeOrg) return;
    restoredRef.current = true;
    const stored = localStorage.getItem(LAST_ORG_KEY);
    if (stored && stored !== activeOrg.id && organizations.some((o) => o.id === stored)) {
      void onChange(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizations, activeOrg]);

  async function onChange(organizationId: string | null) {
    if (!organizationId || organizationId === activeOrg?.id) return;
    setSwitching(true);
    const { error } = await authClient.organization.setActive({ organizationId });
    setSwitching(false);
    if (error) {
      toast.error(error.message || "切換組織失敗");
      return;
    }
    localStorage.setItem(LAST_ORG_KEY, organizationId);
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
