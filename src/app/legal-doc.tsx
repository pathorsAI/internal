import Link from "next/link";
import { getTranslations } from "next-intl/server";

import "./landing-fonts.css";
import { LOCALE_SWITCHER_CSS } from "./public-locale-switcher-css";
import { PublicLocaleSwitcher } from "./public-locale-switcher";

/**
 * 法律文件（/privacy、/terms）共用的排版外殼。
 *
 * 設計沿用 landing page 的那一套：同一組色票 token、同一組字體（--display /
 * --sans / --mono，@font-face 來自 ./landing-fonts.css）、同樣的三層主題切換。
 * 刻意「不」整包 import LANDING_CSS —— 那是 400 行的行銷版面樣式，法律文件只需要
 * token 加一份長文排版，所以這裡只重述 token 的值（與 landing-content.ts 的
 * :root 相同），其餘是本檔自己的內文樣式。landing 的色票若有調整，這裡要一起改。
 * 例外是語言切換器的 .langsw*：那塊 landing 也在用，所以共用一份常數併進來。
 *
 * <style> 跟 landing 一樣寫在 body 裡而不是靠 React 的 hoisting：這樣它在文件
 * 順序上必定晚於 head 的 globals.css，Tailwind preflight 打平的 body/h1/p 樣式
 * 才會被這裡的規則蓋回來。用 dangerouslySetInnerHTML 是因為 React 會跳脫 <style>
 * 的文字子節點（`>` 會變成 &gt;），子選擇器會整條失效；內容是本檔的常數字串，
 * 沒有任何外部輸入會流進來。
 */

/** 兩份文件共用的「最後更新日期」。 */
export const LEGAL_UPDATED_AT = "2026-08-26";

