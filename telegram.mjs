import { logger } from "./logger.mjs";

export class TelegramError extends Error {}

export async function callTelegram(method, params = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new TelegramError("TELEGRAM_BOT_TOKEN не задан.");

  const base = String(process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, "");

  let response;
  try {
    response = await fetch(`${base}/bot${token}/${method}`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params)
    });
  } catch (error) {
    logger.error(`[telegram] ${method}: нет связи (${error.cause?.code || error.name})`);
    throw new TelegramError(`Нет связи с Telegram (${error.cause?.code || error.name}).`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    logger.error(`[telegram] ${method}: ${payload.description || `HTTP ${response.status}`}`);
    throw new TelegramError(`Telegram: ${payload.description || `HTTP ${response.status}`}`);
  }
  logger.log(`[telegram] ${method}: ок`);
  return payload.result;
}
