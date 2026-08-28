/**
 * PublicLocaleSwitcher 的樣式（.langsw*）。
 *
 * 放在獨立的檔案而不是各自抄一份，是因為它有兩個使用者：landing（LANDING_CSS）與
 * 法律文件（LEGAL_CSS）。兩份 CSS 都定義了同一組 token（--surface / --line / --sh-2 /
 * --r-s / --ink-2 / --brand …），所以這段只吃 token、不自帶顏色，接到哪一邊都成立。
 *
 * docs/index.html 那份沒有這塊 —— GitHub Pages 上的 landing 維持英文，只有站內的公開
 * 頁面要切語言。刻意不搬 shadcn 的 DropdownMenu 過來：那會把 Radix 的樣式脈絡帶進這幾頁
 * 自成一格的 CSS。
 *
 * 注意這顆沒有 .hide-s：窄螢幕藏掉的是導覽連結，切語言不該只有桌機有。
 */
export const LOCALE_SWITCHER_CSS = `
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
