import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_CATEGORIES, collectBrand, dedupe, normalizeProducts } from "../catalog-source.mjs";

const gender = process.argv[2];
if (gender !== "men") {
  console.error("Использование: node tools/seed-curated.mjs men\n(женский каталог data/curated-catalog.json ведётся вручную)");
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const perCategoryPerBrand = Number(process.env.SEED_PER_CATEGORY || 6);
const sources = JSON.parse(await readFile(path.join(root, "data", "brand-sources.json"), "utf8"))
  .filter((source) => source.gender === gender && source.status === "parser-ready");

const collected = [];
for (const source of sources) collected.push(...await collectBrand(source, 12, console));

const unique = dedupe(normalizeProducts(collected)).filter((product) => product.inStock && product.price >= 150);
const products = [];
for (const category of REQUIRED_CATEGORIES) {
  for (const brand of [...new Set(unique.map((product) => product.brand))]) {
    const group = unique.filter((product) => product.category === category && product.brand === brand);
    const step = Math.max(1, Math.floor(group.length / perCategoryPerBrand));
    products.push(...group.filter((_, index) => index % step === 0).slice(0, perCategoryPerBrand));
  }
}

const result = products.map((product) => ({ ...product, visual: product.name, occasions: [] }));
const file = path.join(root, "data", `curated-catalog-${gender}.json`);
await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), mode: "scraped-seed", products: result }, null, 2));

console.log(`\nГотово: ${result.length} товаров -> ${file}`);
for (const category of REQUIRED_CATEGORIES) {
  const byBrand = {};
  for (const product of result.filter((item) => item.category === category)) byBrand[product.brand] = (byBrand[product.brand] || 0) + 1;
  console.log(`  ${category.padEnd(11)} ${Object.entries(byBrand).map(([brand, count]) => `${brand}: ${count}`).join(", ") || "ПУСТО"}`);
}
