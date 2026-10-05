import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createFetch, describeProxy } from "./proxy-fetch.mjs";

export const REQUIRED_CATEGORIES = ["верх", "низ", "сумка", "обувь", "аксессуары"];

const USER_AGENT = "StyleMateAI-CatalogBot/1.0";
const FETCH_TIMEOUT_MS = 12000;
const FETCH_CONCURRENCY = 4;
const MIN_PRODUCTS_PER_CATEGORY = 2;
export const FEMININE_MARKERS = /каблук|шпильк|платформ|казак|подвеск|(?<![а-яё])роз(?:а|ой|ы|у)(?![а-яё])|(?<![а-яё])бант|кружев|корсет|юбк|плать|бюст|колгот|чулк|(?<![а-яё])сабо|мюли|балетк|клатч|цепью|цепочк|леопард|меховая|меховой|бралет|бикини|для беременных/i;
export const FAIL_THRESHOLD = 2;

let httpFetch = fetch;

export function createCatalog({ root, log = console }) {
  const mode = String(process.env.LOOKS_SOURCE || "local").trim().toLowerCase() === "parse" ? "parse" : "local";
  const refreshMs = Math.max(1, Number(process.env.PARSE_REFRESH_HOURS || 6)) * 3600 * 1000;
  const perCategoryLimit = Math.max(1, Number(process.env.CATALOG_SYNC_LIMIT || 12));
  const curatedPaths = ["curated-catalog.json", "curated-catalog-men.json"].map((name) => path.join(root, "data", name));
  const livePath = path.join(root, "data", "live-catalog.json");
  const sourcesPath = path.join(root, "data", "brand-sources.json");

  let curated = null;
  let live = null;
  let syncing = false;
  let lastSyncNote = mode === "parse" ? "синхронизация ещё не завершена" : "";
  let health = {};

  async function readCatalogFile(file) {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      return { generatedAt: data.generatedAt || "", products: normalizeProducts(data.products || []) };
    } catch {
      return null;
    }
  }

  async function loadCurated() {
    if (!curated) {
      const parts = await Promise.all(curatedPaths.map(readCatalogFile));
      const loaded = parts.filter(Boolean);
      curated = { generatedAt: loaded[0]?.generatedAt || "", products: loaded.flatMap((part) => part.products) };
    }
    return curated.products;
  }

  async function getAllProducts() {
    const curatedProducts = await loadCurated();
    const seen = new Set();
    return [...curatedProducts, ...(live?.products || [])].filter((product) => !seen.has(product.url) && seen.add(product.url));
  }

  async function getCatalog() {
    const curatedProducts = await loadCurated();
    let products = curatedProducts;
    let source = "local";
    let generatedAt = curated?.generatedAt || "";
    let fallbackReason = mode === "parse" ? lastSyncNote : "";

    if (mode === "parse" && live) {
      const merged = [];
      const notes = [];
      let usedParsed = false;
      for (const gender of ["women", "men"]) {
        const parsed = live.products.filter((product) => product.gender === gender);
        const thin = REQUIRED_CATEGORIES.filter((category) => countInStock(parsed, category) < MIN_PRODUCTS_PER_CATEGORY);
        const fallback = curatedProducts.filter((product) => product.gender === gender);
        if (thin.length < REQUIRED_CATEGORIES.length) usedParsed = true;
        merged.push(...(thin.length < REQUIRED_CATEGORIES.length ? parsed : []), ...fallback.filter((product) => thin.includes(product.category)));
        if (thin.length && parsed.length) notes.push(`${gender === "men" ? "мужской" : "женский"} каталог: из локального добраны категории ${thin.join(", ")}`);
      }
      if (usedParsed) {
        products = merged;
        source = notes.length ? "parse+local" : "parse";
        generatedAt = live.generatedAt;
        fallbackReason = notes.join("; ");
      }
    }

    const { products: checked, excluded } = applyHealth(products, health);
    return { mode, source, generatedAt, fallbackReason, excluded, products: checked };
  }

  function setHealth(items) {
    health = items || {};
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const proxyUrl = String(process.env.PARSE_PROXY_URL || "").trim();
      httpFetch = await createFetch(proxyUrl);
      log.log(`[catalog] парсинг магазинов ${proxyUrl ? `через прокси ${describeProxy(proxyUrl)}` : "напрямую, без прокси"}`);
      const sources = JSON.parse(await readFile(sourcesPath, "utf8")).filter((source) => source.status === "parser-ready");
      const products = [];
      for (const source of sources) {
        products.push(...await collectBrand(source, perCategoryLimit, log));
      }

      const unique = dedupe(normalizeProducts(products));
      if (!REQUIRED_CATEGORIES.some((category) => countInStock(unique, category) >= MIN_PRODUCTS_PER_CATEGORY)) {
        lastSyncNote = `парсинг дал только ${unique.length} пригодных товаров, ни в одной категории не набралось достаточно — используется локальный каталог`;
        log.warn(`[catalog] ${lastSyncNote}`);
        return;
      }

      live = { generatedAt: new Date().toISOString(), products: unique };
      lastSyncNote = "";
      await mkdir(path.dirname(livePath), { recursive: true });
      await writeFile(livePath, JSON.stringify({ generatedAt: live.generatedAt, productCount: unique.length, products: unique }, null, 2));
      log.log(`[catalog] парсинг завершён: ${unique.length} товаров`);
    } catch (error) {
      lastSyncNote = `ошибка парсинга: ${error.message}`;
      log.error(`[catalog] ${lastSyncNote}`);
    } finally {
      syncing = false;
    }
  }

  async function start() {
    if (mode !== "parse") return;
    const saved = await readCatalogFile(livePath);
    const fresh = saved && Date.now() - Date.parse(saved.generatedAt || 0) < refreshMs;
    if (saved && fresh && saved.products.length) live = saved;
    if (!live) sync();
    setInterval(sync, refreshMs).unref();
  }

  return { mode, getCatalog, getAllProducts, setHealth, sync, start };
}

