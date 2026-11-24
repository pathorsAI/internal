/**
 * AI 助理頁的對話區：貼齊頂部 header 下緣與內容區左右下三邊（抵掉 layout 的 p-6），
 * 高度填滿視窗，訊息在自己的區塊裡捲動、輸入框固定在底部。
 * 3.5rem = 頂部 header 的 h-14。這頁沒有 PageHeader（頁名 breadcrumb 已經有了）。
 */
export const CHAT_FRAME = "-mx-6 -mt-6 -mb-6 flex h-[calc(100svh-3.5rem)] min-h-[28rem]";
