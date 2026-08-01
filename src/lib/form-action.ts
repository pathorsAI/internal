"use client";

import { startTransition, type FormEvent } from "react";

/**
 * 送出表單但**不要**讓 React 清空欄位。
 *
 * React 19 的 `<form action={fn}>` 在 action 結束後會自動重置未受控欄位。成功時
 * 沒差（dialog 會關掉），失敗時卻是災難：伺服器回「請選擇客戶」，使用者剛打的
 * 項目名稱、金額、日期全部被清光，等於叫他整張重打一次。
 *
 * 這裡改成自己接 `onSubmit`，把 FormData 交給 `useActionState` 回傳的 dispatch。
 * 因為 action 不是掛在 `<form action>` 上，React 就不會重置，欄位原封不動。
 *
 * 保留的行為：
 * - 瀏覽器的 HTML5 必填驗證照舊 —— submit 事件本來就只在驗證通過後才觸發。
 * - 仍在 transition 內執行，所以 `useActionState` 的 pending 狀態正常運作。
 *
 * 失去的行為：無 JS 時的原生表單送出。這些畫面本來就依賴 JS（Dialog、toast、
 * 關閉行為都是），實務上沒有損失。
 */
export function submitAction(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}
