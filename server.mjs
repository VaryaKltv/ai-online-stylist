import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv();
const port = Number(process.env.PORT || 8012);
const maxRequestBodyBytes = 90 * 1024 * 1024;
const productUrlCache = new Map();

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

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const rows = readFileSync(envPath, "utf8").split(/\r?\n/);
  rows.forEach((row) => {
    const line = row.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  });
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
      sendCorsPreflight(response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/validate-products") {
      await handleValidateProducts(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { status: "error", message: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`StyleMate AI: http://127.0.0.1:${port}/`);
});

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
    const productResponse = await fetch(product.url, {
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

  if (!requested.startsWith(__dirname) || !existsSync(requested)) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(requested);
  const content = await readFile(requested);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxRequestBodyBytes) {
        reject(new Error("Фото слишком большое для генерации. Загрузите JPG/PNG полегче или обновите страницу: сервис теперь сжимает фото автоматически."));
        request.pause();
      }
    });
    request.on("end", () => resolve(JSON.parse(body)));
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
