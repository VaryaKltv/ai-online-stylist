import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { FAIL_THRESHOLD, extractOffer, loadRobotsRules, mapLimit } from "./catalog-source.mjs";
import { createFetch, describeProxy } from "./proxy-fetch.mjs";

const CHECK_TIMEOUT_MS = 12000;
const CHECK_CONCURRENCY = 4;
const RECHECK_DELAY_MS = 5000;
const MAX_DETAIL_LINES = 30;
const MIN_REAL_PAGE_LENGTH = 4000;
const SOFT_NOT_FOUND = /страница не найдена|страница не существует|товар не найден|товара не существует|товар недоступен|товар снят с продажи|page not found|product not found|\b404\b/i;

export async function checkProductPage(url, doFetch, robots) {
  if (robots && !robots.allows(url)) return { state: "unknown", reason: "запрещено в robots.txt" };

  let response;
  try {
    response = await doFetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { "user-agent": "StyleMateAI-CatalogBot/1.0", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "ru-RU,ru;q=0.9" }
    });
  } catch (error) {
    return { state: "unknown", reason: error.name === "TimeoutError" ? "таймаут" : `сеть: ${error.cause?.code || error.message}` };
  }

  if (response.status === 404 || response.status === 410) return { state: "gone", reason: `HTTP ${response.status}` };
  if (!response.ok) return { state: "unknown", reason: `HTTP ${response.status}` };

  try {
    if (new URL(url).pathname !== "/" && new URL(response.url || url).pathname === "/") {
      return { state: "gone", reason: "редирект на главную страницу" };
    }
  } catch {
    // адрес без разбора считаем обычным
  }

  if (!/text\/html/i.test(response.headers.get("content-type") || "")) return { state: "unknown", reason: "ответ не HTML" };

  const html = (await response.text()).slice(0, 250000);
  const heading = [match(html, /<title[^>]*>([\s\S]*?)<\/title>/i), match(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i), match(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)/i)].join(" ");
  if (SOFT_NOT_FOUND.test(heading)) return { state: "gone", reason: "страница «не найдена»" };

  const offer = extractOffer(html);
  if (html.length < MIN_REAL_PAGE_LENGTH && !offer.price) return { state: "unknown", reason: "похоже на защиту от ботов" };
  return { state: "ok", price: offer.price || undefined, inStock: offer.inStock };
}

