/** FormData 的欄位值一律當字串讀；檔案欄位或不存在都回空字串。 */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
