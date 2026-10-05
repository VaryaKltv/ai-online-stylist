import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalog } from "./catalog-source.mjs";
import { createFetch } from "./proxy-fetch.mjs";
import { loadLocalEnv } from "./env.mjs";
import { cleanForLog, logger, recentLogs } from "./logger.mjs";
import { describeProxy } from "./proxy-fetch.mjs";
import { AiError, isAiConfigured, runAiStylist, validateDataUrl } from "./ai-stylist.mjs";
import { getRenderJob, isRenderEnabled, startRenderJob } from "./render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv(__dirname);
const port = Number(process.env.PORT || 8012);
const maxRequestBodyBytes = 15 * 1024 * 1024;
const productUrlCache = new Map();
const catalog = createCatalog({ root: __dirname, log: logger });
const clientLogByIp = new Map();
const CLIENT_LOG_PER_HOUR = 30;
const CLIENT_EVENTS = new Set(["submit_ok", "submit_error", "js_error", "render_ok", "render_error"]);

process.on("uncaughtException", (error) => crash("необработанная ошибка", error));
process.on("unhandledRejection", (error) => crash("необработанный отказ промиса", error));
process.on("SIGTERM", () => {
  logger.warn("[server] получен сигнал остановки (SIGTERM), сервер завершает работу");
  process.exit(0);
});

