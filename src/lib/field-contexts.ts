/**
 * 欄位加密的 context（AES-GCM additionalData，見 src/lib/crypto.ts）。
 *
 * 每個加密欄位都只能從這裡拿 context，不要在呼叫端手拼字串：context 一旦改了，
 * 既有的 v2 密文就再也解不開（GCM 驗證失敗），等於資料遺失。要改格式就得先寫
 * migration 腳本，用舊 context 解、新 context 加。
 *
 * 規則：context = `<table>.<column>` + 只會用到**不可變**的識別字。
 * - organization id：資料從不跨組織搬，綁上它，A 組織的密文貼到 B 組織就解不開。
 * - 只在 insert 當下就已知、之後不會改的欄位才放進來（例如帳戶所屬的 employee_id、
 *   整合的 provider）。insert 才產生的 row id 不用 —— 寫入時還不存在。
 *
 * | 欄位                                   | context                                                              |
 * |----------------------------------------|----------------------------------------------------------------------|
 * | employees.national_id_enc              | `employees.national_id_enc\|org:<orgId>`                             |
 * | employee_bank_accounts.account_number_enc | `employee_bank_accounts.account_number_enc\|org:<orgId>\|employee:<employeeId>` |
 * | org_integrations.credentials_enc       | `org_integrations.credentials_enc\|org:<orgId>\|provider:<provider>` |
 * | org_integrations.token_cache_enc       | `org_integrations.token_cache_enc\|org:<orgId>\|provider:<provider>` |
 *
 * national_id_enc 沒有綁 employee id：新增員工時 row id 還不存在。代價是同組織內
 * 兩位員工的身分證字號密文互換後仍解得開（但仍然綁著欄位與組織）。
 */

function part(name: string, value: string | number | null | undefined): string {
  const v = value == null ? "" : String(value);
  // 空值會讓 context 退化成「所有缺這個值的列都一樣」；`|` 會讓兩組不同的值拼出同一個字串。
  if (!v || v.includes("|")) {
    throw new Error(`欄位加密 context 的 ${name} 無效`);
  }
  return `${name}:${v}`;
}

export function employeeNationalIdContext(orgId: string): string {
  return ["employees.national_id_enc", part("org", orgId)].join("|");
}

export function employeeAccountNumberContext(orgId: string, employeeId: number): string {
  return [
    "employee_bank_accounts.account_number_enc",
    part("org", orgId),
    part("employee", employeeId),
  ].join("|");
}

export function integrationCredentialsContext(orgId: string, provider: string): string {
  return ["org_integrations.credentials_enc", part("org", orgId), part("provider", provider)].join("|");
}

export function integrationTokenCacheContext(orgId: string, provider: string): string {
  return ["org_integrations.token_cache_enc", part("org", orgId), part("provider", provider)].join("|");
}
