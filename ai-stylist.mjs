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
    const picked = Object.entries(result.look.picks).map(([slot, id]) => candidates.byId.get(id) || { missing: `${slot}:${id}` });
    const total = picked.reduce((sum, product) => sum + (product.price || 0), 0);

    if (picked.some((product) => product.missing)) {
      lastProblem = "выбран товар, которого нет в списке кандидатов";
    } else if (total > limit) {
      lastProblem = `сумма ${total} ₽ превышает бюджет ${limit} ₽`;
    } else {
      return {
        analysis: { person: result.person || null, item: result.item },
        look: {
          title: result.look.title,
          rationale: result.look.rationale,
          total,
          products: picked.map(({ id, ...product }) => product)
        }
      };
    }

    logger.warn(`[ai] попытка ${attempt + 1} отклонена: ${lastProblem}`);
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `Ошибка: ${lastProblem}. Подбери образ заново — строго из списка кандидатов и в пределах бюджета ${limit} ₽.` }
    );
  }

  throw new AiError(`ChatGPT не смог уложиться в условия: ${lastProblem}.`, 502);
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
    look: {
      type: "object",
      additionalProperties: false,
      required: ["title", "rationale", "picks"],
      properties: { title: text, rationale: text, picks }
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
    required: hasPerson ? ["person", "item", "look"] : ["item", "look"],
    properties
  };
}

function buildUserContent({ itemPhoto, personPhoto, form, candidates, limit }) {
  const lines = [
    `Повод: ${form.occasion}.`,
    `Вещь клиентки на первом фото относится к категории «${form.itemCategory}» и обязательно входит в образ. Подбери к ней остальные позиции: ${candidates.needed.join(", ")}.`,
    `Бюджет: сумма цен всех выбранных товаров не должна превышать ${limit} ₽ (вещь клиентки в бюджет не входит).`,
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

function explainOpenAiError(status, code, message) {
  if (code === "unsupported_country_region_territory" || (status === 403 && /country|region|territory/i.test(message))) {
    return "OpenAI не принимает запросы с сервера в этом регионе. Нужен сервер в поддерживаемой стране или OPENAI_BASE_URL с прокси.";
  }
  if (status === 401) return "OpenAI не принял ключ. Проверьте OPENAI_API_KEY.";
  if (status === 429) return "Лимит или баланс OpenAI исчерпан. Проверьте Billing в кабинете OpenAI.";
  if (status === 404 || code === "model_not_found") return "Модель недоступна для этого ключа. Измените OPENAI_MODEL.";
  return `OpenAI вернул ошибку: ${message}`;
}

const SYSTEM_PROMPT = `Ты — профессиональный стилист и колорист для интернет-магазинов одежды. Отвечай по-русски, коротко и по делу.

Работай только с тем, что реально видно на фото.

Фото клиентки (если есть). Опиши только то, что влияет на подбор цветов одежды: глубину и подтон кожи, цвет волос, цвет глаз, контраст между ними. На этой основе определи цветотип (например «Холодное лето», «Тёплая осень») и перечисли цвета, которые ей идут, и цвета, которых лучше избегать. Не определяй и не упоминай национальность, расу, возраст по внешности, здоровье, вес, фигуру, привлекательность и личность. Если на фото нет чёткого лица человека или освещение мешает оценить цвета, поставь visible=false или confidence="низкая" и честно напиши об этом в comment, ничего не выдумывая.

Фото вещи. Кратко опиши, что это за вещь, её цвет и стиль.

Образ. Выбери ровно по одному товару в каждой категории только из списка кандидатов (по id), не придумывай товары. Образ строится вокруг вещи клиентки, подходит под повод, сочетается по цвету и стилю (и с палитрой клиентки, если есть её фото) и укладывается в бюджет по сумме цен. Не бери вещи одного и того же типа дважды. В rationale на 3–5 предложений объясни выбор: цвета, силуэт, повод.`;