export function normalizeProducts(items) {
  return items
    .map((item) => ({
      brand: String(item.brand || "").trim(),
      gender: item.gender === "men" || item.gender === "unisex" ? item.gender : "women",
      category: item.category,
      name: String(item.name || "").trim(),
      price: Number(item.price) || 0,
      url: item.url || "",
      sku: String(item.sku || "").trim(),
      color: String(item.color || "").trim().toLowerCase(),
      visual: String(item.visual || "").trim(),
      image: item.image || item.productImage || "",
      inStock: item.inStock !== false,
      occasions: Array.isArray(item.occasions) ? item.occasions : []
    }))
    .filter((item) => item.brand && item.name && item.url && item.price > 0 && REQUIRED_CATEGORIES.includes(item.category));
}

function countInStock(products, category) {
  return products.filter((product) => product.inStock && product.category === category).length;
}

export function applyHealth(products, health) {
  const marked = products.map((product) => {
    const info = health[product.url];
    if (!info) return { product, dead: false, failures: 0 };
    return {
      product: { ...product, price: info.price || product.price, inStock: info.inStock ?? product.inStock },
      dead: (info.failures || 0) >= FAIL_THRESHOLD,
      failures: info.failures || 0
    };
  });

  const kept = marked.filter((entry) => !entry.dead);
  for (const category of REQUIRED_CATEGORIES) {
    const hasLive = kept.some((entry) => entry.product.category === category);
    const dead = marked.filter((entry) => entry.dead && entry.product.category === category);
    if (!hasLive && dead.length) kept.push(...dead.sort((a, b) => a.failures - b.failures).slice(0, MIN_PRODUCTS_PER_CATEGORY));
  }

  const result = marked.filter((entry) => kept.includes(entry)).map((entry) => entry.product);
  return { products: result, excluded: products.length - result.length };
}

export function dedupe(products) {
  const seen = new Set();
  return products.filter((product) => {
    const keys = [product.url, `${product.gender}|${product.brand}|${product.category}|${product.name.toLowerCase()}`];
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

export async function collectBrand(source, limit, log) {
  const robots = await loadRobotsRules(source.baseUrl);
  const result = [];
  let failedCategoryPages = 0;

  for (const [category, urls] of Object.entries(source.categories || {})) {
    for (const categoryUrl of urls) {
      if (failedCategoryPages >= 2 && !result.length) {
        log.warn(`[catalog] ${source.brand}: сайт не отвечает, бренд пропущен`);
        return result;
      }
      if (!robots.allows(categoryUrl)) continue;

      const html = await fetchText(categoryUrl);
      if (!html) {
        failedCategoryPages += 1;
        continue;
      }

      const links = extractProductLinks(html, source.baseUrl, source.productPattern).filter((url) => robots.allows(url)).slice(0, limit);
      const pages = await mapLimit(links, FETCH_CONCURRENCY, (url) => fetchProduct(source, category, url));
      const good = pages.filter(Boolean);
      log.log(`[catalog] ${source.brand} / ${category}: ${good.length} из ${links.length}`);
      result.push(...good);
    }
  }
  return result;
}

async function fetchProduct(source, category, url) {
  const html = await fetchText(url);
  if (!html) return null;
  const product = extractProduct(html, url);
  if (!product) return null;
  if (source.gender === "men" && FEMININE_MARKERS.test(product.name)) return null;
  return { brand: source.brand, gender: source.gender || "women", category, ...product };
}

export function extractProduct(html, url) {
  const ld = findJsonLdProduct(html);
  const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;

  const name = cleanName(ld?.name || extractMeta(html, "og:title") || extractTitle(html));
  const price = toPrice(offer?.price) || toPrice(extractMicrodata(html, "price")) || toPrice(extractMeta(html, "product:price:amount")) || extractVisiblePrice(html);
  const sku = String(ld?.sku || extractMicrodata(html, "sku") || "").trim();
  const color = String(ld?.color || extractMicrodata(html, "color") || "").trim();
  const image = pickImage(ld?.image, html, url);
  const availability = String(offer?.availability || "");
  const inStock = availability ? /InStock|LimitedAvailability|PreOrder/i.test(availability) : !/нет в наличии|out of stock|sold out/i.test(stripTags(html).slice(0, 60000));

  if (!name || !price || !image) return null;
  return { name, price, url, sku: sku && !/[,\s]/.test(sku) ? sku : skuFromUrl(url), color, image, inStock };
}

export function extractOffer(html) {
  const ld = findJsonLdProduct(html);
  const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
  const price = toPrice(offer?.price) || toPrice(extractMicrodata(html, "price")) || toPrice(extractMeta(html, "product:price:amount"));
  const availability = String(offer?.availability || "");
  let inStock;
  if (/InStock|LimitedAvailability|PreOrder/i.test(availability)) inStock = true;
  else if (/OutOfStock|SoldOut|Discontinued/i.test(availability)) inStock = false;
  return { price, inStock };
}

function findJsonLdProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
      const product = nodes.find((node) => [].concat(node?.["@type"] || []).includes("Product"));
      if (product) return product;
    } catch {
      // битый JSON-LD просто пропускаем
    }
  }
  return null;
}

