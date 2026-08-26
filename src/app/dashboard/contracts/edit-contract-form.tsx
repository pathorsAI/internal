"use client";

import { useTranslations } from "next-intl";
import { updateContract } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import { ContractFields, type ContractFormValues, type Option } from "./contract-fields";

type Contract = ContractFormValues & { id: number };

export function EditContractForm({
  contract,
  parties,
  projects,
  summary,
  scheduleCount = 0,
  lockedScheduleCount = 0,
  extra,
  footer,
}: Readonly<{
  contract: Contract;
  parties: Option[];
  projects: Option[];
  summary?: { received: number; cost: number; remaining: number | null };
  /** 這張合約已有幾筆請款項目，以及其中已動過（不可重排）的筆數 */
  scheduleCount?: number;
  lockedScheduleCount?: number;
  /** 額外區塊（分期請款清單），由 Server Component 傳進來 */
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("contracts");

  return (
    <EditForm
      action={updateContract}
      successMessage={t("editForm.toast.updated")}
      cancelLabel={t("editForm.cancel")}
      submitLabel={t("editForm.submit")}
      submittingLabel={t("editForm.submitting")}
      footer={footer}
    >
      <input type="hidden" name="id" value={contract.id} />
      <ContractFields
        parties={parties}
        projects={projects}
        values={contract}
        summary={summary}
        scheduleCount={scheduleCount}
        lockedScheduleCount={lockedScheduleCount}
        extra={extra}
      />
    </EditForm>
  );
}
