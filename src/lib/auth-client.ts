"use client";

import { createAuthClient } from "better-auth/react";
import {
  genericOAuthClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  // genericOAuthClient 提供 authClient.oauth2.link()，用來連結 Google 日曆授權
  // （與登入用的 google provider 分開，見 src/lib/auth.ts 的說明）。
  // ssoClient 提供 authClient.signIn.sso()，登入頁的 home realm discovery 用。
  // magicLinkClient 提供 authClient.signIn.magicLink()，公開註冊（/signup）用。
  plugins: [organizationClient(), genericOAuthClient(), ssoClient(), magicLinkClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  useActiveOrganization,
  useListOrganizations,
  useActiveMember,
} = authClient;
