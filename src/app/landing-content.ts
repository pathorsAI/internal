// 這頁的 markup / CSS / JS 是從 docs/index.html「原樣搬過來」的，不是手轉 JSX。
//
// 為什麼不轉 JSX：那份 landing 有 899 行，手工把 class→className、補 self-closing、
// 跳脫 {} 的出錯率遠高於它帶來的好處，而且之後 docs/index.html 一改，兩邊就會分岔。
// 內容全是靜態文案與插圖，沒有任何使用者輸入會流進來；文案本身走字典（見下面第 5 點），
// 代入時一律 HTML escape，所以用 dangerouslySetInnerHTML 渲染沒有 XSS 風險。
//
// docs/index.html 仍然是 GitHub Pages 在用的原件，請把它當唯一真實來源：
// 那邊改了，就重跑一次搬移（見下方三個常數的差異）並同步資產：圖片在 public/landing/images/，
// 字體的 @font-face（原 docs/fonts.css）在 src/app/landing-fonts.css，由 page.tsx import。
//
// 與原檔的差異有六處，都是為了讓它變成站內路由、並且能切語言：
//   1. src="images/…"                        → src="/landing/images/…"
//   2. https://internal.pathors.com/login    → /login（兩處：結尾、頁尾）
//   3. CTA 層級重排：主行動一律是登入／進入系統（見下方 AUTH_* 佔位符，由
//      page.tsx 依登入狀態換成對應的按鈕），GitHub 降為次要連結。
//   4. 頁尾多兩個連結：/privacy 與 /terms（站內的法律文件，見 src/app/legal-doc.tsx）
//   5. 人看得到的文字全部換成 `{{key}}` 佔位符，字串在 src/i18n/messages/landing.ts，
//      由 src/app/landing-template.ts 代入並逐一 escape。docs/index.html 那份維持英文，
//      所以要同步的是「結構」而不是「文案」：那邊改了句子，這邊改字典。
//   6. <header class="nav"> 整塊搬到 src/app/landing-nav.tsx（JSX），因為它要放兩個真的
//      React 元件：語言切換器與依登入狀態變化的按鈕。class 與 id="nav" 都原樣保留。
//      wordmark 順帶從 Pathors Internal 縮成 Internal（頁尾同步）。

