"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectChoiceField, type ProjectChoiceOption } from "@/components/project-choice-field";
import { submitAction } from "@/lib/form-action";
import { archiveProject, assignContractProject, type ActionState } from "./actions";

/** 「合約都已完成，可結案」旁的一鍵封存。放在可點開的列裡，點它不會打開編輯視窗（RowDialog 會略過 button）。 */
export function ArchiveProjectButton({ id, name }: Readonly<{ id: number; name: string }>) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      const res = await archiveProject(id);
      if (res.ok) {
        toast.success(t("readyToClose.toast.archived", { name }));
        router.refresh();
      } else if (res.error) {
        toast.error(res.error);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="xs" disabled={pending} onClick={onClick}>
      <Archive className="size-3.5" />
      {pending ? t("readyToClose.archiving") : t("readyToClose.archive")}
    </Button>
  );
}

/** 未歸類合約那一列的指派：選既有專案或「建立同名專案」，按「歸入」。 */
export function AssignContractProjectForm({
  contractId,
  projects,
}: Readonly<{ contractId: number; projects: ProjectChoiceOption[] }>) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [, dispatch, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await assignContractProject(prev, formData);
      if (res.ok) {
        toast.success(t("unassigned.toast.assigned"));
        router.refresh();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    { ok: false } satisfies ActionState,
  );
  const ready = choice !== "" && choice !== "invalid" && choice !== "none";

  return (
    <form onSubmit={submitAction(dispatch)} className="flex items-center gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <ProjectChoiceField
        projects={projects}
        defaultChoice={null}
        includeNone={false}
        newLabel={t("unassigned.createSameName")}
        className="w-56"
        onChoiceChange={setChoice}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || !ready}
        title={ready ? undefined : t("unassigned.pickFirst")}
      >
        {pending ? t("unassigned.assigning") : t("unassigned.assign")}
      </Button>
    </form>
  );
}
