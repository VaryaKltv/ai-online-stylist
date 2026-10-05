import { REQUIRED_CATEGORIES } from "./catalog-source.mjs";
import { createFetch, describeProxy } from "./proxy-fetch.mjs";
import { logger } from "./logger.mjs";

const BUDGET_LIMITS = { budget: 25000, middle: 70000, designer: 180000 };
const SLOT_KEYS = { верх: "top", низ: "bottom", сумка: "bag", обувь: "shoes", аксессуары: "accessories" };
const MAX_PER_CATEGORY = 25;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90000;

export class AiError extends Error {
  constructor(message, httpStatus = 502) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

export function looksCount() {
  return Math.min(3, Math.max(2, Number(process.env.LOOKS_COUNT) || 2));
}

export function isAiConfigured() {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  return key.startsWith("sk-") && !/your|here/i.test(key);
}

export async function runAiStylist({ itemPhoto, personPhoto, form, products }) {
  if (!isAiConfigured()) throw new AiError("OPENAI_API_KEY не задан.", 503);

  const limit = BUDGET_LIMITS[form.budget] || BUDGET_LIMITS.middle;
  const needed = REQUIRED_CATEGORIES.filter((category) => category !== form.itemCategory);
  const candidates = buildCandidates(products, needed, limit, form.occasion);
  const schema = buildSchema(candidates, Boolean(personPhoto));
  logger.log(`[ai] кандидатов для ChatGPT: ${candidates.needed.map((category) => `${category} ${candidates.bySlot[category].length}`).join(", ")}; лимит ${limit} ₽`);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserContent({ itemPhoto, personPhoto, form, candidates, limit }) }
  ];

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proxyUrl = String(process.env.OPENAI_PROXY_URL || "").trim();
    logger.log(`[ai] попытка ${attempt + 1}: запрос к OpenAI, модель ${process.env.OPENAI_MODEL || "gpt-4o"}, картинок ${personPhoto ? 2 : 1}, ${proxyUrl ? `через прокси ${describeProxy(proxyUrl)}` : "напрямую"}`);
    const askedAt = Date.now();
    const reply = await callOpenAi(messages, schema);
    logger.log(`[ai] попытка ${attempt + 1}: ответ OpenAI за ${((Date.now() - askedAt) / 1000).toFixed(1)} с`);
    const result = JSON.parse(reply);
    const looks = Object.values(result.looks).map((look) => {
      const picked = Object.entries(look.picks).map(([slot, id]) => candidates.byId.get(id) || { missing: `${slot}:${id}` });
      return { look, picked, total: picked.reduce((sum, product) => sum + (product.price || 0), 0) };
    });

    lastProblem = findProblem(looks, candidates, limit);
    if (!lastProblem) {
      return {
        analysis: { person: result.person || null, item: result.item },
        looks: looks.map(({ look, picked, total }) => ({
          title: look.title,
          rationale: look.rationale,
          total,
          products: picked.map(({ id, ...product }) => product)
        }))
      };
    }

    logger.warn(`[ai] попытка ${attempt + 1} отклонена: ${lastProblem}`);
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `Ошибка: ${lastProblem}. Составь образы заново: строго из списка кандидатов, каждый в пределах бюджета ${limit} ₽, и без повторов одних и тех же товаров в разных образах.` }
    );
  }

  throw new AiError(`ChatGPT не смог уложиться в условия: ${lastProblem}.`, 502);
}

function findProblem(looks, candidates, limit) {
  const numbered = (index) => `образ ${index + 1}`;
  for (const [index, { picked, total }] of looks.entries()) {
    if (picked.some((product) => product.missing)) return `в ${numbered(index)} выбран товар, которого нет в списке кандидатов`;
    if (total > limit) return `сумма ${numbered(index)} (${total} ₽) превышает бюджет ${limit} ₽`;
  }
  for (const category of candidates.needed) {
    if (candidates.bySlot[category].length < looks.length) continue;
    const ids = looks.map(({ picked }) => picked.find((product) => product.category === category)?.id);
    if (new Set(ids).size < ids.length) return `в категории «${category}» один и тот же товар выбран в разных образах`;
  }
  return "";
}