/** docs/index.html <style> 的內容，一字未改。 */
export const LANDING_CSS = `:root{
  --bg:#FBFAFA; --surface:#FFFFFF; --surface-2:#F4F3F1; --surface-3:#EDECE9;
  --ink:#141318; --ink-2:#55525E; --ink-3:#8A8794;
  --line:#E6E3DF; --line-soft:#F0EEEB;
  --brand:#2947F0; --brand-2:#5C77FF; --brand-wash:#EAEDFF; --brand-ink:#FFFFFF;
  --amber:#A96500; --amber-wash:#FBEFDA;
  --rose:#C0264D; --rose-wash:#FCE7EC;
  --deep:#0F0F16; --deep-2:#1A1A24; --deep-ink:#E9E8EE; --deep-line:#2A2A36;
  --sh-1:0 1px 2px rgba(20,19,24,.05);
  --sh-2:0 2px 6px rgba(20,19,24,.05), 0 12px 28px -12px rgba(20,19,24,.16);
  --sh-3:0 4px 12px rgba(20,19,24,.06), 0 32px 64px -24px rgba(20,19,24,.28);
  --display:"Bricolage Grotesque","Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:"DM Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --cjk:"Noto Sans TC","PingFang TC",sans-serif;
  --pad:clamp(1.25rem,5vw,3rem);
  --r-s:10px; --r-m:16px; --r-l:22px;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0C0C11; --surface:#16161D; --surface-2:#1D1D26; --surface-3:#24242F;
    --ink:#F1F0F4; --ink-2:#ACA9B8; --ink-3:#827F92;
    --line:#292933; --line-soft:#1F1F28;
    --brand:#8098FF; --brand-2:#B0C0FF; --brand-wash:#191E3E; --brand-ink:#0C0C11;
    --amber:#E0A44A; --amber-wash:#2B2314;
    --rose:#F5798F; --rose-wash:#2D1620;
    --deep:#08080C; --deep-2:#14141C; --deep-ink:#E9E8EE; --deep-line:#23232E;
    --sh-1:0 1px 2px rgba(0,0,0,.4);
    --sh-2:0 2px 6px rgba(0,0,0,.4), 0 14px 30px -14px rgba(0,0,0,.7);
    --sh-3:0 4px 14px rgba(0,0,0,.5), 0 36px 70px -28px rgba(0,0,0,.9);
  }
}
:root[data-theme="dark"]{
  --bg:#0C0C11; --surface:#16161D; --surface-2:#1D1D26; --surface-3:#24242F;
  --ink:#F1F0F4; --ink-2:#ACA9B8; --ink-3:#827F92;
  --line:#292933; --line-soft:#1F1F28;
  --brand:#8098FF; --brand-2:#B0C0FF; --brand-wash:#191E3E; --brand-ink:#0C0C11;
  --amber:#E0A44A; --amber-wash:#2B2314;
  --rose:#F5798F; --rose-wash:#2D1620;
  --deep:#08080C; --deep-2:#14141C; --deep-ink:#E9E8EE; --deep-line:#23232E;
  --sh-1:0 1px 2px rgba(0,0,0,.4);
  --sh-2:0 2px 6px rgba(0,0,0,.4), 0 14px 30px -14px rgba(0,0,0,.7);
  --sh-3:0 4px 14px rgba(0,0,0,.5), 0 36px 70px -28px rgba(0,0,0,.9);
}

*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:var(--sans); font-size:1.0625rem; line-height:1.6;
  -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
::selection{background:var(--brand-wash); color:var(--ink)}
:focus-visible{outline:2px solid var(--brand); outline-offset:3px; border-radius:6px}
img{max-width:100%; display:block}
a{color:inherit}

.wrap{width:min(1180px,100% - var(--pad)*2); margin-inline:auto}
.tight{width:min(880px,100% - var(--pad)*2); margin-inline:auto}

h1,h2,h3{font-family:var(--display); text-wrap:balance; margin:0; font-weight:600}
h1{font-size:clamp(2rem,7.4vw,5.1rem); line-height:1.02; letter-spacing:-.04em; font-weight:700}
h2{font-size:clamp(2rem,4.2vw,3.15rem); line-height:1.05; letter-spacing:-.033em}
h3{font-size:1.22rem; line-height:1.25; letter-spacing:-.02em}
p{margin:0 0 1em}
.lede{font-size:clamp(1.1rem,1.75vw,1.32rem); line-height:1.5; color:var(--ink-2); text-wrap:pretty}
.sub{color:var(--ink-2)}
.num{font-family:var(--mono); font-variant-numeric:tabular-nums; letter-spacing:-.02em}

section{padding-block:clamp(4rem,8vw,7rem); position:relative}
.sec-head{max-width:44ch; margin-bottom:clamp(2rem,4vw,3rem)}
.sec-head h2{margin-bottom:.7rem}
.sec-head .lede{margin:0}
.center{margin-inline:auto; text-align:center}

/* pill badge — replaces the mono eyebrow-and-rule */
.badge{
  display:inline-flex; align-items:center; gap:.5rem; margin-bottom:1.1rem;
  padding:.36rem .8rem .36rem .55rem; border-radius:999px;
  background:var(--brand-wash); color:var(--brand);
  font-size:.78rem; font-weight:600; letter-spacing:-.005em; line-height:1.4;
}
.badge .dot{width:6px; height:6px; border-radius:50%; background:currentColor; flex:none}
.badge.plain{background:var(--surface-2); color:var(--ink-2); border:1px solid var(--line)}

.btn{
  display:inline-flex; align-items:center; gap:.5rem; text-decoration:none; cursor:pointer;
  font-family:var(--sans); font-size:.97rem; font-weight:600; letter-spacing:-.01em;
  padding:.78rem 1.35rem; border-radius:999px; border:1px solid transparent;
  transition:transform .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.btn.primary{background:var(--brand); color:var(--brand-ink); box-shadow:var(--sh-2)}
.btn.primary:hover{background:var(--brand-2); transform:translateY(-2px)}
.btn.ghost{background:var(--surface); color:var(--ink); border-color:var(--line); box-shadow:var(--sh-1)}
.btn.ghost:hover{border-color:var(--brand); color:var(--brand); transform:translateY(-2px)}
.btn.sm{padding:.5rem 1rem; font-size:.88rem}
.btn svg{width:17px; height:17px; fill:currentColor; flex:none}
.btn.sm svg{width:15px; height:15px}
.btns{display:flex; flex-wrap:wrap; gap:.7rem}

.card{
  background:var(--surface); border:1px solid var(--line); border-radius:var(--r-m);
  box-shadow:var(--sh-2);
}
/* ---------- header ---------- */
.nav{position:sticky; top:0; z-index:60; background:color-mix(in srgb,var(--bg) 82%,transparent); backdrop-filter:blur(16px) saturate(1.6); border-bottom:1px solid transparent; transition:border-color .25s}
.nav.stuck{border-bottom-color:var(--line)}
.nav .wrap{display:flex; align-items:center; gap:1.2rem; height:66px}
.logo{display:flex; align-items:center; gap:.55rem; text-decoration:none; font-weight:600; font-size:.98rem; letter-spacing:-.02em}
.logo .mark{width:28px; height:28px; border-radius:8px; background:var(--brand); display:grid; place-items:center; flex:none}
.logo .mark svg{width:17px; height:17px; fill:none; stroke:var(--brand-ink); stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round}
.nav nav{margin-left:auto; display:flex; align-items:center; gap:1.6rem}
.nav nav a{text-decoration:none; font-size:.93rem; font-weight:500; color:var(--ink-2); transition:color .16s}
.nav nav a:hover{color:var(--ink)}
@media(max-width:760px){ .nav nav a.hide-s{display:none} .nav nav{gap:.9rem} }

/* ---------- hero ---------- */
.hero{padding-top:clamp(3rem,7vw,5.5rem); padding-bottom:0; text-align:center; overflow:hidden}
.glow{
  position:absolute; top:-14%; left:50%; transform:translateX(-50%);
  width:min(1150px,140%); height:640px; pointer-events:none; z-index:0;
  background:radial-gradient(46% 50% at 50% 50%, color-mix(in srgb,var(--brand) 20%,transparent) 0%, transparent 72%);
}
.hero > .tight, .hero > .stage{position:relative; z-index:1}
.hero h1{margin-bottom:1.25rem}
@media(max-width:600px){ .hero h1 br{display:none} }
.hero .lede{margin:0 auto 2rem; max-width:44ch}
.hero .btns{justify-content:center}
.hero .trust{margin:1.6rem 0 0; font-size:.85rem; color:var(--ink-3); display:flex; gap:.5rem 1.1rem; justify-content:center; flex-wrap:wrap}
.hero .trust b{font-weight:500; color:var(--ink-2)}

/* the demo card overlaps into the next band — a landing move, not a document one */
.stage{margin-top:clamp(2.5rem,5vw,3.75rem); padding-bottom:clamp(3rem,6vw,5rem)}
.band{background:var(--surface-2); border-block:1px solid var(--line)}
.pull{margin-top:calc(clamp(3rem,6vw,5rem) * -1 - clamp(2rem,5vw,4rem))}

/* ---------- segmented control ---------- */
.seg{display:inline-flex; padding:4px; gap:4px; border-radius:999px; background:var(--surface-2); border:1px solid var(--line)}
.seg button{
  font-family:var(--sans); font-size:.85rem; font-weight:600; letter-spacing:-.01em;
  padding:.44rem 1rem; border:0; border-radius:999px; background:transparent; color:var(--ink-3); cursor:pointer;
  transition:.18s ease;
}
.seg button[aria-selected="true"]{background:var(--surface); color:var(--ink); box-shadow:var(--sh-1)}
.seg button:hover{color:var(--ink)}

/* ---------- split demo ---------- */
.demo{max-width:940px; margin-inline:auto; border-radius:var(--r-l); padding:clamp(1rem,2.5vw,1.6rem); text-align:left; box-shadow:var(--sh-3)}
.demo-top{display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin-bottom:1.1rem}
.demo-top h3{font-size:1.02rem; color:var(--ink-2); font-weight:500; font-family:var(--sans); letter-spacing:-.01em}
.split{position:relative}
.src{
  border:1px solid var(--brand); border-radius:var(--r-s); background:var(--brand-wash);
  padding:.72rem .9rem; display:flex; align-items:center; gap:.8rem; flex-wrap:wrap;
  max-height:100px; overflow:hidden;
  transition:opacity .45s ease, transform .45s ease, max-height .45s ease, margin .45s ease, padding .45s ease, border-color .45s;
}
.src .tag{font-size:.72rem; font-weight:600; color:var(--brand); letter-spacing:-.005em; flex:none}
.src .desc{font-size:.92rem; font-weight:500; flex:1; min-width:150px}
.src .amt{font-family:var(--mono); font-size:.95rem; font-weight:500; font-variant-numeric:tabular-nums; flex:none}
.split[data-mode="two"] .src{opacity:0; max-height:0; padding-block:0; margin-bottom:-1rem; transform:translateY(-10px); border-color:transparent}
/* Drawn in CSS, not SVG: a stretched viewBox scales stroke width non-uniformly,
   which turned the connector's legs into thick blue bars. */
.stem{height:30px; position:relative; transition:opacity .4s ease}
.stem::before{
  content:""; position:absolute; left:50%; top:0; width:1.5px; height:13px;
  background:var(--brand); transform:translateX(-50%);
}
.stem::after{
  content:""; position:absolute; left:25%; right:25%; top:12.5px; height:15px;
  border:1.5px solid var(--brand); border-bottom:0; border-radius:7px 7px 0 0;
}
.split[data-mode="two"] .stem{opacity:0}
@media(max-width:560px){ .stem{display:none} }
.books{display:grid; grid-template-columns:1fr 1fr; gap:.85rem; transition:gap .5s cubic-bezier(.4,0,.2,1)}
.split[data-mode="two"] .books{gap:2.8rem}
@media(max-width:560px){ .books{grid-template-columns:1fr} .split[data-mode="two"] .books{gap:1.5rem} }
.book{border:1px solid var(--line); border-radius:var(--r-s); background:var(--surface); overflow:hidden; transition:border-color .4s, border-style .4s}
.split[data-mode="two"] .book{border-style:dashed; border-color:var(--ink-3)}
.book-hd{display:flex; align-items:center; gap:.5rem; padding:.6rem .85rem; border-bottom:1px solid var(--line); background:var(--surface-2)}
.book-hd .nm{font-size:.86rem; font-weight:600; letter-spacing:-.01em; white-space:nowrap}
.book-hd .file{margin-left:auto; opacity:0; transition:opacity .4s; color:var(--rose); font-family:var(--mono); font-size:.72rem; white-space:nowrap}
.book-hd .live{margin-left:auto; transition:opacity .4s; font-size:.72rem; color:var(--ink-3); display:inline-flex; align-items:center; gap:.35rem}
.book-hd .live::before{content:""; width:6px; height:6px; border-radius:50%; background:var(--brand)}
.split[data-mode="two"] .book-hd .file{opacity:1}
.split[data-mode="two"] .book-hd .live{opacity:0}
.row{display:flex; align-items:center; gap:.6rem; padding:.5rem .85rem; border-bottom:1px solid var(--line-soft); font-size:.85rem; transition:.45s ease}
.row:last-child{border-bottom:0}
.row .d{font-family:var(--mono); font-size:.74rem; color:var(--ink-3); flex:none}
.row .t{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-2)}
.row .a{font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:.82rem; font-weight:500; flex:none}
.row.key{background:var(--brand-wash)}
.split[data-mode="two"] .row.key{background:var(--rose-wash)}
.row .a .alt{display:none}
.split[data-mode="two"] .row.edited .a .now{display:none}
.split[data-mode="two"] .row.edited .a .alt{display:inline; color:var(--rose)}
.split[data-mode="two"] .row.orphan{opacity:.3; text-decoration:line-through}
.verdict{margin-top:1.1rem; min-height:30px; font-size:.92rem; color:var(--ink-2)}
.verdict .v{display:none; align-items:center; gap:.7rem; flex-wrap:wrap}
.split[data-mode="one"] .verdict .v-one{display:flex}
.split[data-mode="two"] .verdict .v-two{display:flex}

/* ---------- chips ---------- */
.chip{
  display:inline-flex; align-items:center; gap:.4rem; white-space:nowrap; flex:none;
  font-size:.78rem; font-weight:600; letter-spacing:-.005em;
  padding:.26rem .68rem; border-radius:999px; line-height:1.45;
}
.chip .dot{width:6px; height:6px; border-radius:50%; background:currentColor}
.chip.ok{background:var(--brand-wash); color:var(--brand)}
.chip.bad{background:var(--rose-wash); color:var(--rose)}
.chip.warn{background:var(--amber-wash); color:var(--amber)}
.chip.flat{background:var(--surface-2); color:var(--ink-2); border:1px solid var(--line)}
/* ---------- problem cards ---------- */
.trio{display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(265px,1fr))}
.pcard{padding:1.5rem 1.4rem; border-radius:var(--r-m); background:var(--surface); border:1px solid var(--line); box-shadow:var(--sh-1); transition:transform .2s ease, box-shadow .2s ease}
.pcard:hover{transform:translateY(-3px); box-shadow:var(--sh-2)}
.pcard h3{margin-bottom:.55rem; font-size:1.12rem}
.pcard p{margin:0; font-size:.94rem; color:var(--ink-2)}

/* ---------- alternating feature rows ---------- */
.feat{display:grid; gap:clamp(2rem,4vw,3.5rem); align-items:center; grid-template-columns:minmax(0,1fr)}
@media(min-width:940px){
  .feat{grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr)}
  .feat.flip{grid-template-columns:minmax(0,1.14fr) minmax(0,.86fr)}
  .feat.flip > .fx{order:2}
}
.fx .sec-head{margin-bottom:1.4rem}
.pts{list-style:none; padding:0; margin:0; display:grid; gap:.9rem}
.pts li{position:relative; padding-left:1.45rem; font-size:.96rem; color:var(--ink-2); line-height:1.5}
.pts li::before{
  content:""; position:absolute; left:0; top:.72em; width:11px; height:1.5px; background:var(--brand);
}
.pts li b{color:var(--ink); font-weight:600}

/* ---------- screenshots ---------- */
.shot{border-radius:var(--r-m); overflow:hidden; border:1px solid var(--line); box-shadow:var(--sh-3); background:var(--surface); line-height:0}
.shot img{width:100%}
.shot-label{display:flex; align-items:center; gap:.5rem; margin-bottom:.8rem; font-size:.82rem; color:var(--ink-3); font-family:var(--mono)}
.shot-label::before{content:""; width:7px; height:7px; border-radius:2px; background:var(--brand)}

/* ---------- lifecycle ---------- */
.flow{padding:clamp(1.4rem,3vw,2rem); border-radius:var(--r-m)}
.track{position:relative; display:grid; grid-template-columns:repeat(5,1fr); gap:.5rem}
.track::before{content:""; position:absolute; left:10%; right:10%; top:17px; height:2px; border-radius:2px; background:var(--line)}
.track .fill{position:absolute; left:10%; top:17px; height:2px; border-radius:2px; background:var(--brand); width:0; transition:width 2.3s cubic-bezier(.4,0,.2,1)}
.play .track .fill{width:80%}
.node{text-align:center; position:relative}
.node .pip{
  width:36px; height:36px; margin:0 auto .7rem; border-radius:50%; border:2px solid var(--line);
  background:var(--surface); display:grid; place-items:center; position:relative; z-index:2;
  font-family:var(--mono); font-size:.8rem; color:var(--ink-3); transition:.45s ease;
}
.node .lb{font-size:.87rem; font-weight:600; letter-spacing:-.01em; line-height:1.25}
.play .node.on .pip{border-color:var(--brand); background:var(--brand); color:var(--brand-ink); transform:scale(1.05)}
.node:nth-child(3) .pip{transition-delay:.5s} .node:nth-child(4) .pip{transition-delay:1s}
.node:nth-child(5) .pip{transition-delay:1.5s} .node:nth-child(6) .pip{transition-delay:2s}
.alert{
  margin-top:1.5rem; display:flex; align-items:center; gap:.8rem; flex-wrap:wrap;
  padding:.85rem 1rem; border-radius:var(--r-s); background:var(--rose-wash);
  font-size:.92rem; color:var(--ink-2); opacity:0; transform:translateY(8px); transition:.5s 1.8s ease;
}
.play .alert{opacity:1; transform:none}
@media(max-width:640px){ .track{grid-template-columns:1fr 1fr 1fr; row-gap:1.3rem} .track::before,.track .fill{display:none} }

/* ---------- merge ---------- */
.merge{display:grid; gap:1rem; padding:1.3rem; border-radius:var(--r-m); grid-template-columns:minmax(0,1fr)}
@media(min-width:820px){ .merge{grid-template-columns:minmax(0,1fr) 60px minmax(0,1fr); align-items:center} }
.stackcol{display:grid; gap:.9rem}
.mini{border:1px solid var(--line); border-radius:var(--r-s); background:var(--surface-2); overflow:hidden}
.mini .mh{padding:.5rem .8rem; border-bottom:1px solid var(--line); font-size:.8rem; font-weight:600; letter-spacing:-.01em; color:var(--ink-2); white-space:nowrap}
.mini .mh span{font-weight:400; color:var(--ink-3)}
.ticks{display:flex; gap:6px; padding:1.5rem .8rem .8rem; align-items:flex-end; min-height:64px}
.tick{flex:1; border-radius:4px; background:var(--line); position:relative; transform:scaleY(.2); transform-origin:bottom; transition:transform .55s cubic-bezier(.34,1.4,.64,1)}
.play .tick{transform:scaleY(1)}
.tick.i{background:var(--brand); height:36px} .tick.s{background:var(--amber); height:22px}
.tick small{position:absolute; top:-17px; left:50%; transform:translateX(-50%); font-family:var(--mono); font-size:.63rem; color:var(--ink-3)}
.arrows{display:grid; place-items:center}
.arrows svg{width:50px; height:86px; overflow:visible}
.arrows path{fill:none; stroke:var(--line); stroke-width:1.6; stroke-linecap:round; stroke-dasharray:100; stroke-dashoffset:100; transition:stroke-dashoffset 1s ease .3s, stroke .6s}
.play .arrows path{stroke-dashoffset:0; stroke:var(--brand)}
@media(max-width:819px){ .arrows{transform:rotate(90deg); height:56px} }
.out{border:1px solid var(--brand); border-radius:var(--r-s); background:var(--surface); overflow:hidden}
.out .mh{background:var(--brand-wash); color:var(--brand); border-color:transparent; white-space:nowrap}
.out .row{opacity:0; transform:translateX(-12px); transition:.45s ease}
.play .out .row{opacity:1; transform:none}
.play .out .row:nth-child(2){transition-delay:.35s} .play .out .row:nth-child(3){transition-delay:.5s}
.play .out .row:nth-child(4){transition-delay:.65s} .play .out .row:nth-child(5){transition-delay:.8s}
.play .out .row:nth-child(6){transition-delay:.95s}

/* ---------- calendar ---------- */
.cal{padding:1.3rem; border-radius:var(--r-m); display:grid; gap:1.3rem; grid-template-columns:minmax(0,1fr)}
@media(min-width:700px){ .cal{grid-template-columns:minmax(0,.9fr) minmax(0,1fr)} }
.cal-grid{border:1px solid var(--line); border-radius:var(--r-s); overflow:hidden; background:var(--surface)}
.cal-hd{padding:.55rem .85rem; background:var(--surface-2); border-bottom:1px solid var(--line); font-size:.82rem; font-weight:600; letter-spacing:-.01em}
.days{display:grid; grid-template-columns:repeat(7,1fr)}
.day{aspect-ratio:1/.86; border-right:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft); padding:.3rem .35rem; font-family:var(--mono); font-size:.66rem; color:var(--ink-3); position:relative}
.day:nth-child(7n){border-right:0}
.day.out{opacity:.3}
.day .ev{position:absolute; left:4px; right:4px; bottom:4px; height:7px; border-radius:3px; opacity:0; transform:translateY(-16px) scale(.5); transition:.6s cubic-bezier(.34,1.35,.64,1)}
.play .day .ev{opacity:1; transform:none}
.ev.b{background:var(--brand)} .ev.c{background:var(--amber)} .ev.i{background:var(--rose)}
.play .day:nth-child(12) .ev{transition-delay:.25s}
.play .day:nth-child(19) .ev{transition-delay:.55s}
.play .day:nth-child(26) .ev{transition-delay:.85s}
.legend{display:grid; gap:.85rem; align-content:center}
.lg{display:flex; align-items:flex-start; gap:.7rem; font-size:.93rem; color:var(--ink-2)}
.lg .sw{width:11px; height:11px; border-radius:3px; flex:none; margin-top:.42em}
.lg b{color:var(--ink); font-weight:600}
/* ---------- assistant panel ---------- */
.term{background:var(--deep); border:1px solid var(--deep-line); border-radius:var(--r-m); overflow:hidden; box-shadow:var(--sh-3)}
.term .th{padding:.75rem 1rem; background:var(--deep-2); border-bottom:1px solid var(--deep-line); font-size:.83rem; font-weight:600; color:var(--deep-ink); opacity:.65; display:flex; align-items:center; gap:.5rem}
.term .th::before{content:""; width:7px; height:7px; border-radius:50%; background:#5C77FF}
.term .tb{padding:1.15rem 1.1rem; font-family:var(--mono); font-size:.82rem; line-height:1.85; color:var(--deep-ink)}
.term .l{opacity:0; transform:translateY(5px); transition:.4s ease}
.term.play .l{opacity:1; transform:none}
.term.play .l:nth-child(2){transition-delay:.4s} .term.play .l:nth-child(3){transition-delay:.9s}
.term.play .l:nth-child(4){transition-delay:1.2s} .term.play .l:nth-child(5){transition-delay:1.4s}
.term.play .l:nth-child(6){transition-delay:1.6s} .term.play .l:nth-child(7){transition-delay:1.9s}
.term .q{color:#B0C0FF} .term .k{color:#E0A44A} .term .r{color:#F5798F} .term .c{opacity:.42}

/* ---------- language demo ---------- */
.lang{padding:clamp(1.2rem,2.5vw,1.7rem); border-radius:var(--r-m)}
.lang-bar{display:flex; align-items:center; gap:.8rem; margin-bottom:1.2rem; flex-wrap:wrap}
.lang-bar .hint{margin-left:auto; font-size:.83rem; color:var(--ink-3)}
.kcards{display:grid; grid-template-columns:repeat(auto-fit,minmax(168px,1fr)); gap:.8rem}
.kcard{border:1px solid var(--line); border-radius:var(--r-s); background:var(--surface-2); padding:.9rem 1rem}
.kcard .kl{font-size:.86rem; color:var(--ink-2); font-weight:500; min-height:1.45em}
.kcard .kv{font-family:var(--mono); font-size:1.75rem; font-weight:500; letter-spacing:-.03em; margin:.2rem 0 .05rem; font-variant-numeric:tabular-nums}
.kcard .ks{font-family:var(--mono); font-size:.75rem; color:var(--ink-2)}
.kcard .kh{font-size:.76rem; color:var(--ink-3); margin-top:.45rem; line-height:1.4; min-height:2.6em}
.kcard[data-k="overdue"] .kv{color:var(--rose)}
[data-i18n]{transition:opacity .16s ease}
.swapping [data-i18n]{opacity:0}
[data-i18n]:lang(zh-Hant){font-family:var(--cjk)}

/* ---------- tiles ---------- */
.tiles{display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}
@media(min-width:940px){ .tiles{grid-template-columns:repeat(3,1fr)} }
.tile{padding:1.4rem 1.35rem; border-radius:var(--r-m); background:var(--surface); border:1px solid var(--line); box-shadow:var(--sh-1); transition:transform .2s ease, box-shadow .2s ease, border-color .2s}
.tile:hover{transform:translateY(-3px); box-shadow:var(--sh-2); border-color:color-mix(in srgb,var(--brand) 35%,var(--line))}
.tile h3{font-size:1.05rem; margin-bottom:.5rem}
.tile p{margin:0; font-size:.92rem; color:var(--ink-2); line-height:1.5}

/* ---------- setup ---------- */
.setup{display:grid; gap:clamp(1.5rem,3vw,2.5rem); grid-template-columns:minmax(0,1fr)}
@media(min-width:900px){ .setup{grid-template-columns:minmax(0,1fr) minmax(0,1fr)} }
pre{
  margin:0; background:var(--deep); color:var(--deep-ink); border:1px solid var(--deep-line);
  border-radius:var(--r-s); padding:1rem 1.1rem; overflow-x:auto;
  font-family:var(--mono); font-size:.84rem; line-height:1.8;
}
pre .c{opacity:.42} pre .k{color:#B0C0FF}
.steps{display:grid; gap:1rem}
.step .sl{font-size:.82rem; font-weight:600; color:var(--ink-3); margin-bottom:.45rem; display:flex; gap:.55rem; align-items:center}
.step .sl b{color:var(--brand); font-family:var(--mono); font-weight:500}
dl.spec{margin:0; border:1px solid var(--line); border-radius:var(--r-m); overflow:hidden; background:var(--surface)}
dl.spec .r{display:grid; grid-template-columns:130px 1fr; gap:1rem; padding:.85rem 1.1rem; border-bottom:1px solid var(--line-soft); font-size:.92rem}
dl.spec .r:last-child{border-bottom:0}
dl.spec dt{margin:0; font-size:.82rem; font-weight:600; color:var(--ink-3)}
dl.spec dd{margin:0; color:var(--ink-2)}
@media(max-width:560px){ dl.spec .r{grid-template-columns:1fr; gap:.15rem} }

/* ---------- closing ---------- */
.finale{
  border-radius:var(--r-l); padding:clamp(2.5rem,6vw,4.5rem) clamp(1.5rem,4vw,3rem); text-align:center;
  background:var(--brand); color:var(--brand-ink); position:relative; overflow:hidden;
}
.finale h2{color:var(--brand-ink); margin-bottom:.9rem; max-width:17ch; margin-inline:auto}
.finale p{color:var(--brand-ink); opacity:.82; max-width:44ch; margin:0 auto 2rem; font-size:1.08rem}
.finale .btn.primary{background:var(--brand-ink); color:var(--brand)}
.finale .btn.primary:hover{background:var(--brand-ink); opacity:.9}
.finale .btn.ghost{background:transparent; color:var(--brand-ink); border-color:color-mix(in srgb,var(--brand-ink) 40%,transparent); box-shadow:none}
.finale .btn.ghost:hover{border-color:var(--brand-ink); color:var(--brand-ink)}
.finale .btns{justify-content:center}
.finale .already{margin:1.6rem 0 0; font-size:.95rem; opacity:.75}
.finale .already a{color:var(--brand-ink); text-decoration:underline; text-underline-offset:3px}

footer{border-top:1px solid var(--line); padding-block:2.5rem; margin-top:clamp(4rem,8vw,7rem)}
footer .wrap{display:flex; gap:.8rem 2rem; flex-wrap:wrap; align-items:center; font-size:.88rem; color:var(--ink-3)}
footer a{color:var(--ink-2); text-decoration:none}
footer a:hover{color:var(--brand)}
footer .ghlink{display:inline-flex; align-items:center; gap:.45rem}
footer .ghlink svg{width:15px; height:15px; fill:currentColor}
footer .sp{margin-left:auto}

/* ---------- reveal ---------- */
.rv{opacity:0; transform:translateY(18px); transition:opacity .75s cubic-bezier(.4,0,.2,1), transform .75s cubic-bezier(.4,0,.2,1)}
.rv.in{opacity:1; transform:none}
.rv[data-d="1"]{transition-delay:.1s} .rv[data-d="2"]{transition-delay:.2s} .rv[data-d="3"]{transition-delay:.3s}

@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important}
  .rv{opacity:1; transform:none}
}

/* ---------- language switch (站內限定，docs/index.html 沒有這塊) ----------
   GitHub Pages 那份維持英文，只有 app 裡的 landing 要切語言。刻意不搬 shadcn 的
   DropdownMenu 過來：那會把 Radix 的樣式脈絡帶進這頁自成一格的 CSS。dropdown 手刻，
   卡片語彙（--surface / --line / --sh-2 / --r-s）沿用上面的 .card。
   注意這顆沒有 .hide-s：窄螢幕藏掉的是導覽連結，切語言不該只有桌機有。 */
.langsw{position:relative; flex:none; display:flex; align-items:center}
.langsw-trigger{
  display:grid; place-items:center; width:34px; height:34px; padding:0;
  border:1px solid transparent; border-radius:999px; background:transparent;
  color:var(--ink-2); cursor:pointer;
  transition:color .16s ease, background .16s ease, border-color .16s ease;
}
.langsw-trigger svg{width:18px; height:18px}
.langsw-trigger:hover,
.langsw-trigger[aria-expanded="true"]{color:var(--ink); background:var(--surface-2); border-color:var(--line)}
.langsw[data-pending]{opacity:.55; pointer-events:none}
.langsw-menu{
  position:absolute; top:calc(100% + .55rem); right:0; z-index:70; min-width:11rem;
  display:flex; flex-direction:column; gap:2px; padding:.3rem;
  background:var(--surface); border:1px solid var(--line); border-radius:var(--r-s);
  box-shadow:var(--sh-2);
}
.langsw-item{
  display:flex; align-items:center; gap:.5rem; width:100%; text-align:left;
  font-family:var(--sans); font-size:.9rem; font-weight:500; letter-spacing:-.01em; line-height:1.4;
  padding:.42rem .55rem; border:0; border-radius:calc(var(--r-s) - 4px);
  background:transparent; color:var(--ink-2); cursor:pointer;
  transition:color .14s ease, background .14s ease;
}
.langsw-item:hover{color:var(--ink); background:var(--surface-2)}
.langsw-item[aria-checked="true"]{color:var(--ink)}
.langsw-item svg{width:15px; height:15px; flex:none; opacity:0}
.langsw-item[aria-checked="true"] svg{opacity:1; color:var(--brand)}
`;

