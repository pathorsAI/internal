import { NextResponse } from "next/server";

/**
 * 目前部署的版本號（build 時寫入，見 next.config.ts 的 APP_VERSION）。不需要登入：
 * 只回一個 commit SHA 或 build 時間，沒有任何組織資料。不能被快取，不然部署後還是舊值。
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