function crash(kind, error) {
  logger.error(`[server] ${kind}: ${error?.stack || error}`);
  setTimeout(() => process.exit(1), 200);
}
const aiRateByIp = new Map();
const aiDaily = { day: "", count: 0 };
const renderRateByIp = new Map();
const renderDaily = { day: "", count: 0 };

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  response.on("finish", () => logRequest(request, response, Date.now() - startedAt));

  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
      sendCorsPreflight(response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(response, 200, { status: "ok", aiConfigured: isAiConfigured(), renderConfigured: isRenderEnabled(), looksSource: catalog.mode });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/catalog") {
      const { products, source, mode, generatedAt, fallbackReason } = await catalog.getCatalog();
      logger.log(`[catalog] отдан каталог: источник=${source}, товаров=${products.length}${fallbackReason ? `, причина отката: ${fallbackReason}` : ""}`);
      sendJson(response, 200, { status: "ok", mode, source, generatedAt, fallbackReason, products });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/logs") {
      handleLogs(requestUrl, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/client-log") {
      await handleClientLog(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/stylist") {
      await handleStylist(request, response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/render") {
      await handleRenderStart(request, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith("/api/render/")) {
      handleRenderStatus(requestUrl.pathname.slice("/api/render/".length), response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/validate-products") {
      await handleValidateProducts(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    logger.error(`[http] ошибка обработки ${request.method} ${request.url.split("?")[0]}: ${error.stack || error.message}`);
    sendJson(response, 500, { status: "error", message: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  logger.log(`[server] StyleMate AI запущен: порт ${port}, Node ${process.versions.node}`);
  logger.log(`[config] источник луков: ${catalog.mode}; ChatGPT: ${isAiConfigured() ? `ключ задан, модель ${process.env.OPENAI_MODEL || "gpt-4o"}` : "ключ НЕ задан"}`);
  logger.log(`[config] прокси для ChatGPT: ${describeConfigured(process.env.OPENAI_PROXY_URL)}; прокси для магазинов: ${describeConfigured(process.env.PARSE_PROXY_URL)}`);
  logger.log(`[config] токен бота: ${process.env.TELEGRAM_BOT_TOKEN ? "задан" : "не задан"}; просмотр логов по адресу: ${process.env.LOGS_TOKEN ? "включён" : "выключен (LOGS_TOKEN не задан)"}`);
  logger.log(`[config] генерация картинок образа: ${isRenderEnabled() ? `включена, модель ${process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5"}, качество ${process.env.OPENAI_IMAGE_QUALITY || "medium"}` : "выключена"}`);
  catalog.start();
});

function describeConfigured(proxyUrl) {
  return proxyUrl ? describeProxy(proxyUrl) : "нет";
}

function deviceClass(request) {
  const agent = String(request.headers["user-agent"] || "");
  if (/Telegram/i.test(agent)) return "telegram";
  if (/iPhone|iPad|iOS/i.test(agent)) return "ios";
  if (/Android/i.test(agent)) return "android";
  return "компьютер";
}

function logRequest(request, response, durationMs) {
  const pathname = request.url.split("?")[0];
  const failed = response.statusCode >= 400;
  const isApi = pathname.startsWith("/api/");
  const quiet = pathname === "/api/client-log" || !failed && (
    pathname === "/api/status" ||
    pathname === "/api/catalog" ||
    pathname === "/api/stylist" ||
    pathname === "/api/render" ||
    pathname.startsWith("/api/render/") ||
    (!isApi && pathname !== "/" && !pathname.endsWith(".html"))
  );
  if (quiet) return;

  const device = pathname === "/" ? `, устройство: ${deviceClass(request)}` : "";
  const line = `[http] ${request.method} ${pathname} → ${response.statusCode} за ${durationMs} мс${device}`;
  if (failed) logger.warn(line);
  else logger.log(line);
}

function handleLogs(requestUrl, response) {
  const expected = String(process.env.LOGS_TOKEN || "");
  const given = String(requestUrl.searchParams.get("token") || "");
  const valid = expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!valid) {
    sendText(response, 404, "Not found");
    return;
  }

  const lines = Number(requestUrl.searchParams.get("lines")) || 300;
  response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`${recentLogs(lines).join("\n")}\n`);
}

async function handleClientLog(request, response) {
  const ip = clientIp(request);
  const now = Date.now();
  const recent = (clientLogByIp.get(ip) || []).filter((time) => now - time < 3600 * 1000);
  if (recent.length >= CLIENT_LOG_PER_HOUR) {
    response.writeHead(429);
    response.end();
    return;
  }
  recent.push(now);
  clientLogByIp.set(ip, recent);

  try {
    const payload = await readJson(request, 4096);
    if (CLIENT_EVENTS.has(payload.event)) {
      const details = Object.entries(payload.details || {})
        .slice(0, 8)
        .map(([key, value]) => `${cleanForLog(key, 30)}=${cleanForLog(value, 160)}`)
        .join(", ");
      logger[payload.event === "submit_ok" || payload.event === "render_ok" ? "log" : "warn"](`[client] ${payload.event}: ${details}; устройство: ${deviceClass(request)}`);
    }
  } catch {
    // мусор от клиента не должен ронять сервер и засорять логи
  }
  response.writeHead(204);
  response.end();
}

async function handleStylist(request, response) {
  if (!isAiConfigured()) {
    sendJson(response, 200, { status: "disabled", message: "ChatGPT не настроен на сервере." });
    return;
  }

  const limitMessage = checkAiLimits(clientIp(request));
  if (limitMessage) {
    logger.warn(`[ai] запрос отклонён лимитом: ${limitMessage}`);
    sendJson(response, 429, { status: "error", message: limitMessage });
    return;
  }

  try {
    const payload = await readJson(request);
    const itemPhoto = validateDataUrl(payload.itemPhotoDataUrl, "Фото вещи");
    const personPhoto = payload.personPhotoDataUrl ? validateDataUrl(payload.personPhotoDataUrl, "Фото человека") : null;
    const form = {
      occasion: String(payload.form?.occasion || ""),
      budget: String(payload.form?.budget || "middle"),
      itemCategory: String(payload.form?.itemCategory || "верх"),
      age: String(payload.form?.age || "").slice(0, 3)
    };

    const { products } = await catalog.getCatalog();
    logger.log(`[ai] запрос принят: фото человека ${personPhoto ? "есть" : "нет"}, повод «${form.occasion}», бюджет ${form.budget}`);
    const startedAt = Date.now();
    const result = await runAiStylist({ itemPhoto, personPhoto, form, products });
    logger.log(`[ai] готово за ${((Date.now() - startedAt) / 1000).toFixed(1)} с, сумма ${result.look.total} ₽`);
    sendJson(response, 200, { status: "ready", ...result });
  } catch (error) {
    const clientProblem = error instanceof AiError && error.httpStatus < 500;
    logger[clientProblem ? "warn" : "error"](`[ai] ${clientProblem ? "запрос отклонён" : "ошибка"}: ${error instanceof AiError ? error.message : error.stack || error.message}`);
    sendJson(response, error instanceof AiError ? error.httpStatus : 500, {
      status: "error",
      message: error instanceof AiError ? error.message : "Не удалось обработать запрос к ChatGPT."
    });
  }
}

function checkAiLimits(ip) {
  return checkLimits(ip, aiRateByIp, aiDaily, Number(process.env.AI_RATE_PER_HOUR || 8), Number(process.env.AI_DAILY_LIMIT || 300), "подборок");
}

function checkLimits(ip, rateByIp, daily, perHour, perDay, noun) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  if (daily.day !== today) {
    daily.day = today;
    daily.count = 0;
  }
  if (daily.count >= perDay) return `На сегодня лимит ${noun} исчерпан. Попробуйте завтра.`;

  const recent = (rateByIp.get(ip) || []).filter((time) => now - time < 3600 * 1000);
  if (recent.length >= perHour) return "Слишком много запросов. Попробуйте через час.";

  recent.push(now);
  rateByIp.set(ip, recent);
  daily.count += 1;
  return "";
}

async function handleRenderStart(request, response) {
  if (!isRenderEnabled()) {
    sendJson(response, 200, { status: "disabled", message: "Генерация изображений не включена на сервере." });
    return;
  }

  const limitMessage = checkLimits(clientIp(request), renderRateByIp, renderDaily, Number(process.env.AI_RENDER_PER_HOUR || 3), Number(process.env.AI_RENDER_DAILY_LIMIT || 100), "картинок");
  if (limitMessage) {
    logger.warn(`[render] запрос отклонён лимитом: ${limitMessage}`);
    sendJson(response, 429, { status: "error", message: limitMessage });
    return;
  }

  try {
    const payload = await readJson(request);
    const itemPhoto = validateDataUrl(payload.itemPhotoDataUrl, "Фото вещи");
    const productUrls = Array.isArray(payload.productUrls) ? payload.productUrls.filter((url) => typeof url === "string").slice(0, 8) : [];
    const id = await startRenderJob({
      itemPhoto,
      itemCategory: String(payload.itemCategory || "верх").slice(0, 30),
      productUrls,
      occasion: String(payload.occasion || "").slice(0, 80)
    }, catalog);
    sendJson(response, 202, { status: "pending", id });
  } catch (error) {
    const clientProblem = error instanceof AiError && error.httpStatus < 500;
    logger[clientProblem ? "warn" : "error"](`[render] ${clientProblem ? "запрос отклонён" : "ошибка"}: ${error instanceof AiError ? error.message : error.stack || error.message}`);
    sendJson(response, error instanceof AiError ? error.httpStatus : 500, {
      status: "error",
      message: error instanceof AiError ? error.message : "Не удалось запустить генерацию."
    });
  }
}

function handleRenderStatus(id, response) {
  const job = getRenderJob(id);
  if (!job) {
    sendJson(response, 404, { status: "error", message: "Задание не найдено или устарело. Запустите генерацию заново." });
    return;
  }
  sendJson(response, 200, { status: job.status, imageDataUrl: job.imageDataUrl, message: job.message });
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim();
}

async function handleValidateProducts(request, response) {
  const payload = await readJson(request);
  const products = Array.isArray(payload.products) ? payload.products : [];
  const results = await Promise.all(products.map(validateProductUrl));

  sendJson(response, 200, {
    status: "ready",
    results
  });
}

async function validateProductUrl(product) {
  const key = product.key || product.sku || product.url;
  if (!product.url) return { key, ok: false, reason: "missing-url" };
  if (productUrlCache.has(product.url)) return { key, ...productUrlCache.get(product.url) };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const doFetch = await createFetch(process.env.PARSE_PROXY_URL);
    const productResponse = await doFetch(product.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7"
      }
    });
    const status = productResponse.status;
    const finalUrl = productResponse.url || product.url;
    const contentType = productResponse.headers.get("content-type") || "";
    let body = "";
    if (contentType.includes("text/html")) {
      body = (await productResponse.text()).slice(0, 180000).toLowerCase();
    }
    const notFoundText = /страница не найдена|страница не существует|товар не найден|page not found|404 not found|not found/.test(body);
    const ok = status >= 200 && status < 400 && !notFoundText;
    const result = {
      ok,
      status,
      finalUrl,
      reason: ok ? "ok" : notFoundText ? "not-found-page" : `http-${status}`
    };
    productUrlCache.set(product.url, result);
    return { key, ...result };
  } catch (error) {
    const result = {
      ok: false,
      status: 0,
      finalUrl: product.url,
      reason: error.name === "AbortError" ? "timeout" : error.message
    };
    productUrlCache.set(product.url, result);
    return { key, ...result };
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let routePath = url.pathname;
  if (routePath === "/ai-online-stylist") routePath = "/";
  if (routePath.startsWith("/ai-online-stylist/")) routePath = routePath.replace("/ai-online-stylist", "");

  const normalizedPath = decodeURIComponent(routePath === "/" ? "/index.html" : routePath);
  const requested = path.normalize(path.join(__dirname, normalizedPath));
  const relative = path.relative(__dirname, requested);
  const hidden = relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules");
  const extension = path.extname(requested).toLowerCase();

  if (relative.startsWith("..") || hidden || !mimeTypes[extension] || !existsSync(requested)) {
    sendText(response, 404, "Not found");
    return;
  }

  const content = await readFile(requested);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension],
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function readJson(request, limit = maxRequestBodyBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > limit) {
        tooLarge = true;
        body = "";
        reject(new AiError("Запрос слишком большой. Загрузите фото полегче.", 413));
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new AiError("Некорректный запрос.", 400));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  response.end(JSON.stringify(payload));
}

function sendCorsPreflight(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  });
  response.end();
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
