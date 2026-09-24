"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const employmentTypes = ["full_time", "part_time", "freelancer", "contractor"] as const;

export type MemberOption = { userId: string; name: string; email: string };

export type EmployeeFormValues = {
  name: string;
  nationalId: string | null;
  /**
   * true = nationalId 是遮罩後的值（沒有權限看完整值的成員）。遮罩值絕不能被送回
   * server 當成新的身分證字號，所以這時輸入框不帶 name、而且停用。
   */
  nationalIdMasked?: boolean;
  employmentType: string;
  hasPension: boolean;
  baseSalary: string | null;
  laborInsuredSalary: string | null;
  healthInsuredSalary: string | null;
  startDate: string | null;
  endDate: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  note: string | null;
  userId: string | null;
  isActive: boolean;
};

/** 新增與編輯共用的員工欄位群。沒有 values 就是新增模式。 */
export function EmployeeFields({
  members,
  values,
  accountsSection,
}: Readonly<{
  members: MemberOption[];
  values?: EmployeeFormValues;
  /** 編輯模式才有的「帳戶」區塊（薪轉 / 報銷帳戶改由 employee_bank_accounts 管理）。 */
  accountsSection?: React.ReactNode;
}>) {
  const t = useTranslations("employees");

  return (
    <>
      <TextField
        name="name"
        label={t("form.nameLabel")}
        required
        placeholder={t("form.namePlaceholder")}
        defaultValue={values?.name}
      />
      {values?.nationalIdMasked ? (
        <Field label={t("form.nationalIdLabel")} htmlFor="nationalIdMasked">
          <Input id="nationalIdMasked" value={values.nationalId ?? ""} disabled readOnly />
        </Field>
      ) : (
        <TextField
          name="nationalId"
          label={t("form.nationalIdLabel")}
          placeholder={t("form.optional")}
          autoComplete="off"
          defaultValue={values?.nationalId ?? ""}
        />
      )}
      <SelectField
        name="employmentType"
        label={t("form.employmentTypeLabel")}
        defaultValue={values?.employmentType ?? "full_time"}
      >
        {employmentTypes.map((v) => (
          <SelectItem key={v} value={v}>
            {t(`type.${v}`)}
          </SelectItem>
        ))}
      </SelectField>
      <TextField
        name="baseSalary"
        label={t("form.baseSalaryLabel")}
        type="number"
        step="0.01"
        placeholder={t("form.optional")}
        defaultValue={values?.baseSalary ?? ""}
      />
      {accountsSection}

      <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
        <div className="text-sm font-medium">{t("form.contactSection")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="workEmail" className="text-xs text-muted-foreground">
              {t("form.workEmailLabel")}
            </Label>
            <Input
              id="workEmail"
              name="workEmail"
              type="email"
              placeholder={t("form.optional")}
              defaultValue={values?.workEmail ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="personalEmail" className="text-xs text-muted-foreground">
              {t("form.personalEmailLabel")}
            </Label>
            <Input
              id="personalEmail"
              name="personalEmail"
              type="email"
              placeholder={t("form.optional")}
              defaultValue={values?.personalEmail ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs text-muted-foreground">
              {t("form.phoneLabel")}
            </Label>
            <Input
              id="phone"
              name="phone"
              placeholder={t("form.optional")}
              defaultValue={values?.phone ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("form.linkedUserLabel")}</Label>
            <Select name="userId" defaultValue={values?.userId ?? "none"}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("form.unlinkedOption")}</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {t("form.memberOption", { name: m.name, email: m.email })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note" className="text-xs text-muted-foreground">
            {t("form.noteLabel")}
          </Label>
          <Input
            id="note"
            name="note"
            placeholder={t("form.optional")}
            defaultValue={values?.note ?? ""}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
        <div className="text-sm font-medium">{t("form.insuranceSection")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <InsField id="laborInsuredSalary" label={t("form.laborInsuredSalaryLabel")} value={values?.laborInsuredSalary ?? null} />
          <InsField id="healthInsuredSalary" label={t("form.healthInsuredSalaryLabel")} value={values?.healthInsuredSalary ?? null} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hasPension"
            defaultChecked={values?.hasPension ?? false}
            className="size-4 accent-primary"
          />
          <span>{t("form.hasPensionLabel")}</span>
        </label>
      </div>
      <Field label={t("form.startDateLabel")}>
        <DatePicker name="startDate" defaultValue={values?.startDate ?? undefined} allowEmpty />
      </Field>
      <Field label={t("form.endDateLabel")}>
        <DatePicker name="endDate" defaultValue={values?.endDate ?? undefined} allowEmpty />
      </Field>
      {/* 在職狀態只有編輯時能改，新增一律是在職。 */}
      {values && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="isActive" defaultChecked={values.isActive} className="size-4 accent-primary" />
          <span>{t("form.isActiveLabel")}</span>
        </label>
      )}
    </>
  );
}

function InsField({ id, label, value }: Readonly<{ id: string; label: string; value: string | null }>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} name={id} type="number" step="0.01" defaultValue={value ?? ""} />
    </div>
  );
}
