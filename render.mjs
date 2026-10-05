import { randomUUID } from "node:crypto";
import { AiError, explainOpenAiError, isAiConfigured } from "./ai-stylist.mjs";
import { createFetch, describeProxy } from "./proxy-fetch.mjs";
import { logger } from "./logger.mjs";

const JOB_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_JOBS = 4;
const MAX_PRODUCT_REFERENCES = 4;
const REFERENCE_TIMEOUT_MS = 7000;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 240000;
const REFERENCE_PRIORITY = ["обувь", "сумка", "верх", "низ", "аксессуары"];

const jobs = new Map();

export function isRenderEnabled() {
  return isAiConfigured() && String(process.env.AI_RENDER_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

export function getRenderJob(id) {
  cleanupJobs();
  return jobs.get(id) || null;
}

export async function startRenderJob({ itemPhoto, itemCategory, productUrls, occasion }, catalog) {
  cleanupJobs();
  if ([...jobs.values()].filter((job) => job.status === "pending").length >= MAX_PENDING_JOBS) {
    throw new AiError("Сейчас идёт много генераций. Попробуйте через минуту.", 429);
  }

  const { products: catalogProducts } = await catalog.getCatalog();
  const byUrl = new Map(catalogProducts.map((product) => [product.url, product]));
  const products = [...new Set(productUrls)]
    .map((url) => byUrl.get(url))
    .filter(Boolean)
    .slice(0, 5);
  if (!products.length) throw new AiError("Не удалось определить товары образа для генерации.", 422);

  const id = randomUUID();
  jobs.set(id, { status: "pending", createdAt: Date.now() });
  logger.log(`[render] задание ${id.slice(0, 8)} принято: товаров ${products.length}, вещь «${itemCategory}»`);

  runJob(id, { itemPhoto, itemCategory, products, occasion }).catch((error) => {
    logger.error(`[render] задание ${id.slice(0, 8)} не выполнено: ${error instanceof AiError ? error.message : error.stack || error.message}`);
    jobs.set(id, { status: "error", createdAt: Date.now(), message: error instanceof AiError ? error.message : "Не удалось создать изображение." });
  });
  return id;
}

async function runJob(id, { itemPhoto, itemCategory, products, occasion }) {
  const startedAt = Date.now();
  const references = await loadProductReferences(products);
  logger.log(`[render] задание ${id.slice(0, 8)}: картинок товаров получено ${references.length} из ${products.length}`);

  const files = [{ field: "image[]", filename: "customer-item.jpg", ...decodeDataUrl(itemPhoto) }];
  references.forEach((reference, index) => {
    files.push({ field: "image[]", filename: `product-${index + 1}.jpg`, data: reference.data, type: reference.type });
  });

  const prompt = buildPrompt({ itemCategory, products, references, occasion });
  const result = await requestImage(prompt, files, id);

  jobs.set(id, { status: "ready", createdAt: Date.now(), imageDataUrl: result });
  logger.log(`[render] задание ${id.slice(0, 8)} готово за ${((Date.now() - startedAt) / 1000).toFixed(1)} с, картинка ${Math.round(result.length * 0.75 / 1024)} КБ`);
}

async function requestImage(prompt, files, id) {
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
  const proxyUrl = String(process.env.OPENAI_PROXY_URL || "").trim();
  const doFetch = await createFetch(proxyUrl);
  const format = process.env.OPENAI_IMAGE_FORMAT || "jpeg";

  for (const withFormat of [true, false]) {
    const fields = {
      model,
      prompt,
      n: "1",
      size: process.env.OPENAI_IMAGE_SIZE || "1024x1536",
      quality: process.env.OPENAI_IMAGE_QUALITY || "medium"
    };
    if (withFormat) {
      fields.output_format = format;
      fields.output_compression = "85";
    }
    const { body, contentType } = multipart(fields, files);
    logger.log(`[render] задание ${id.slice(0, 8)}: запрос к OpenAI, модель ${model}, картинок ${files.length}, ${proxyUrl ? `через прокси ${describeProxy(proxyUrl)}` : "напрямую"}`);

    let response;
    try {
      response = await doFetch(`${base}/images/edits`, {
        method: "POST",
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`, "content-type": contentType },
        body
      });
    } catch (error) {
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      throw new AiError(timedOut ? "OpenAI генерирует слишком долго." : `Нет связи с OpenAI: ${error.message}`, 504);
    }

    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) throw new AiError("OpenAI не вернул изображение.", 502);
      return `data:image/${withFormat ? format : "png"};base64,${b64}`;
    }

    const apiMessage = payload.error?.message || `HTTP ${response.status}`;
    if (withFormat && response.status === 400 && /output_format|output_compression|unknown parameter|unrecognized/i.test(apiMessage)) {
      logger.warn(`[render] задание ${id.slice(0, 8)}: модель не приняла параметры формата (${apiMessage}), повторяю без них`);
      continue;
    }
    logger.error(`[render] задание ${id.slice(0, 8)}: OpenAI вернул ${response.status} (модель ${model}): ${apiMessage}`);
    throw new AiError(explainOpenAiError(response.status, payload.error?.code, apiMessage), 502);
  }
  throw new AiError("Не удалось получить изображение.", 502);
}

async function loadProductReferences(products) {
  const doFetch = await createFetch(process.env.PARSE_PROXY_URL);
  const ordered = [...products]
    .sort((a, b) => REFERENCE_PRIORITY.indexOf(a.category) - REFERENCE_PRIORITY.indexOf(b.category))
    .filter((product) => product.image)
    .slice(0, MAX_PRODUCT_REFERENCES);

  const loaded = await Promise.all(ordered.map(async (product) => {
    try {
      const response = await doFetch(product.image, {
        signal: AbortSignal.timeout(REFERENCE_TIMEOUT_MS),
        headers: { "user-agent": "StyleMateAI-CatalogBot/1.0" }
      });
      const type = (response.headers.get("content-type") || "").split(";")[0].trim();
      if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_REFERENCE_BYTES) return null;
      return { product, data, type };
    } catch {
      return null;
    }
  }));
  return loaded.filter(Boolean);
}

function buildPrompt({ itemCategory, products, references, occasion }) {
  const referenceLines = references.map((reference, index) => `image ${index + 2}: ${describe(reference.product)}`);
  const referenced = new Set(references.map((reference) => reference.product.url));
  const withoutReference = products.filter((product) => !referenced.has(product.url));

  return [
    "Create one photorealistic full-length fashion e-commerce photo of a complete outfit shown on a plain white abstract mannequin: no face, no hair, smooth featureless head, standing straight, front view, head to toe fully visible including shoes. Neutral light-gray seamless studio background, soft even lighting, centered composition.",
    `Image 1 is the customer's own garment (category: ${itemCategory}). It is the anchor of the outfit and must be clearly visible on the mannequin. Preserve its color, material, pattern, silhouette and details as closely as possible. Do not replace it with a similar item.`,
    referenceLines.length ? `The other input images are product references, use each strictly for the look of that product:\n${referenceLines.join("\n")}` : "",
    "Reproduce each product's type, color, silhouette, length, fabric look, straps, hardware and shape exactly as in its reference. Never take any person, model, pose, face or background from the product images.",
    withoutReference.length ? `Products without a reference image, build them from the description:\n${withoutReference.map(describe).join("\n")}` : "",
    `Occasion: ${occasion || "everyday"}. Dress the mannequin in the customer's garment plus all listed products and nothing else: do not add any clothing, jacket, coat, scarf or accessory that is not listed.`,
    "Keep each shoe type exactly as listed (do not turn flats or loafers into boots). No text, no labels, no watermark, no brand logos."
  ].filter(Boolean).join("\n\n");
}

function describe(product) {
  return [`${product.category}: ${product.name}`, product.color ? `color: ${product.color}` : "", product.visual].filter(Boolean).join(", ");
}

function decodeDataUrl(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  return { type: meta.match(/^data:(.*?);base64$/)?.[1] || "image/jpeg", data: Buffer.from(base64, "base64") };
}

function multipart(fields, files) {
  const boundary = `----stylemate${randomUUID().replace(/-/g, "")}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.data, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