const LEGAL_CSS = `:root{
  --bg:#FBFAFA; --surface:#FFFFFF; --surface-2:#F4F3F1;
  --ink:#141318; --ink-2:#55525E; --ink-3:#8A8794;
  --line:#E6E3DF; --line-soft:#F0EEEB;
  --brand:#2947F0; --brand-2:#5C77FF; --brand-wash:#EAEDFF; --brand-ink:#FFFFFF;
  --amber:#A96500; --amber-wash:#FBEFDA;
  --sh-1:0 1px 2px rgba(20,19,24,.05);
  --sh-2:0 2px 6px rgba(20,19,24,.05), 0 12px 28px -12px rgba(20,19,24,.16);
  --display:"Bricolage Grotesque","Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:"DM Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --cjk:"Noto Sans TC","PingFang TC",sans-serif;
  --pad:clamp(1.25rem,5vw,3rem);
  --r-s:10px; --r-m:16px;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0C0C11; --surface:#16161D; --surface-2:#1D1D26;
    --ink:#F1F0F4; --ink-2:#ACA9B8; --ink-3:#827F92;
    --line:#292933; --line-soft:#1F1F28;
    --brand:#8098FF; --brand-2:#B0C0FF; --brand-wash:#191E3E; --brand-ink:#0C0C11;
    --amber:#E0A44A; --amber-wash:#2B2314;
    --sh-1:0 1px 2px rgba(0,0,0,.4);
    --sh-2:0 2px 6px rgba(0,0,0,.4), 0 14px 30px -14px rgba(0,0,0,.7);
  }
}
:root[data-theme="dark"]{
  --bg:#0C0C11; --surface:#16161D; --surface-2:#1D1D26;
  --ink:#F1F0F4; --ink-2:#ACA9B8; --ink-3:#827F92;
  --line:#292933; --line-soft:#1F1F28;
  --brand:#8098FF; --brand-2:#B0C0FF; --brand-wash:#191E3E; --brand-ink:#0C0C11;
  --amber:#E0A44A; --amber-wash:#2B2314;
  --sh-1:0 1px 2px rgba(0,0,0,.4);
  --sh-2:0 2px 6px rgba(0,0,0,.4), 0 14px 30px -14px rgba(0,0,0,.7);
}

body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:var(--sans),var(--cjk); font-size:1rem; line-height:1.75;
  -webkit-font-smoothing:antialiased;
}
.legal *{box-sizing:border-box}
.legal :focus-visible{outline:2px solid var(--brand); outline-offset:3px; border-radius:6px}
.legal a{color:var(--brand); text-decoration:none}
.legal a:hover{text-decoration:underline; text-underline-offset:3px}

.legal .bar{
  position:sticky; top:0; z-index:20; border-bottom:1px solid transparent;
  background:color-mix(in srgb,var(--bg) 86%,transparent); backdrop-filter:blur(16px) saturate(1.6);
  border-bottom-color:var(--line);
}
.legal .bar .row{
  width:min(820px,100% - var(--pad)*2); margin-inline:auto; height:60px;
  display:flex; align-items:center; gap:1.2rem;
}
.legal .logo{display:flex; align-items:center; gap:.55rem; color:var(--ink); font-weight:600; font-size:.95rem; letter-spacing:-.02em}
.legal .logo:hover{text-decoration:none; color:var(--ink)}
.legal .logo .mark{width:26px; height:26px; border-radius:8px; background:var(--brand); display:grid; place-items:center; flex:none}
.legal .logo .mark svg{width:16px; height:16px; fill:none; stroke:var(--brand-ink); stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round}
.legal .bar .alt{margin-left:auto; font-size:.9rem; font-weight:500; color:var(--ink-2)}
.legal .bar .alt:hover{color:var(--brand)}

.legal .doc{
  width:min(820px,100% - var(--pad)*2); margin-inline:auto;
  padding-block:clamp(2.5rem,6vw,4.5rem) clamp(3rem,6vw,5rem);
  counter-reset:sec;
}
.legal .eyebrow{
  font-family:var(--mono); font-size:.72rem; letter-spacing:.14em; text-transform:uppercase;
  color:var(--brand); margin:0 0 .9rem;
}
.legal h1{
  font-family:var(--display),var(--cjk); font-weight:700; margin:0 0 .8rem;
  font-size:clamp(2rem,4.6vw,2.9rem); line-height:1.08; letter-spacing:-.035em;
}
.legal .lede{font-size:1.06rem; color:var(--ink-2); margin:0 0 1.4rem; text-wrap:pretty}
.legal .updated{
  font-family:var(--mono); font-size:.8rem; color:var(--ink-3);
  padding-bottom:1.6rem; border-bottom:1px solid var(--line); margin:0;
}

.legal .notice{
  display:flex; gap:.85rem; margin:1.8rem 0 0;
  padding:1rem 1.15rem; border-radius:var(--r-m);
  background:var(--amber-wash); border:1px solid color-mix(in srgb,var(--amber) 32%,transparent);
  font-size:.94rem; line-height:1.6; color:var(--ink);
}
.legal .notice svg{width:19px; height:19px; flex:none; margin-top:.25rem; fill:none; stroke:var(--amber); stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.legal .notice strong{font-weight:600}
.legal .notice p{margin:0}

.legal .intro{margin-top:2.2rem; color:var(--ink-2)}
.legal .intro p{margin:0 0 1em}
.legal .intro strong{color:var(--ink); font-weight:600}

.legal section{counter-increment:sec; margin-top:3rem}
.legal h2{
  font-family:var(--display),var(--cjk); font-weight:600; margin:0 0 .9rem;
  font-size:1.32rem; line-height:1.3; letter-spacing:-.02em;
}
.legal section h2::before{
  content:counter(sec,decimal-leading-zero);
  font-family:var(--mono); font-size:.74em; color:var(--brand); margin-right:.7rem;
}
.legal h3{
  font-family:var(--sans),var(--cjk); font-weight:600; margin:1.6rem 0 .6rem;
  font-size:1rem; letter-spacing:-.01em; color:var(--ink);
}
.legal p{margin:0 0 1em; color:var(--ink-2)}
.legal strong{color:var(--ink); font-weight:600}
.legal ul,.legal ol{margin:0 0 1em; padding-left:1.35rem; color:var(--ink-2)}
.legal li{margin-bottom:.45rem}
.legal li::marker{color:var(--ink-3)}
.legal code{
  font-family:var(--mono); font-size:.86em; padding:.12em .38em; border-radius:6px;
  background:var(--surface-2); color:var(--ink); border:1px solid var(--line-soft);
}

.legal .panel{
  background:var(--surface); border:1px solid var(--line); border-radius:var(--r-m);
  box-shadow:var(--sh-1); padding:1.15rem 1.3rem; margin:1.2rem 0;
}
.legal .panel > :last-child{margin-bottom:0}
.legal .panel h3{margin-top:0}

.legal .scroller{overflow-x:auto; margin:1.2rem 0; border:1px solid var(--line); border-radius:var(--r-m)}
.legal table{border-collapse:collapse; width:100%; min-width:560px; font-size:.93rem}
.legal th,.legal td{text-align:left; padding:.7rem .95rem; border-bottom:1px solid var(--line-soft); vertical-align:top}
.legal thead th{background:var(--surface-2); color:var(--ink); font-weight:600; white-space:nowrap}
.legal tbody td{color:var(--ink-2)}
.legal tbody tr:last-child td{border-bottom:none}

.legal .foot{
  margin-top:3.5rem; padding-top:1.6rem; border-top:1px solid var(--line);
  display:flex; flex-wrap:wrap; gap:.6rem 1.8rem; align-items:center;
  font-size:.88rem; color:var(--ink-3);
}
.legal .foot a{color:var(--ink-2)}
.legal .foot a:hover{color:var(--brand)}
.legal .foot .sp{margin-left:auto}

@media (prefers-reduced-motion:reduce){
  .legal *{transition-duration:.001ms !important}
}
` + LOCALE_SWITCHER_CSS;

