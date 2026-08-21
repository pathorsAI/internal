import { getRequestConfig } from "next-intl/server";
import { getUserLocale } from "./locale";
import { messages } from "./messages";

export default getRequestConfig(async () => {
  const locale = await getUserLocale();
  return { locale, messages: messages[locale] };
});