export function validateDataUrl(value, label) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match) throw new AiError(`${label}: нужен файл JPG, PNG или WebP.`, 400);
  if (match[1].length * 0.75 > MAX_IMAGE_BYTES) throw new AiError(`${label}: файл слишком большой.`, 413);
  return value;
}

function buildCandidates(products, needed, limit, occasion) {
  const byId = new Map();
  const bySlot = {};

  for (const category of needed) {
    const options = products.filter((product) => product.inStock && product.category === category && product.price > 0 && product.price <= limit);
    if (!options.length) throw new AiError(`В каталоге нет подходящих товаров в категории «${category}» для этого бюджета.`, 422);

    const shuffled = options.map((product) => ({ product, order: Math.random() })).sort((a, b) => a.order - b.order).map((entry) => entry.product);
    const matching = shuffled.filter((product) => product.occasions.includes(occasion));
    const rest = shuffled.filter((product) => !product.occasions.includes(occasion));

    bySlot[category] = [...matching, ...rest].slice(0, MAX_PER_CATEGORY).map((product, index) => {
      const withId = { ...product, id: `${SLOT_KEYS[category]}_${index + 1}` };
      byId.set(withId.id, withId);
      return withId;
    });
  }

  return { byId, bySlot, needed };
}

function buildSchema(candidates, hasPerson) {
  const picks = {
    type: "object",
    additionalProperties: false,
    required: candidates.needed.map((category) => SLOT_KEYS[category]),
    properties: Object.fromEntries(
      candidates.needed.map((category) => [SLOT_KEYS[category], { type: "string", enum: candidates.bySlot[category].map((product) => product.id) }])
    )
  };

  const lookKeys = Array.from({ length: looksCount() }, (_, index) => `look_${index + 1}`);
  const text = { type: "string" };
  const list = { type: "array", items: { type: "string" } };
  const level = (values) => ({ type: "string", enum: values });

  const properties = {
    item: {
      type: "object",
      additionalProperties: false,
      required: ["description", "color", "style"],
      properties: { description: text, color: text, style: text }
    },
    looks: {
      type: "object",
      additionalProperties: false,
      required: lookKeys,
      properties: Object.fromEntries(lookKeys.map((key) => [key, {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "picks"],
        properties: { title: text, rationale: text, picks }
      }]))
    }
  };

  if (hasPerson) {
    properties.person = {
      type: "object",
      additionalProperties: false,
      required: ["visible", "skin_tone", "undertone", "hair_color", "eye_color", "contrast", "color_type", "best_colors", "avoid_colors", "confidence", "comment"],
      properties: {
        visible: { type: "boolean" },
        skin_tone: text,
        undertone: level(["тёплый", "холодный", "нейтральный", "оливковый", "не определён"]),
        hair_color: text,
        eye_color: text,
        contrast: level(["низкий", "средний", "высокий", "не определён"]),
        color_type: text,
        best_colors: list,
        avoid_colors: list,
        confidence: level(["высокая", "средняя", "низкая"]),
        comment: text
      }
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: hasPerson ? ["person", "item", "looks"] : ["item", "looks"],
    properties
  };
}

function buildUserContent({ itemPhoto, personPhoto, form, candidates, limit }) {
  const lines = [
    `Повод: ${form.occasion}.`,
    `Вещь клиентки на первом фото относится к категории «${form.itemCategory}» и обязательно входит в образ. Подбери к ней остальные позиции: ${candidates.needed.join(", ")}.`,
    `Составь ${looksCount()} разных образа с этой вещью.`,
    `Бюджет: в каждом образе сумма цен выбранных товаров не должна превышать ${limit} ₽ (вещь клиентки в бюджет не входит).`,
    form.age ? `Возраст, указанный клиенткой: ${form.age}.` : "",
    "",
    "Кандидаты (id | бренд | название | цвет | цена | описание):"
  ];

  for (const category of candidates.needed) {
    lines.push(`\n${category}:`);
    for (const product of candidates.bySlot[category]) {
      lines.push(`${product.id} | ${product.brand} | ${product.name} | ${product.color || "цвет не указан"} | ${product.price} ₽ | ${product.visual || "—"}`);
    }
  }

  const content = [
    { type: "text", text: lines.filter((line) => line !== null).join("\n") },
    { type: "text", text: "Фото 1 — вещь клиентки:" },
    { type: "image_url", image_url: { url: itemPhoto, detail: "high" } }
  ];

  if (personPhoto) {
    content.push(
      { type: "text", text: "Фото 2 — клиентка (для определения цветотипа):" },
      { type: "image_url", image_url: { url: personPhoto, detail: "high" } }
    );
  }
  return content;
}

