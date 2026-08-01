"use client";

import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // genericOAuthClient 提供 authClient.oauth2.link()，用來連結 Google 日曆授權
  // （與登入用的 google provider 分開，見 src/lib/auth.ts 的說明）。
  plugins: [organizationClient(), genericOAuthClient()],
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
