import type { Dictionary } from "./dictionary";

const payroll = {
  title: { "zh-TW": "薪資", en: "Payroll" },
  description: { "zh-TW": "到「員工」頁對每位員工發放薪資；這裡是發放紀錄", en: "Pay each employee's salary from the Employees page; this is the payment history" },
  goToEmployees: { "zh-TW": "去員工頁發薪", en: "Go to Employees to pay salary" },
  table: {
    title: { "zh-TW": "發放紀錄", en: "Payment history" },
    columns: {
      period: { "zh-TW": "月份", en: "Period" },
      employee: { "zh-TW": "員工", en: "Employee" },
      taxable: { "zh-TW": "應稅", en: "Taxable" },
      nontaxable: { "zh-TW": "免稅", en: "Tax-free" },
      netPay: { "zh-TW": "實發", en: "Net pay" },
      transaction: { "zh-TW": "交易", en: "Transaction" },
      actions: { "zh-TW": "動作", en: "Actions" },
    },
    empty: { "zh-TW": "尚無發放紀錄", en: "No payment history yet" },
    posted: { "zh-TW": "已入帳", en: "Posted" },
  },
  simpany: {
    title: { "zh-TW": "Simpany 薪資申報", en: "Simpany salary declarations" },
    description: {
      "zh-TW": "從 Simpany 唯讀同步每月薪資申報，對照實際發出的薪資，算出每位員工的欠薪。",
      en: "Read-only sync of monthly salary declarations from Simpany, reconciled against what was actually paid to show each employee's arrears.",
    },
    prevYear: { "zh-TW": "上一年", en: "Previous year" },
    nextYear: { "zh-TW": "下一年", en: "Next year" },
    lastSynced: { "zh-TW": "上次同步 {date}", en: "Last synced {date}" },
    neverSynced: { "zh-TW": "這一年還沒同步過", en: "This year hasn't been synced yet" },
    notConnected: {
      "zh-TW": "Simpany 整合尚未連接或未開啟，請 owner 或 admin 到",
      en: "The Simpany integration isn't connected or switched on. An owner or admin can fix it in",
    },
    settingsLink: { "zh-TW": "設定 › 整合", en: "Settings › Integrations" },
    sync: {
      button: { "zh-TW": "從 Simpany 同步", en: "Sync from Simpany" },
      pending: { "zh-TW": "同步中…", en: "Syncing…" },
      done: {
        "zh-TW": "已同步 {year}：{filed} 個月有申報、{rows} 筆明細",
        en: "Synced {year}: {filed} months declared, {rows} rows",
      },
      unmatched: {
        "zh-TW": "這些姓名在員工名冊找不到（仍會以姓名比對付款對象）：{names}",
        en: "Not found in the employee list (payments are still matched by name): {names}",
      },
    },
    months: {
      title: { "zh-TW": "每月申報狀態", en: "Monthly status" },
      month: { "zh-TW": "{month} 月", en: "M{month}" },
      status: {
        not_synced: { "zh-TW": "未同步", en: "Not synced" },
        missing: { "zh-TW": "未建立", en: "No form" },
        empty: { "zh-TW": "表單空白", en: "Empty form" },
        draft: { "zh-TW": "已填未結算", en: "Not settled" },
        settled: { "zh-TW": "已申報", en: "Filed" },
      },
      filedOf: { "zh-TW": "{filed}/{total} 人", en: "{filed}/{total}" },
      payday: { "zh-TW": "發薪日 {date}", en: "Payday {date}" },
    },
    arrears: {
      title: { "zh-TW": "欠薪對帳", en: "Salary arrears" },
      window: {
        "zh-TW": "對到 {month} 月 · 付款期間 {from} ~ {to}",
        en: "Through month {month} · payments {from} – {to}",
      },
      columns: {
        employee: { "zh-TW": "員工", en: "Employee" },
        declared: { "zh-TW": "應發（申報）", en: "Due (declared)" },
        paid: { "zh-TW": "已發", en: "Paid" },
        arrears: { "zh-TW": "欠", en: "Owed" },
        detail: { "zh-TW": "明細", en: "Detail" },
      },
      owner: { "zh-TW": "負責人", en: "Owner" },
      unlinked: { "zh-TW": "未對應員工", en: "Not linked" },
      estimatedExtra: { "zh-TW": "估計未申報 +{amount}", en: "Est. unfiled +{amount}" },
      notYetDue: { "zh-TW": "未到期 {amount}", en: "Not yet due {amount}" },
      credit: { "zh-TW": "溢付 {amount}", en: "Overpaid {amount}" },
      total: { "zh-TW": "合計", en: "Total" },
      empty: {
        "zh-TW": "還沒有申報資料。按「從 Simpany 同步」把這一年的申報拉進來。",
        en: "No declarations yet. Use “Sync from Simpany” to pull this year in.",
      },
      estimateNote: {
        "zh-TW": "「估」= Simpany 沒申報的月份，以最近一次申報的實發（扣掉非經常性獎金）估計。",
        en: "“Est.” = months not declared in Simpany, estimated from the latest declared net pay (minus one-off bonus).",
      },
    },
    detail: {
      button: { "zh-TW": "明細", en: "Detail" },
      title: { "zh-TW": "{name} 的薪資對帳", en: "Salary reconciliation: {name}" },
      description: {
        "zh-TW": "付款先對到 payslip 的期別，其餘依日期先進先出補最舊的欠款。",
        en: "Payments go to their payslip period first; the rest is applied to the oldest unpaid month first.",
      },
      expected: {
        "zh-TW": "每月預估實發 {amount}（{source}）",
        en: "Expected monthly net {amount} ({source})",
      },
      expectedSource: {
        override: { "zh-TW": "手動指定", en: "override" },
        latest_filed: { "zh-TW": "最近一次申報", en: "latest declaration" },
      },
      monthsTitle: { "zh-TW": "逐月", en: "By month" },
      paymentsTitle: { "zh-TW": "付款紀錄", en: "Payments" },
      columns: {
        month: { "zh-TW": "月份", en: "Month" },
        declared: { "zh-TW": "應發", en: "Due" },
        allocated: { "zh-TW": "已對到", en: "Applied" },
        outstanding: { "zh-TW": "欠", en: "Owed" },
        date: { "zh-TW": "日期", en: "Date" },
        amount: { "zh-TW": "金額", en: "Amount" },
        appliedTo: { "zh-TW": "對到", en: "Applied to" },
      },
      unfiled: { "zh-TW": "未申報", en: "Not declared" },
      estimated: { "zh-TW": "估", en: "Est." },
      notDue: { "zh-TW": "未到期", en: "Not due" },
      noPayments: { "zh-TW": "沒有付款紀錄", en: "No payments recorded" },
      unapplied: { "zh-TW": "未對到 {amount}", en: "Unapplied {amount}" },
      payslip: { "zh-TW": "薪資單", en: "Payslip" },
      monthShort: { "zh-TW": "{month} 月", en: "M{month}" },
      close: { "zh-TW": "關閉", en: "Close" },
    },
    unallocated: {
      title: { "zh-TW": "未指定員工的薪資支出", en: "Salary payments not linked to an employee" },
      description: {
        "zh-TW": "分類是「薪資費用」但沒有綁員工、對象也對不到員工姓名。到交易頁把對象或撥款員工改好，就會算進對帳。",
        en: "Categorised as 薪資費用 but not linked to an employee and the party name doesn't match one. Set the party or employee on the transaction to include it.",
      },
      columns: {
        date: { "zh-TW": "日期", en: "Date" },
        description: { "zh-TW": "說明", en: "Description" },
        party: { "zh-TW": "對象", en: "Party" },
        account: { "zh-TW": "帳戶", en: "Account" },
        amount: { "zh-TW": "金額", en: "Amount" },
      },
    },
  },
  delete: {
    title: { "zh-TW": "撤銷這筆發放？", en: "Reverse this payment?" },
    description: { "zh-TW": "會一併刪除它產生的薪資支出交易。", en: "This also deletes the salary expense transaction it created." },
  },
} satisfies Dictionary;

export default payroll;