async function callOpenAi(messages, schema) {
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  let response;
  try {
    const doFetch = await createFetch(process.env.OPENAI_PROXY_URL);
    response = await doFetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "stylist_result", strict: true, schema } }
      })
    });
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    throw new AiError(timedOut ? "ChatGPT отвечает слишком долго." : `Нет связи с OpenAI: ${error.message}`, 504);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = payload.error?.message || `HTTP ${response.status}`;
    logger.error(`[ai] OpenAI вернул ${response.status} (модель ${model}): ${apiMessage}`);
    throw new AiError(explainOpenAiError(response.status, payload.error?.code, apiMessage), response.status === 429 ? 429 : 502);
  }

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) throw new AiError("ChatGPT отказался анализировать это фото. Попробуйте другое.", 422);
  if (!message?.content) throw new AiError("ChatGPT вернул пустой ответ.", 502);
  return message.content;
}

export function explainOpenAiError(status, code, message) {
  if (code === "unsupported_country_region_territory" || (status === 403 && /country|region|territory/i.test(message))) {
    return "OpenAI не принимает запросы с сервера в этом регионе. Нужен сервер в поддерживаемой стране или OPENAI_BASE_URL с прокси.";
  }
  if (status === 401) return "OpenAI не принял ключ. Проверьте OPENAI_API_KEY.";
  if (status === 429) return "Лимит или баланс OpenAI исчерпан. Проверьте Billing в кабинете OpenAI.";
  if (status === 404 || code === "model_not_found") return "Модель недоступна для этого ключа. Проверьте OPENAI_MODEL и OPENAI_IMAGE_MODEL.";
  if (code === "moderation_blocked" || /safety|moderation/i.test(message)) return "OpenAI отклонил генерацию системой безопасности. Попробуйте другое фото вещи.";
  return `OpenAI вернул ошибку: ${message}`;
}

const SYSTEM_PROMPT = `Ты — профессиональный стилист и колорист для интернет-магазинов одежды. Отвечай по-русски, коротко и по делу.

Работай только с тем, что реально видно на фото.

Фото клиентки (если есть). Опиши только то, что влияет на подбор цветов одежды: глубину и подтон кожи, цвет волос, цвет глаз, контраст между ними. На этой основе определи цветотип (например «Холодное лето», «Тёплая осень») и перечисли цвета, которые ей идут, и цвета, которых лучше избегать. Не определяй и не упоминай национальность, расу, возраст по внешности, здоровье, вес, фигуру, привлекательность и личность. Если на фото нет чёткого лица человека или освещение мешает оценить цвета, поставь visible=false или confidence="низкая" и честно напиши об этом в comment, ничего не выдумывая.

Фото вещи. Кратко опиши, что это за вещь, её цвет и стиль.

Образы. Составь запрошенное число разных образов. В каждом образе выбери ровно по одному товару в каждой категории только из списка кандидатов (по id), не придумывай товары. Образы строятся вокруг вещи клиентки, подходят под повод, сочетаются по цвету и стилю (и с палитрой клиентки, если есть её фото) и укладываются в бюджет по сумме цен. Образы должны заметно отличаться: не повторяй один и тот же товар в разных образах, делай разное настроение (например, строже и мягче, спокойнее и выразительнее). Не бери вещи одного и того же типа дважды в одном образе. В title дай короткое название образа (2–4 слова), в rationale на 3–5 предложений объясни выбор: цвета, силуэт, повод.`;