/**
 * docs/index.html <body> 的內容（不含 <header> 與 <script>），改動見檔頭。
 * `{{…}}` 是文案佔位符，由 page.tsx 透過 renderLandingTemplate() 代入。
 */
export const LANDING_HTML = `<main id="top">

<section class="hero">
  <div class="glow" aria-hidden="true"></div>
  <div class="tight">
    <span class="badge"><span class="dot"></span>{{hero.badge}}</span>
    <h1>{{hero.titleA}} <br>{{hero.titleB}}</h1>
    <p class="lede">{{hero.lede}}</p>
    <div class="btns">
      <!--AUTH_CTA_HERO-->
      <a class="btn ghost" href="#books">{{hero.secondary}}</a>
    </div>
    <p class="trust"><b>{{hero.trustSelfHost}}</b><span>·</span><b>{{hero.trustFree}}</b></p>
  </div>

  <div class="wrap stage">
    <div class="demo card rv">
      <div class="demo-top">
        <h3>{{demo.heading}}</h3>
        <div class="seg" role="tablist" aria-label="{{demo.tablistLabel}}">
          <button role="tab" aria-selected="true" aria-controls="splitdemo" data-mode="one">{{demo.tabOne}}</button>
          <button role="tab" aria-selected="false" aria-controls="splitdemo" data-mode="two">{{demo.tabTwo}}</button>
        </div>
      </div>
      <div class="split" id="splitdemo" data-mode="one">
        <div class="src">
          <span class="tag">{{demo.srcTag}}</span>
          <span class="desc">{{demo.srcDesc}}</span>
          <span class="chip ok"><span class="dot"></span>{{demo.srcChip}}</span>
          <span class="amt">NT$260,000</span>
        </div>
        <div class="stem" aria-hidden="true"></div>
        <div class="books">
          <div class="book">
            <div class="book-hd"><span class="nm">{{demo.internalBook}}</span><span class="live">{{demo.inSync}}</span><span class="file">internal.xlsx</span></div>
            <div class="row"><span class="d">08/14</span><span class="t">Morningside Creative</span><span class="a">60,000</span></div>
            <div class="row key edited"><span class="d">08/11</span><span class="t">Verdant Biosciences</span><span class="a"><span class="now">260,000</span><span class="alt">280,000</span></span></div>
            <div class="row orphan"><span class="d">08/05</span><span class="t">{{demo.rowPayroll}}</span><span class="a">−201,000</span></div>
          </div>
          <div class="book">
            <div class="book-hd"><span class="nm">{{demo.externalBook}}</span><span class="live">{{demo.inSync}}</span><span class="file">external.xlsx</span></div>
            <div class="row"><span class="d">08/14</span><span class="t">Morningside Creative</span><span class="a">60,000</span></div>
            <div class="row"><span class="d">08/12</span><span class="t">{{demo.rowSaas}}</span><span class="a">−9,800</span></div>
            <div class="row key"><span class="d">08/11</span><span class="t">Verdant Biosciences</span><span class="a">260,000</span></div>
          </div>
        </div>
        <div class="verdict">
          <span class="v v-one"><span class="chip ok"><span class="dot"></span>{{demo.verdictOkChip}}</span> <span>{{demo.verdictOkText}}</span></span>
          <span class="v v-two"><span class="chip bad"><span class="dot"></span>{{demo.verdictBadChip}}</span> <span>{{demo.verdictBadText}}</span></span>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band pull" style="padding-top:calc(clamp(4rem,8vw,7rem) + clamp(2rem,5vw,4rem))">
  <div class="wrap">
    <div class="sec-head center rv">
      <h2>{{problems.heading}}</h2>
      <p class="lede">{{problems.lede}}</p>
    </div>
    <div class="trio">
      <div class="pcard rv">
        <h3>{{problems.driftTitle}}</h3>
        <p>{{problems.driftBody}}</p>
      </div>
      <div class="pcard rv" data-d="1">
        <h3>{{problems.unbilledTitle}}</h3>
        <p>{{problems.unbilledBody}}</p>
      </div>
      <div class="pcard rv" data-d="2">
        <h3>{{problems.unknownTitle}}</h3>
        <p>{{problems.unknownBody}}</p>
      </div>
    </div>
  </div>
</section>
<section id="books">
  <div class="wrap feat">
    <div class="fx rv">
      <div class="sec-head">
        <span class="badge"><span class="dot"></span>{{books.badge}}</span>
        <h2>{{books.heading}}</h2>
        <p class="lede">{{books.lede}}</p>
      </div>
      <ul class="pts">
        <li><b>{{books.payrollLead}}</b> {{books.payrollBody}}</li>
        <li><b>{{books.incomeLead}}</b> {{books.incomeBody}}</li>
        <li><b>{{books.currencyLead}}</b> {{books.currencyBody}}</li>
      </ul>
    </div>
    <div class="rv" data-d="1">
      <p class="shot-label">{{books.shotLabel}}</p>
      <div class="shot"><img src="/landing/images/transactions.png" alt="{{books.shotAlt}}"></div>
    </div>
  </div>
</section>

<section class="band" id="billing">
  <div class="wrap">
    <div class="sec-head center rv">
      <span class="badge"><span class="dot"></span>{{billing.badge}}</span>
      <h2>{{billing.heading}}</h2>
      <p class="lede">{{billing.lede}}</p>
    </div>

    <div class="rv" style="margin-bottom:clamp(1.5rem,3vw,2.2rem)">
      <p class="shot-label">{{billing.shotLabel}}</p>
      <div class="shot"><img src="/landing/images/billing.png" alt="{{billing.shotAlt}}"></div>
    </div>

    <div class="feat" style="margin-top:clamp(2.5rem,5vw,4rem)">
      <div class="fx rv">
        <div class="sec-head">
          <h2 style="font-size:clamp(1.5rem,2.6vw,2rem)">{{flow.heading}}</h2>
          <p class="lede" style="font-size:1.05rem">{{flow.lede}}</p>
        </div>
      </div>
      <div class="flow card rv anim" data-d="1">
        <div class="track">
          <span class="fill"></span>
          <div class="node on"><div class="pip">1</div><div class="lb">{{flow.upcoming}}</div></div>
          <div class="node on"><div class="pip">2</div><div class="lb">{{flow.due}}</div></div>
          <div class="node on"><div class="pip">3</div><div class="lb">{{flow.billed}}</div></div>
          <div class="node on"><div class="pip">4</div><div class="lb">{{flow.partial}}</div></div>
          <div class="node on"><div class="pip">5</div><div class="lb">{{flow.paid}}</div></div>
        </div>
        <div class="alert">
          <span class="chip bad"><span class="dot"></span>{{flow.overdueChip}}</span>
          <span>{{flow.overdueBody}}</span>
        </div>
      </div>
    </div>

    <div class="feat flip" style="margin-top:clamp(2.5rem,5vw,4rem)">
      <div class="fx rv">
        <div class="sec-head">
          <h2 style="font-size:clamp(1.5rem,2.6vw,2rem)">{{merge.heading}}</h2>
          <p class="lede" style="font-size:1.05rem">{{merge.lede}}</p>
        </div>
      </div>
      <div class="merge card rv anim" data-d="1">
        <div class="stackcol">
          <div class="mini">
            <div class="mh">{{merge.contract}} <span>{{merge.contractNote}}</span></div>
            <div class="ticks">
              <div class="tick i" style="height:32px"><small>30%</small></div>
              <div class="tick i" style="height:42px"><small>40%</small></div>
              <div class="tick i" style="height:32px"><small>30%</small></div>
            </div>
          </div>
          <div class="mini">
            <div class="mh">{{merge.subscription}} <span>{{merge.subscriptionNote}}</span></div>
            <div class="ticks">
              <div class="tick s"></div><div class="tick s"></div><div class="tick s"></div>
              <div class="tick s"></div><div class="tick s"></div><div class="tick s"></div>
            </div>
          </div>
        </div>
        <div class="arrows" aria-hidden="true">
          <svg viewBox="0 0 50 86"><path d="M0 20 C 14 20 18 43 27 43 M0 66 C 14 66 18 43 27 43 M27 43 H46 M40 37 l6 6 -6 6"/></svg>
        </div>
        <div class="out">
          <div class="mh">{{merge.outHeading}}</div>
          <div class="row"><span class="d">05/31</span><span class="t">{{merge.rowKickoff}}</span><span class="a">800,000</span></div>
          <div class="row"><span class="d">06/01</span><span class="t">{{merge.rowOps}}</span><span class="a">40,000</span></div>
          <div class="row"><span class="d">07/01</span><span class="t">{{merge.rowPos}}</span><span class="a">25,000</span></div>
          <div class="row"><span class="d">07/31</span><span class="t">{{merge.rowInterim}}</span><span class="a">360,000</span></div>
          <div class="row"><span class="d">08/01</span><span class="t">{{merge.rowOps}}</span><span class="a">40,000</span></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="reminders">
  <div class="wrap feat flip">
    <div class="fx rv" data-d="1">
      <div class="sec-head">
        <span class="badge"><span class="dot"></span>{{reminders.badge}}</span>
        <h2>{{reminders.heading}}</h2>
        <p class="lede">{{reminders.lede}}</p>
      </div>
      <p class="sub" style="font-size:.95rem; margin:0">{{reminders.sub}}</p>
    </div>
    <div class="cal card rv anim">
      <div class="cal-grid">
        <div class="cal-hd">{{reminders.month}}</div>
        <div class="days">
          <div class="day out">27</div><div class="day out">28</div><div class="day out">29</div><div class="day out">30</div><div class="day out">31</div><div class="day">1</div><div class="day">2</div>
          <div class="day">3</div><div class="day">4</div><div class="day">5</div><div class="day">6</div><div class="day">7<span class="ev b"></span></div><div class="day">8</div><div class="day">9</div>
          <div class="day">10</div><div class="day">11</div><div class="day">12</div><div class="day">13</div><div class="day">14<span class="ev c"></span></div><div class="day">15</div><div class="day">16</div>
          <div class="day">17</div><div class="day">18</div><div class="day">19</div><div class="day">20</div><div class="day">21<span class="ev i"></span></div><div class="day">22</div><div class="day">23</div>
          <div class="day">24</div><div class="day">25</div><div class="day">26</div><div class="day">27</div><div class="day">28</div><div class="day">29</div><div class="day">30</div>
        </div>
      </div>
      <div class="legend">
        <div class="lg"><span class="sw" style="background:var(--brand)"></span><span><b>{{reminders.billLead}}</b> {{reminders.billBody}}</span></div>
        <div class="lg"><span class="sw" style="background:var(--amber)"></span><span><b>{{reminders.chaseLead}}</b> {{reminders.chaseBody}}</span></div>
        <div class="lg"><span class="sw" style="background:var(--rose)"></span><span><b>{{reminders.invoiceLead}}</b> {{reminders.invoiceBody}}</span></div>
      </div>
    </div>
  </div>
</section>

<section class="band" id="reports">
  <div class="wrap">
    <div class="sec-head center rv">
      <span class="badge"><span class="dot"></span>{{reports.badge}}</span>
      <h2>{{reports.heading}}</h2>
      <p class="lede">{{reports.lede}}</p>
    </div>
    <div class="feat" style="grid-template-columns:minmax(0,1fr)">
      <div style="display:grid; gap:clamp(1.5rem,3vw,2.4rem); grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="rv">
          <p class="shot-label">{{reports.overviewLabel}}</p>
          <div class="shot"><img src="/landing/images/dashboard.png" alt="{{reports.overviewAlt}}"></div>
          <ul class="pts" style="margin-top:1.2rem">
            <li><b>{{reports.balancesLead}}</b> {{reports.balancesBody}}</li>
            <li><b>{{reports.cashflowLead}}</b> {{reports.cashflowBody}}</li>
          </ul>
        </div>
        <div class="rv" data-d="1">
          <p class="shot-label">{{reports.reportsLabel}}</p>
          <div class="shot"><img src="/landing/images/reports.png" alt="{{reports.reportsAlt}}"></div>
          <ul class="pts" style="margin-top:1.2rem">
            <li><b>{{reports.ageingLead}}</b> {{reports.ageingBody}}</li>
            <li><b>{{reports.coverageLead}}</b> {{reports.coverageBody}}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>
<section id="assistant">
  <div class="wrap feat">
    <div class="fx rv">
      <div class="sec-head">
        <span class="badge"><span class="dot"></span>{{assistant.badge}}</span>
        <h2>{{assistant.heading}}</h2>
        <p class="lede">{{assistant.lede}}</p>
      </div>
      <p class="sub" style="font-size:.95rem; margin:0">{{assistant.sub}}</p>
    </div>
    <div class="term rv anim" data-d="1">
      <div class="th">{{assistant.termTitle}}</div>
      <div class="tb">
        <div class="l"><span class="c">{{assistant.termYou}}</span> <span class="q">{{assistant.termQuestion}}</span></div>
        <div class="l"><span class="c">{{assistant.termThinking}}</span></div>
        <div class="l">&nbsp;</div>
        <div class="l">Highbridge Construction <span class="c">·</span> {{assistant.termItemPhase}} <span class="c">·</span> <span class="r">NT$800,000</span> <span class="c">{{assistant.termLate82}}</span></div>
        <div class="l">Northwind Labs <span class="c">·</span> {{assistant.termItemPipeline}} <span class="c">·</span> <span class="r">US$6,500</span> <span class="c">{{assistant.termLate31}}</span></div>
        <div class="l">&nbsp;</div>
        <div class="l"><span class="c">{{assistant.termClose}}</span></div>
      </div>
    </div>
  </div>
</section>

<section class="band" id="language">
  <div class="wrap">
    <div class="sec-head rv">
      <h2 style="font-size:clamp(1.5rem,2.6vw,2rem)">{{language.heading}}</h2>
      <p class="lede" style="font-size:1.05rem">{{language.lede}}</p>
    </div>

    <div class="lang card rv">
      <div class="lang-bar">
        <div class="seg" role="tablist" aria-label="{{language.tablistLabel}}">
          <button role="tab" aria-selected="true" aria-controls="i18ncards" data-loc="en">English</button>
          <button role="tab" aria-selected="false" aria-controls="i18ncards" data-loc="zh-TW" lang="zh-Hant-TW">繁體中文</button>
        </div>
        <span class="hint">{{language.hint}}</span>
      </div>
      <div class="kcards" id="i18ncards">
        <div class="kcard" data-k="due">
          <div class="kl" data-i18n data-en="Due to bill" data-zh="該請款">Due to bill</div>
          <div class="kv">3</div><div class="ks">NT$545,000</div>
          <div class="kh" data-i18n data-en="Due date has passed, not yet billed" data-zh="已到應請款日、還沒請款">Due date has passed, not yet billed</div>
        </div>
        <div class="kcard" data-k="await">
          <div class="kl" data-i18n data-en="Awaiting payment" data-zh="待收款">Awaiting payment</div>
          <div class="kv">2</div><div class="ks">NT$420,000</div>
          <div class="kh" data-i18n data-en="Billed, not yet fully collected" data-zh="已請款、還沒收齊">Billed, not yet fully collected</div>
        </div>
        <div class="kcard" data-k="overdue">
          <div class="kl" data-i18n data-en="Overdue" data-zh="逾期未收">Overdue</div>
          <div class="kv">2</div><div class="ks">NT$800,000 · US$6,500</div>
          <div class="kh" data-i18n data-en="Past the payment deadline, still not collected" data-zh="超過付款期限仍未收齊">Past the payment deadline, still not collected</div>
        </div>
        <div class="kcard" data-k="inv">
          <div class="kl" data-i18n data-en="Invoice pending" data-zh="待開發票">Invoice pending</div>
          <div class="kv">8</div><div class="ks">NT$636,000</div>
          <div class="kh" data-i18n data-en="Billed or paid, invoice not issued yet" data-zh="已請款或已收款、發票還沒開">Billed or paid, invoice not issued yet</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="more">
  <div class="wrap">
    <div class="sec-head center rv">
      <h2>{{more.heading}}</h2>
      <p class="lede">{{more.lede}}</p>
    </div>
    <div class="tiles">
      <div class="tile rv">
        <h3>{{more.partiesTitle}}</h3>
        <p>{{more.partiesBody}}</p>
      </div>
      <div class="tile rv" data-d="1">
        <h3>{{more.advancesTitle}}</h3>
        <p>{{more.advancesBody}}</p>
      </div>
      <div class="tile rv" data-d="2">
        <h3>{{more.reconciliationTitle}}</h3>
        <p>{{more.reconciliationBody}}</p>
      </div>
      <div class="tile rv">
        <h3>{{more.payrollTitle}}</h3>
        <p>{{more.payrollBody}}</p>
      </div>
      <div class="tile rv" data-d="1">
        <h3>{{more.filesTitle}}</h3>
        <p>{{more.filesBody}}</p>
      </div>
      <div class="tile rv" data-d="2">
        <h3>{{more.orgsTitle}}</h3>
        <p>{{more.orgsBody}}</p>
      </div>
    </div>
  </div>
</section>

<section class="band" id="setup">
  <div class="wrap">
    <div class="sec-head rv">
      <span class="badge plain"><span class="dot"></span>{{setup.badge}}</span>
      <h2>{{setup.heading}}</h2>
      <p class="lede">{{setup.lede}}</p>
    </div>
    <div class="setup">
      <div class="steps rv">
        <div class="step">
          <div class="sl"><b>01</b> {{setup.stepInstall}}</div>
<pre>bun install</pre>
        </div>
        <div class="step">
          <div class="sl"><b>02</b> {{setup.stepConfigure}}</div>
<pre>cp .env.example .env.local
<span class="c"># {{setup.stepConfigureComment}}</span></pre>
        </div>
        <div class="step">
          <div class="sl"><b>03</b> {{setup.stepStart}}</div>
<pre>bun dev   <span class="c"># {{setup.stepStartComment}}</span></pre>
        </div>
        <p class="sub" style="font-size:.9rem; margin:.4rem 0 0">{{setup.note}}</p>
      </div>
      <div class="rv" data-d="1">
        <dl class="spec">
          <div class="r"><dt>{{setup.specBuiltWith}}</dt><dd>Next.js 16, React 19, Tailwind CSS</dd></div>
          <div class="r"><dt>{{setup.specDatabase}}</dt><dd>{{setup.specDatabaseValue}}</dd></div>
          <div class="r"><dt>{{setup.specSignIn}}</dt><dd>{{setup.specSignInValue}}</dd></div>
          <div class="r"><dt>{{setup.specHosting}}</dt><dd>{{setup.specHostingValue}}</dd></div>
          <div class="r"><dt>{{setup.specLicence}}</dt><dd>{{setup.specLicenceValue}}</dd></div>
        </dl>
      </div>
    </div>
  </div>
</section>

<section id="end">
  <div class="wrap">
    <div class="finale rv">
      <h2>{{finale.heading}}</h2>
      <p>{{finale.body}}</p>
      <div class="btns">
        <!--AUTH_CTA_FINALE-->
        <a class="btn ghost" href="https://github.com/pathorsAI/internal">{{finale.github}}</a>
      </div>
      <p class="already">{{finale.selfHost}} <a href="https://github.com/pathorsAI/internal#quick-start">{{finale.setupGuide}}</a>{{finale.stop}}</p>
    </div>
  </div>
</section>

</main>

<footer>
  <div class="wrap">
    <span>Internal</span>
    <span>Apache 2.0</span>
    <span><!--AUTH_LINK_FOOTER--></span>
    <span><a href="/privacy">{{footer.privacy}}</a></span>
    <span><a href="/terms">{{footer.terms}}</a></span>
    <span class="sp"><a class="ghlink" href="https://github.com/pathorsAI/internal"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>github.com/pathorsAI/internal</a></span>
  </div>
</footer>
`;