/** 兩份文件互指用的路由。 */
const OTHER_DOC = {
  privacy: { doc: "terms", href: "/terms" },
  terms: { doc: "privacy", href: "/privacy" },
} as const;

type LegalDocProps = Readonly<{
  /** 哪一份文件。標題、導言與另一份文件的連結都由它從 legal 字典取出。 */
  doc: "privacy" | "terms";
  children: React.ReactNode;
}>;

export async function LegalDoc({ doc, children }: LegalDocProps) {
  const t = await getTranslations("legal");
  const other = OTHER_DOC[doc];
  const otherLabel = t(`${other.doc}.title`);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LEGAL_CSS }} />
      <div className="legal">
        <header className="bar">
          <div className="row">
            <Link className="logo" href="/">
              <span className="mark">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="4,17 10,11 14,15 20,6" />
                </svg>
              </span>Internal
            </Link>
            <Link className="alt" href={other.href}>
              {otherLabel}
            </Link>
            <PublicLocaleSwitcher />
          </div>
        </header>

        <main className="doc">
          <p className="eyebrow">{t(`${doc}.eyebrow`)}</p>
          <h1>{t(`${doc}.title`)}</h1>
          <p className="lede">{t(`${doc}.lede`)}</p>
          <p className="updated">{t("chrome.updated", { date: LEGAL_UPDATED_AT })}</p>

          <div className="notice">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <p>
              {t.rich("chrome.draftNotice", {
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>

          {children}

          <div className="foot">
            <span>{t("chrome.company")}</span>
            <Link href="/">{t("chrome.home")}</Link>
            <Link href={other.href}>{otherLabel}</Link>
            <span className="sp">
              <a href="mailto:contact@pathors.com">contact@pathors.com</a>
            </span>
          </div>
        </main>
      </div>
    </>
  );
}
