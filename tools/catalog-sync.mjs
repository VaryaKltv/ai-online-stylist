import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const sourcesPath = path.join(projectRoot, "data", "brand-sources.json");
const outputPath = path.join(projectRoot, "data", "live-catalog.json");

const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
const products = [];

for (const source of sources) {
  for (const [category, urls] of Object.entries(source.categories || {})) {
    for (const url of urls) {
      const categoryProducts = await collectCategoryProducts(source, category, url);
      products.push(...categoryProducts);
      console.log(`${source.brand}: ${category} -> ${categoryProducts.length} товаров`);
    }
  }
}

const uniqueProducts = dedupeProducts(products)
  .filter((product) => product.url && product.name)
  .sort((a, b) => a.brand.localeCompare(b.brand, "ru") || a.category.localeCompare(b.category, "ru"));

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  productCount: uniqueProducts.length,
  products: uniqueProducts
}, null, 2));

console.log(`Готово: ${uniqueProducts.length} товаров -> ${outputPath}`);

async function collectCategoryProducts(source, category, categoryUrl) {
  const html = await fetchText(categoryUrl);
  if (!html) return [];

  const links = extractProductLinks(html, source.baseUrl);
  const limitedLinks = links.slice(0, Number(process.env.CATALOG_SYNC_LIMIT || 36));
  const productPages = await Promise.all(limitedLinks.map((url) => fetchProductPage(source, category, url)));
  return productPages.filter(Boolean);
}

async function fetchProductPage(source, category, url) {
  const html = await fetchText(url);
  if (!html) return null;

  const product = {
    brand: source.brand,
    category,
    name: extractMeta(html, "og:title") || extractTitle(html),
    price: extractPrice(html),
    currency: "RUB",
    url,
    image: extractMeta(html, "og:image"),
    sku: extractSku(html, url),
    color: extractColor(html),
    inStock: !/нет в наличии|out of stock|sold out/i.test(stripTags(html))
  };

  if (!product.name || !product.price) return null;
  return product;
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "StyleMateAI-CatalogPrototype/1.0"
      }
    });
    if (!response.ok) {
      console.warn(`Пропуск ${url}: HTTP ${response.status}`);
      return "";
    }
    return await response.text();
  } catch (error) {
    console.warn(`Пропуск ${url}: ${error.message}`);
    return "";
  }
}

function extractProductLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => safeUrl(match[1], base))
    .filter(Boolean)
    .filter((url) => isLikelyProductUrl(url));
  return [...new Set(hrefs)];
}

function isLikelyProductUrl(url) {
  return /\/product\/|\/products\/|\/catalog\/.+\/\d+\/?$|\/p\/|\/goods\//i.test(url);
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i");
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i");
  return decodeHtml((html.match(pattern) || html.match(reversePattern) || [])[1] || "");
}

function extractTitle(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  return decodeHtml(stripTags(title)).replace(/\s+/g, " ").trim();
}

function extractPrice(html) {
  const jsonLdPrice = html.match(/"price"\s*:\s*"?(\d+(?:[.,]\d+)?)"?/i);
  if (jsonLdPrice) return Number(jsonLdPrice[1].replace(",", "."));

  const text = stripTags(html).replace(/\s+/g, " ");
  const rubPrice = text.match(/(\d[\d\s]{2,})\s*(?:₽|руб)/i);
  return rubPrice ? Number(rubPrice[1].replace(/\s/g, "")) : 0;
}

function extractSku(html, url) {
  const sku = html.match(/"sku"\s*:\s*"([^"]+)"/i) || html.match(/арт(?:икул)?\.?\s*[:№]?\s*([A-ZА-Я0-9_-]+)/i);
  if (sku) return sku[1];
  return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
}

function extractColor(html) {
  const color = html.match(/"color"\s*:\s*"([^"]+)"/i) || html.match(/цвет\s*[:：]\s*([^<\n]+)/i);
  return color ? decodeHtml(stripTags(color[1])).trim().toLowerCase() : "";
}

function safeUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (url.hostname !== base.hostname) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function dedupeProducts(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.sku || item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
