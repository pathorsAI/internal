/** 國家模組註冊表。新增國家：寫一個模組檔，加進 MODULES。 */
import type { JurisdictionModule } from "../module";
import { tw } from "./tw";

const MODULES: Record<string, JurisdictionModule> = { TW: tw };

export const JURISDICTION_CODES = Object.keys(MODULES);

export function getJurisdiction(code: string | null | undefined): JurisdictionModule {
  return MODULES[code ?? "TW"] ?? tw;
}
