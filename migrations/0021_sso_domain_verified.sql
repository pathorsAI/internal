-- 0021: sso_provider.domain_verified（@better-auth/sso 的 domainVerification）。
--
-- 為什麼需要：OIDC callback 判斷「這個 provider 可不可以信任」的唯一條件是
-- provider.domainVerified === true 且登入者 email 的網域與 provider.domain 相符
-- （@better-auth/sso dist/index.mjs 的 isTrustedProvider）。不信任的 provider
-- 不能把 SSO 登入 link 到既有的同 email user —— 已經用 Google 登入過的員工改走
-- SSO 會直接被 ?error=UNKNOWN 踢回首頁（2026-08-28 上線當天發生）。
--
-- 我們不用 plugin 的 DNS TXT 驗證流程：HTTP 註冊端點整條封死（見 0020 的註解），
-- 註冊一律走 scripts/register-sso-provider.ts，該腳本從本 migration 起直接寫
-- domain_verified = true —— 管理者用腳本註冊即視為已驗證。
--
-- Forward-only, additive. Run AFTER 0020_sso_provider.sql.

ALTER TABLE sso_provider
  ADD COLUMN domain_verified boolean NOT NULL DEFAULT false;

-- 既有的 provider 都是腳本註冊的（HTTP 路徑從未開放），一併視為已驗證。
UPDATE sso_provider SET domain_verified = true;
