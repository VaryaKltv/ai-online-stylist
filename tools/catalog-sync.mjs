import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalog } from "../catalog-source.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const catalog = createCatalog({ root });
await catalog.sync();

const result = await catalog.getCatalog();
console.log(`Источник: ${result.source}, товаров: ${result.products.length}${result.fallbackReason ? `. ${result.fallbackReason}` : ""}`);
