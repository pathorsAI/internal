import type { Locale } from "../config";
import { localize, type Localized } from "./dictionary";
import common from "./common";
import dashboard from "./dashboard";
import transactions from "./transactions";
import billing from "./billing";
import contracts from "./contracts";
import subscriptions from "./subscriptions";
import projects from "./projects";
import parties from "./parties";
import categories from "./categories";
import bankAccounts from "./bankAccounts";
import advances from "./advances";
import accountantNotices from "./accountantNotices";
import reconciliation from "./reconciliation";
import invoices from "./invoices";
import reports from "./reports";
import employees from "./employees";
import payroll from "./payroll";
import members from "./members";
import activity from "./activity";
import settings from "./settings";
import auth from "./auth";
import errors from "./errors";
import lib from "./lib";

/** 全部 namespace 的雙語字典。zh-TW 與 en 都在同一個 key 上。 */
const catalogue = {
  common,
  dashboard,
  transactions,
  billing,
  contracts,
  subscriptions,
  projects,
  parties,
  categories,
  bankAccounts,
  advances,
  accountantNotices,
  reconciliation,
  invoices,
  reports,
  employees,
  payroll,
  members,
  activity,
  settings,
  auth,
  errors,
  lib,
};

export type Messages = Localized<typeof catalogue>;

export const messages: Record<Locale, Messages> = {
  "zh-TW": localize(catalogue, "zh-TW"),
  en: localize(catalogue, "en"),
};
