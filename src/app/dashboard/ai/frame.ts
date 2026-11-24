/**
 * AI 助理頁的對話區：貼齊 PageHeader 下緣與內容區左右下三邊（抵掉 layout 的 p-6 與 gap-6），
 * 高度填滿視窗，訊息在自己的區塊裡捲動、輸入框固定在底部。
 * 153px = 頂部 header 56px + PageHeader 97px（pt-6 + 標題 28 + 間距 4 + 說明 20 + pb-5 + 邊框 1）。
 */
export const CHAT_FRAME = "-mx-6 -mt-6 -mb-6 flex h-[calc(100svh-153px)] min-h-[28rem]";