function pickImage(ldImage, html, pageUrl) {
  const candidates = [].concat(Array.isArray(ldImage) ? ldImage : [ldImage])
    .map((value) => (typeof value === "object" ? value?.url : value))
    .concat(extractMeta(html, "og:image"))
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const absolute = new URL(candidate, pageUrl).toString();
      if (!/icon|logo|favicon|placeholder|sprite|\.svg(\?|$)/i.test(absolute)) return absolute;
    } catch {
      // некорректный адрес картинки
    }
  }

  const sku = extractMicrodata(html, "sku");
  if (sku) {
    const code = sku.replace(/-/g, "_");
    const match = html.match(new RegExp(`https?://[^"'\\s)]+/${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(?:jpg|jpeg|webp)`, "i"));
    if (match) return match[0].replace(/thumb\/\d+_\d+/, "thumb/600_9999");
  }
  return "";
}

function extractVisiblePrice(html) {
  const afterTitle = html.slice(Math.max(0, html.search(/<h1/i)));
  const match = stripTags(afterTitle.slice(0, 8000)).replace(/\u00a0/g, " ").match(/(\d[\d\s]{2,8})\s*(?:₽|руб)/i);
  return match ? toPrice(match[1].replace(/\s/g, "")) : 0;
}

function toPrice(value) {
  const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number >= 100 && number < 1000000 ? Math.round(number) : 0;
}

function extractMicrodata(html, prop) {
  const forward = html.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  const reverse = html.match(new RegExp(`content=["']([^"']+)["'][^>]*itemprop=["']${prop}["']`, "i"));
  return decodeHtml((forward || reverse || [])[1] || "");
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forward = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const reverse = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
  return decodeHtml((forward || reverse || [])[1] || "");
}

function extractTitle(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  return decodeHtml(stripTags(title)).replace(/\s+/g, " ").trim();
}

function cleanName(value) {
  return decodeHtml(String(value))
    .replace(/\s+[-–—|]\s+(?:купить|заказать|интернет-магазин).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function skuFromUrl(url) {
  return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
}

function extractProductLinks(html, baseUrl, pattern) {
  const base = new URL(baseUrl);
  const isProduct = pattern
    ? (url) => new RegExp(pattern).test(url)
    : (url) => /\/product\/|\/products\/|\/catalog\/.+\/\d+\/?$|\/p\/|\/goods\//i.test(url);
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => {
      try {
        const url = new URL(decodeHtml(match[1]), base);
        url.hash = "";
        url.search = "";
        return url.hostname === base.hostname ? url.toString() : "";
      } catch {
        return "";
      }
    })
    .filter((url) => url && isProduct(url));
  return [...new Set(links)];
}

export async function loadRobotsRules(baseUrl, doFetch = httpFetch) {
  const text = await fetchText(new URL("/robots.txt", baseUrl).toString(), doFetch);
  const rules = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) applies = value === "*";
    else if (applies && value && /^(?:dis)?allow$/i.test(key)) rules.push({ allow: /^allow$/i.test(key), pattern: robotsPattern(value), length: value.length });
  }
  return {
    allows(url) {
      const { pathname, search } = new URL(url);
      const target = pathname + search;
      const matched = rules.filter((rule) => rule.pattern.test(target)).sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow));
      return matched.length ? matched[0].allow : true;
    }
  };
}

function robotsPattern(rule) {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export async function fetchText(url, doFetch = httpFetch) {
  try {
    const response = await doFetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "ru-RU,ru;q=0.9" }
    });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
