import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.mjs";
import { createFetch, describeProxy } from "../proxy-fetch.mjs";
import { callTelegram } from "../telegram.mjs";

loadLocalEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const proxyUrl = String(process.env.OPENAI_PROXY_URL || "").trim();
const openAiBase = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const openAiKey = String(process.env.OPENAI_API_KEY || "").trim();

console.log(proxyUrl ? `Прокси для ChatGPT: ${describeProxy(proxyUrl)}` : "Прокси для ChatGPT: НЕ ЗАДАН (переменная OPENAI_PROXY_URL пуста)");
console.log(`Ключ OpenAI: ${openAiKey ? "задан" : "не задан"}. Токен бота: ${process.env.TELEGRAM_BOT_TOKEN ? "задан" : "не задан"}.\n`);

async function probe(label, run) {
  try {
    console.log(`${label}\n   ${await run()}`);
  } catch (error) {
    console.log(`${label}\n   ОШИБКА: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}`);
  }
}

const status = async (doFetch, url, headers = {}) => (await doFetch(url, { headers, signal: AbortSignal.timeout(20000) })).status;

await probe("1) Telegram (напрямую)", async () => {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const me = await callTelegram("getMe");
    return `работает, бот @${me.username}`;
  }
  return `доступен (ответ ${await status(fetch, "https://api.telegram.org")}). Токен бота не задан, проверена только доступность`;
});

if (proxyUrl) {
  await probe("2) ChatGPT (OpenAI) через прокси", async () => {
    const viaProxy = await createFetch(proxyUrl);
    const code = await status(viaProxy, `${openAiBase}/models`, openAiKey ? { authorization: `Bearer ${openAiKey}` } : {});
    if (code === 200) return "работает, ключ принят";
    if (code === 401) return openAiKey ? "доступ есть, но ключ НЕ принят — проверьте OPENAI_API_KEY" : "доступ есть (ключ не задан, ответ 401 — это нормально)";
    if (code === 403) return "OpenAI отказал (403): у прокси IP из неподдерживаемой страны — нужен другой прокси";
    return `ответ ${code}`;
  });
}

await probe("3) ChatGPT (OpenAI) напрямую, для справки", async () => {
  const code = await status(fetch, `${openAiBase}/models`);
  return code === 403 ? "заблокирован (403) — для сервера в России это ожидаемо, поэтому нужен прокси" : `доступен напрямую (ответ ${code})`;
});