function match(html, pattern) {
  return (html.match(pattern)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function createHealthMonitor({ catalog, root, log = console }) {
  const file = path.join(root, "data", "catalog-health.json");
  const intervalHours = Number(process.env.CATALOG_CHECK_HOURS ?? 6);
  let state = { checkedAt: "", items: {} };
  let running = false;

  async function load() {
    try {
      state = JSON.parse(await readFile(file, "utf8"));
      catalog.setHealth(state.items);
    } catch {
      state = { checkedAt: "", items: {} };
    }
  }

  async function run() {
    if (running) return null;
    running = true;
    try {
      return await check();
    } catch (error) {
      log.error(`[health] проверка каталога не удалась: ${error.stack || error.message}`);
      return null;
    } finally {
      running = false;
    }
  }

  async function check() {
    const products = await catalog.getAllProducts();
    const proxyUrl = String(process.env.PARSE_PROXY_URL || "").trim();
    const doFetch = await createFetch(proxyUrl);
    const startedAt = Date.now();
    log.log(`[health] проверка каталога: ${products.length} ссылок, ${proxyUrl ? `через прокси ${describeProxy(proxyUrl)}` : "напрямую"}`);

    const robotsByOrigin = new Map();
    const robotsFor = async (url) => {
      const origin = new URL(url).origin;
      if (!robotsByOrigin.has(origin)) robotsByOrigin.set(origin, loadRobotsRules(origin, doFetch).catch(() => null));
      return robotsByOrigin.get(origin);
    };
    const checkOne = async (product) => checkProductPage(product.url, doFetch, await robotsFor(product.url));

    const results = await mapLimit(products, CHECK_CONCURRENCY, async (product) => ({ product, result: await checkOne(product) }));

    const goneFirst = results.filter(({ result }) => result.state === "gone");
    if (goneFirst.length) {
      await new Promise((resolve) => setTimeout(resolve, RECHECK_DELAY_MS));
      const rechecked = await mapLimit(goneFirst, CHECK_CONCURRENCY, async (entry) => ({ entry, second: await checkOne(entry.product) }));
      for (const { entry, second } of rechecked) {
        entry.result = second.state === "gone" ? { ...entry.result, confirmed: true } : second;
      }
    }

    const confirmedGone = results.filter(({ result }) => result.state === "gone" && result.confirmed);
    const massFailure = confirmedGone.length >= 5 && confirmedGone.length / products.length > 0.5;
    if (massFailure) {
      log.warn(`[health] подозрительно: ${confirmedGone.length} из ${products.length} ссылок «не найдены». Похоже, сайты блокируют проверку, поэтому ссылки не исключаются.`);
    }

    const now = new Date().toISOString();
    const items = {};
    const details = [];
    const counts = { ok: 0, gone: 0, unknown: 0, soldOut: 0, repriced: 0, excluded: 0, recovered: 0 };

    for (const { product, result } of results) {
      const previous = state.items[product.url] || {};
      const wasDead = (previous.failures || 0) >= FAIL_THRESHOLD;
      const label = `${product.brand} — ${product.name} (${product.url})`;
      let item = { ...previous, lastChecked: now };

      if (result.state === "ok") {
        counts.ok += 1;
        item = { ...item, failures: 0, lastOk: now, reason: "" };
        if (result.price && result.price !== product.price) {
          counts.repriced += 1;
          details.push(`цена изменилась ${product.price} → ${result.price} ₽: ${label}`);
        }
        if (result.price) item.price = result.price;
        if (result.inStock !== undefined) {
          item.inStock = result.inStock;
          if (result.inStock === false) {
            counts.soldOut += 1;
            if (previous.inStock !== false) details.push(`нет в наличии: ${label}`);
          }
        }
        if (wasDead) {
          counts.recovered += 1;
          details.push(`ссылка снова работает: ${label}`);
        }
      } else if (result.state === "gone" && !massFailure) {
        counts.gone += 1;
        const failures = result.confirmed ? FAIL_THRESHOLD : (previous.failures || 0) + 1;
        item = { ...item, failures, reason: result.reason };
        if (failures >= FAIL_THRESHOLD && !wasDead) {
          counts.excluded += 1;
          details.push(`ссылка не работает (${result.reason}), товар исключён: ${label}`);
        }
      } else {
        counts.unknown += 1;
        item.reason = result.state === "gone" ? "массовый отказ, не засчитан" : result.reason;
      }
      items[product.url] = item;
    }

    state = { checkedAt: now, items };
    catalog.setHealth(items);

    const { excluded } = await catalog.getCatalog();
    log.log(`[health] готово за ${((Date.now() - startedAt) / 1000).toFixed(0)} с: рабочих ${counts.ok}, не работает ${counts.gone}, не удалось проверить ${counts.unknown}, нет в наличии ${counts.soldOut}, цен обновлено ${counts.repriced}, сейчас исключено из выдачи ${excluded}`);
    details.slice(0, MAX_DETAIL_LINES).forEach((line) => log.warn(`[health] ${line}`));
    if (details.length > MAX_DETAIL_LINES) log.warn(`[health] ...и ещё ${details.length - MAX_DETAIL_LINES} изменений`);
    await alertThinCategories(log);

    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(state, null, 2));
    } catch (error) {
      log.warn(`[health] не удалось сохранить результаты: ${error.message}`);
    }
    return { counts, results, excluded };
  }

  async function alertThinCategories(logger) {
    const all = await catalog.getAllProducts();
    for (const category of ["верх", "низ", "сумка", "обувь", "аксессуары"]) {
      const alive = all.filter((product) => {
        const info = state.items[product.url] || {};
        return product.category === category && (info.failures || 0) < FAIL_THRESHOLD && (info.inStock ?? product.inStock) !== false;
      }).length;
      if (alive < 2) logger.error(`[health] в категории «${category}» осталось рабочих товаров: ${alive}. Добавьте позиции в data/curated-catalog.json или включите парсинг`);
    }
  }

  function start() {
    load().then(() => {
      if (!(intervalHours > 0)) {
        log.log("[health] автоматическая проверка каталога выключена (CATALOG_CHECK_HOURS=0)");
        return;
      }
      setTimeout(run, 60 * 1000).unref();
      setInterval(run, intervalHours * 3600 * 1000).unref();
    });
  }

  return { start, run, load, get checkedAt() { return state.checkedAt; } };
}
