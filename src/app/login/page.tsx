"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

// When better-auth's MCP plugin sends an unauthenticated user here, it appends
// the original OAuth query (client_id, redirect_uri, code_challenge, …). After
// sign-in we must return to the authorize endpoint so the flow can issue a code.
function mcpAuthorizeCallback(params: URLSearchParams): string | null {
  if (!params.get("client_id") || params.get("response_type") !== "code") {
    return null;
  }
  return `/api/auth/mcp/authorize?${params.toString()}`;
}

function LoginButton() {
  const params = useSearchParams();
  const redirectTo = mcpAuthorizeCallback(params) || params.get("redirect") || "/";
  const [pending, setPending] = useState(false);

  async function onGoogle() {
    setPending(true);
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: redirectTo,
    });
    if (error) {
      setPending(false);
      toast.error(error.message || "登入失敗");
    }
    // On success the browser is redirected to Google, so no need to reset.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onGoogle}
      disabled={pending}
    >
      <GoogleIcon />
      {pending ? "前往 Google…" : "使用 Google 登入"}
    </Button>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登入</CardTitle>
          <CardDescription>用 Google 帳號進入後台</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <LoginButton />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
