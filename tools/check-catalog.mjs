import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.mjs";
import { createCatalog } from "../catalog-source.mjs";
import { createHealthMonitor } from "../catalog-health.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv(root);

const catalog = createCatalog({ root });
const monitor = createHealthMonitor({ catalog, root });
await monitor.load();
const report = await monitor.run();
if (!report) process.exit(1);

const labels = { ok: "ОК     ", gone: "БИТАЯ  ", unknown: "НЕЯСНО " };
console.log("\nПодробно по ссылкам:");
for (const { product, result } of report.results) {
  const extra = result.state === "ok"
    ? [result.price ? `${result.price} ₽` : "", result.inStock === false ? "НЕТ В НАЛИЧИИ" : ""].filter(Boolean).join(", ")
    : result.reason;
  console.log(`${labels[result.state]} ${product.brand} — ${product.name}${extra ? ` [${extra}]` : ""}\n         ${product.url}`);
}