/**
 * docs/index.html <script> 的內容，一字未改。
 * dangerouslySetInnerHTML 不會執行 <script>，所以這段是靠 next/script 以
 * afterInteractive 注入的（見 page.tsx）。
 */
export const LANDING_SCRIPT = `(function(){
  var reduce = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Reveal on scroll. IntersectionObserver drives it; a rect sweep is the safety
     net, so content can never stay stuck at opacity 0 if the observer is silent. */
  var targets = Array.prototype.slice.call(document.querySelectorAll('.rv, .anim'));
  function show(el){
    el.classList.add('in');
    if (el.classList.contains('anim')) el.classList.add('play');
  }
  function sweep(){
    var h = globalThis.innerHeight || 800;
    targets.forEach(function(el){
      if (!el.classList.contains('in') && el.getBoundingClientRect().top < h * 0.9) show(el);
    });
  }
  if (!('IntersectionObserver' in globalThis) || reduce) {
    targets.forEach(show);
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    targets.forEach(function(el){ io.observe(el); });
    addEventListener('scroll', sweep, { passive: true });
    addEventListener('resize', sweep);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) sweep(); });
    sweep();
  }

  /* Header hairline appears once you leave the hero. */
  var nav = document.getElementById('nav');
  function onScroll(){ nav.classList.toggle('stuck', globalThis.scrollY > 12); }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* One ledger vs two spreadsheets. */
  var demo = document.getElementById('splitdemo');
  var tabs = document.querySelectorAll('.seg [data-mode]');
  var touched = false;
  function setMode(m){
    demo.dataset.mode = m;
    tabs.forEach(function(t){ t.setAttribute('aria-selected', String(t.dataset.mode === m)); });
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ touched = true; setMode(t.dataset.mode); }); });
  if (!reduce) {
    setTimeout(function(){ if (!touched) setMode('two'); }, 3000);
    setTimeout(function(){ if (!touched) setMode('one'); }, 6600);
  }

  /* Language switch. */
  var locBtns = document.querySelectorAll('[data-loc]');
  var cards = document.getElementById('i18ncards');
  function translate(zh){
    cards.querySelectorAll('[data-i18n]').forEach(function(n){
      n.textContent = zh ? n.dataset.zh : n.dataset.en;
      n.setAttribute('lang', zh ? 'zh-Hant-TW' : 'en');
    });
  }
  function selectLocale(btn){
    var zh = btn.dataset.loc === 'zh-TW';
    locBtns.forEach(function(x){ x.setAttribute('aria-selected', String(x === btn)); });
    cards.classList.add('swapping');
    setTimeout(function(){
      translate(zh);
      cards.classList.remove('swapping');
    }, reduce ? 0 : 160);
  }
  locBtns.forEach(function(b){
    b.addEventListener('click', function(){ selectLocale(b); });
  });
})();`;
