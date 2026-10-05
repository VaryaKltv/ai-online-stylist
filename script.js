const telegram = window.Telegram?.WebApp;
if (telegram) {
  telegram.ready();
  telegram.expand();
}

let clientErrorReports = 0;

function reportClient(event, details = {}) {
  try {
    const body = new Blob([JSON.stringify({ event, details })], { type: "application/json" });
    const base = window.location.protocol === "file:" ? "http://127.0.0.1:8012" : "";
    navigator.sendBeacon(`${base}/api/client-log`, body);
  } catch {
    // отчёт об ошибке не должен сам ломать страницу
  }
}

window.addEventListener("error", (event) => {
  if (clientErrorReports++ < 5) reportClient("js_error", { message: event.message, file: String(event.filename || "").split("/").pop(), line: event.lineno });
});

window.addEventListener("unhandledrejection", (event) => {
  if (clientErrorReports++ < 5) reportClient("js_error", { message: event.reason?.message || String(event.reason) });
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

const form = document.querySelector("#stylistForm");
const emptyState = document.querySelector("#emptyState");
const loadingState = document.querySelector("#loadingState");
const errorState = document.querySelector("#errorState");
const errorText = document.querySelector("#errorText");
const resultState = document.querySelector("#resultState");
const historyList = document.querySelector("#historyList");
const clearHistory = document.querySelector("#clearHistory");
const sampleButton = document.querySelector("#sampleButton");
const itemInput = document.querySelector("#itemPhoto");
const itemPreview = document.querySelector("#previewItem");
const personInput = document.querySelector("#personPhoto");
const personPreview = document.querySelector("#previewPerson");
const personHint = document.querySelector("#personHint");
const aiNoteNode = document.querySelector("#aiNote");

const historyKey = "stylemate-ai-history-v4";
const apiBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:8012" : "";
let historyItems = JSON.parse(localStorage.getItem(historyKey) || "[]");
const uploadedItemData = {};
const uploadedPersonData = {};
let activeCatalogProducts = [];
let catalogLoadFailed = false;
let serverStatus = { aiConfigured: false, renderConfigured: false };
let currentRecord = null;
let renderRunId = 0;
const catalogLoadPromise = loadProductCatalog();
const statusPromise = loadServerStatus();

const defaultLookCount = 2;
const defaultGoalsByOccasion = {
  "офис и встречи": "выглядеть собранно, уместно для офиса и встреч, с аккуратным силуэтом",
  "повседневная одежда": "получить стильные повседневные образы, которые выглядят актуально и легко носятся каждый день",
  "вечерние наряды": "выглядеть женственнее, выразительнее и дороже для ужина, свидания или вечернего выхода"
};

const defaultPalettesByOccasion = {
  "офис и встречи": "молочный, графит, темно-синий, спокойные акценты",
  "повседневная одежда": "деним, молочный, серый, голубой, мягкие городские акценты",
  "вечерние наряды": "молочный, черный, бордо, серый металлик, мягкий блеск"
};

const defaultStylesByOccasion = {
  "офис и встречи": ["деловой", "smart casual", "минимализм"],
  "повседневная одежда": ["smart casual", "городская база", "актуальный casual"],
  "вечерние наряды": ["романтика", "женственный силуэт", "дизайнерский акцент"]
};

const stylistKnowledge = {
  sourceMethod: "архетипы, тренды SS26 и лекция по аксессуарам",
  sourceDetails: "по презентации «Тренды SS26»: виды трендов, глобальные направления, модные десятилетия и горячие тренды весна-лето 2026",
  seasonalTrends: [
    "яркие оттенки",
    "тропический и графичный принт",
    "новая женственность",
    "многослойность",
    "движение в одежде",
    "скульптурные силуэты",
    "подчеркнутая талия",
    "прозрачность и кружево дозированно",
    "металлик",
    "пижамный стиль",
    "деним",
    "асимметрия",
    "акцентные аксессуары",
    "игра пропорций"
  ],
  trendFormulas: {
    "офис и встречи": [
      "power dressing 80-х в летней версии: четкая линия, прямой низ, закрытая обувь, структурная сумка",
      "90-е минимализм: чистая рубашка или лаконичный топ, нейтральная палитра, без лишнего декора",
      "новая женственность для офиса: миди, мягкая асимметрия, акцент у лица или в сумке"
    ],
    "повседневная одежда": [
      "90-е и деним: майка/рубашка, джинсы или шорты, расслабленная посадка",
      "60-е в летнем прочтении: мини, короткий низ, графичная линия, аккуратная обувь",
      "тактильность и функциональность: хлопок, модал, мягкая сумка, удобная обувь"
    ],
    "вечерние наряды": [
      "новая женственность: корсетный верх, талия, юбка с движением или асимметрией",
      "будуарная эстетика дозированно: топ на бретелях, кружево/мягкий блеск, мини или миди",
      "2000-е и металлик: лакированная сумка, акцентные серьги, выразительная обувь"
    ]
  },
  accessoryRules: [
    "аксессуар выбирается под повод, впечатление и линии образа",
    "один сильный акцент лучше нескольких спорящих акцентов",
    "сумка и обувь могут совпадать по цвету, поддерживать тон одежды или работать по цветовой схеме",
    "масштаб сумки и украшений должен быть соразмерен внешности и плотности одежды",
    "ремень, брошь, галстук, украшения и носки могут быть style trick, если образ слишком базовый"
  ],
  archetypeRules: {
    warrior: {
      impression: "сила, компетентность, собранность, границы",
      details: ["кожа", "металл", "молнии", "ремни", "жесткие плечи", "двубортность", "прямая линия", "симметрия"],
      colors: ["красный", "черный", "защитный", "металлик"]
    }
  }
};

const archetypes = [
  {
    name: "Собранный день",
    pose: "front",
    mood: "вертикальные линии, спокойная посадка, акцент у лица",
    use: "для офиса, встреч и городских дел"
  },
  {
    name: "Вечерний акцент",
    pose: "front",
    mood: "чистая база плюс выразительный верхний слой",
    use: "для ужина, свидания или мероприятия после работы"
  },
  {
    name: "Капсула выходного дня",
    pose: "front",
    mood: "комфортный силуэт, фактура и удобная обувь",
    use: "для прогулок, поездок и свободного графика"
  }
];

const budgetLimits = {
  budget: 25000,
  middle: 70000,
  designer: 180000
};

const occasionProfiles = {
  "офис и встречи": {
    names: ["Архитектурный офис", "Встречи в городе", "Деловой акцент", "Офисная капсула", "Спокойный premium"],
    mood: "летний деловой силуэт без тяжелого верхнего слоя: чистые линии, легкая посадка и один дорогой акцент",
    use: "для офиса, рабочих встреч и городского расписания в теплый сезон",
    prefer: ["рубашка", "блузка", "топ", "брюки", "юбка миди", "лоферы", "балетки", "тоут", "структурная", "пусеты", "темно-синий", "серый", "молочный"],
    avoid: ["бейсболка", "кеды", "джинсы", "мини", "корсет", "сандалии", "мюли", "ветровка", "куртка", "плащ", "тренч", "пальто", "бомбер", "сапоги-трубы", "кросс-боди"]
  },
  "повседневная одежда": {
    names: ["Городской casual", "Свободный день", "Smart casual база", "Деним и фактура", "Легкий слой"],
    mood: "легкая летняя городская база: деним, хлопок, открытая обувь и небанальный аксессуар",
    use: "для прогулок, дел и свободного графика в теплую погоду",
    prefer: ["шорты", "мини", "юбка-шорты", "джинсы", "рубашка", "топ", "майка", "кросс-боди", "сандалии", "балетки", "сумка", "деним", "голубой", "молочный"],
    avoid: ["пальто", "плащ", "тренч", "ветровка", "бомбер", "куртка", "лодочки", "сапоги-трубы", "колье", "слишком строгий", "офис"]
  },
  "вечерние наряды": {
    names: ["Мягкий вечер", "Акцентный выход", "Ужин после работы", "Женственный силуэт", "Вечерняя база"],
    mood: "летний вечерний силуэт: открытый верх, подчеркнутая талия, фактура, мягкий блеск и выразительная сумка",
    use: "для ужина, свидания и вечернего выхода в теплую погоду",
    prefer: ["корсет", "топ", "асимметр", "юбка", "мини", "юбка-шорты", "запах", "мюли", "балетки", "ботильоны", "лакирован", "бордовый", "серьги", "клатч"],
    avoid: ["бейсболка", "кеды", "джинсы", "ветровка", "пуховик", "плащ", "тренч", "пальто", "бомбер", "куртка", "офисная рубашка", "манишка"]
  }
};

function bindPhotoInput(input, preview, store, errorMessage) {
  if (!input || !preview) return;

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) {
      delete store.photo;
      preview.removeAttribute("src");
      preview.classList.remove("visible");
      return;
    }

    try {
      const optimizedSrc = await optimizePhoto(file);
      store.photo = { name: file.name, src: optimizedSrc };
      preview.src = optimizedSrc;
      preview.classList.add("visible");
    } catch {
      errorText.textContent = errorMessage;
      showState(errorState);
    }
  });
}

bindPhotoInput(itemInput, itemPreview, uploadedItemData, "Не удалось подготовить фото вещи. Попробуйте JPG/PNG без сильного размытия.");
bindPhotoInput(personInput, personPreview, uploadedPersonData, "Не удалось подготовить фото. Попробуйте JPG/PNG без сильного размытия.");

function optimizePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", reject);
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", reject);
      image.addEventListener("load", () => {
        const maxSide = 1024;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

function getFormData() {
  const occasion = document.querySelector("#occasion").value;
  const goal = defaultGoalsByOccasion[occasion] || "получить собранные актуальные образы под выбранный повод";
  const styles = defaultStylesByOccasion[occasion] || ["актуальная база"];

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    gender: "women",
    age: document.querySelector("#age")?.value.trim() || "",
    itemCategory: document.querySelector("#itemCategory")?.value || "верх",
    budget: document.querySelector("#budget").value,
    size: "автоматически по фото",
    measurements: {},
    occasion,
    lookCount: defaultLookCount,
    goal,
    styles,
    colors: defaultPalettesByOccasion[occasion] || "нейтральная база и один аккуратный акцент",
    avoid: "",
    phone: "",
    telegram: "",
    itemPhoto: uploadedItemData.photo || null
  };
}

function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

async function loadProductCatalog() {
  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}/api/catalog`, 30000);
    const payload = await readJsonResponse(response, "Не удалось загрузить каталог.");
    activeCatalogProducts = normalizeCatalogProducts(payload.products || []);
  } catch {
    catalogLoadFailed = true;
    activeCatalogProducts = [];
  }
  return activeCatalogProducts;
}

async function loadServerStatus() {
  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}/api/status`, 10000);
    const status = await readJsonResponse(response, "Не удалось получить статус сервера.");
    if (!status.aiConfigured) {
      if (personHint) personHint.textContent = "Анализ по фото сейчас недоступен: на сервере не подключён ChatGPT.";
      if (aiNoteNode) aiNoteNode.hidden = true;
    }
    return status;
  } catch {
    return { aiConfigured: false };
  }
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(fallbackMessage || "Backend вернул пустой ответ. Обновите страницу и убедитесь, что сервер запущен.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage || "Backend вернул не JSON. Откройте сервис по http://127.0.0.1:8012/ai-online-stylist/ и обновите страницу.");
  }
}

function normalizeCatalogProducts(products) {
  return products.map((product) => ({
    name: product.name,
    displayName: product.displayName || product.name,
    brand: product.brand,
    category: product.category,
    price: Number(product.price) || 0,
    url: product.url,
    sku: product.sku || extractSku(product.url || ""),
    exactUrl: Boolean(product.url),
    color: product.color || "",
    visual: product.visual || "",
    productImage: product.productImage || product.image || "",
    inStock: product.inStock !== false,
    occasions: product.occasions || []
  }));
}

function validate(data) {
  if (!data.itemPhoto) {
    return "Загрузите фото вещи, вокруг которой нужно собрать аутфиты.";
  }

  return "";
}

function generateLooks(data) {
  const baseItems = activeCatalogProducts.filter((product) => product.exactUrl && product.inStock && product.linkOk !== false);
  if (!hasCompleteProductSet(baseItems)) {
    throw new Error("Не загрузился каталог конкретных товаров. Откройте сервис по ссылке http://127.0.0.1:8012/ai-online-stylist/ и обновите страницу, чтобы образы собирались только из точных карточек магазинов.");
  }
  const avoid = data.avoid.toLowerCase();
  const pool = baseItems.filter((product) => !avoid || !product.name.toLowerCase().includes(avoid)) || baseItems;
  const palette = data.colors || "нейтральная база, деним, черный и один глубокий акцент";
  const profile = occasionProfiles[data.occasion] || occasionProfiles["повседневная одежда"];
  const budgetLimit = budgetLimits[data.budget] || budgetLimits.middle;
  const lookCount = Math.max(1, data.lookCount || 1);
  const usedProductKeys = new Set();
  const usedFormulaKeys = new Set();
  const usedBottomTypes = new Set();
  const usedBrandCounts = new Map();

  return Array.from({ length: lookCount }, (_, index) => {
    const type = buildLookType(profile, index);
    const trendStrategy = trendStrategyForLook(data.occasion, index);
    const products = selectLookProducts(pool.length ? pool : baseItems, index, data, profile, budgetLimit, {
      usedProductKeys,
      usedFormulaKeys,
      usedBottomTypes,
      usedBrandCounts
    });
    const outfitProducts = products.filter((product) => product.category !== data.itemCategory);
    const total = outfitProducts.reduce((sum, product) => sum + product.price, 0);
    const styleMethodNote = buildStyleMethodNote(data, products);
    const diversityBrief = lookDiversityBrief(data.occasion, index, products);
    outfitProducts.forEach((product) => usedProductKeys.add(productKey(product)));
    outfitProducts.forEach((product) => usedBrandCounts.set(product.brand, (usedBrandCounts.get(product.brand) || 0) + 1));
    usedFormulaKeys.add(lookFormulaKey(outfitProducts));
    const bottom = outfitProducts.find((product) => product.category === "низ");
    if (bottom) usedBottomTypes.add(bottomTypeKey(bottom));

    return {
      ...type,
      title: `Образ ${index + 1}: ${type.name}`,
      products: outfitProducts,
      userItem: data.itemPhoto,
      userItemCategory: data.itemCategory,
      total,
      budgetLimit,
      trendStrategy,
      diversityBrief,
      size: data.size,
      measurements: data.measurements,
      rationale: `Образ собран вокруг вашей вещи, остальное подобрано под повод «${data.occasion}» в пределах ${formatPrice(budgetLimit)}. Настроение образа: ${profile.mood}. Палитра: ${palette}.`
    };
  });
}

function trendStrategyForLook(occasion, index) {
  const formulas = stylistKnowledge.trendFormulas[occasion] || stylistKnowledge.trendFormulas["повседневная одежда"];
  return formulas[index % formulas.length];
}

function buildStyleMethodNote(data, products) {
  const productText = products.map((product) => `${product.name} ${product.visual} ${product.color}`).join(" ").toLowerCase();
  const applied = [];

  if (/мини|шорты|графич|геометр|ботильон/.test(productText)) {
    applied.push("взята отсылка к 60-м: короткий низ, графичная линия и легкая летняя подача");
  }
  if (/деним|джинс|майка|рубашка|минимал/.test(productText)) {
    applied.push("использован код 90-х: деним, простые линии, база без перегруза");
  }
  if (/серьг|сумка|ремень|ботильоны|балетки/.test(productText)) {
    applied.push("аксессуары используются как управляемый акцент: у лица, в сумке или обуви");
  }
  if (/асимметр|запах|корсет|талия|пояс|топ на бретелях/.test(productText)) {
    applied.push("встроена новая женственность SS26: талия, асимметрия и движение в крое");
  }
  if (/кожа|замша|металл|лакирован|прямая|воротник|тоут/.test(productText)) {
    applied.push("добавлен архетипический код силы: фактура, четкая линия, граница и собранность");
  }
  if (/кружев|атлас|модал|вискоз|мягк|молочный/.test(productText)) {
    applied.push("добавлена тактильность SS26: мягкая фактура, комфорт и ощущение легкости");
  }
  if (data.occasion === "офис и встречи") {
    applied.push("офисная формула держит чистые линии без перегруза трендами");
  }
  if (data.occasion === "вечерние наряды") {
    applied.push("женственность собирается через мягкую фактуру, талию и акцент у лица");
  }
  if (data.occasion === "повседневная одежда") {
    applied.push("повседневная формула держит баланс: расслабленная посадка, актуальная база и один небанальный элемент");
  }

  return `Метод: ${stylistKnowledge.sourceMethod}; ${applied.slice(0, 3).join("; ") || "тренды адаптированы под задачу клиента, а не использованы буквально"}.`;
}

function hasCompleteProductSet(items) {
  const requiredCategories = ["верх", "низ", "сумка", "обувь", "аксессуары"];
  return requiredCategories.every((category) => items.some((product) => product.category === category));
}

function extractSku(url) {
  const befreeMatch = url.match(/\/product\/([^/]+)\/([^/]+)\/?$/);
  if (befreeMatch) return `${befreeMatch[1]}-${befreeMatch[2]}`;

  const catalogMatch = url.match(/\/(\d+)\/?$/);
  if (catalogMatch) return catalogMatch[1];

  return "нужен фид";
}

function buildLookType(profile, index) {
  return {
    name: profile.names[index % profile.names.length],
    pose: "front",
    mood: profile.mood,
    use: profile.use
  };
}

function lookDiversityBrief(occasion, index, products) {
  const variant = index % 3;
  const picked = Object.fromEntries(products.map((product) => [product.category, product]));
  const exactLine = ["верх", "низ", "сумка", "обувь", "аксессуары"]
    .map((category) => picked[category] ? `${category}: ${picked[category].name}, ${picked[category].color || "точный цвет товара"}` : "")
    .filter(Boolean)
    .join("; ");
  const plans = {
    "офис и встречи": [
      "Лук 1 обязан быть брючным деловым комплектом: рубашка или блузка, прямые офисные брюки, закрытая плоская обувь. Никаких сапог, мини, корсетов и вечерней подачи.",
      "Лук 2 обязан быть юбочным офисным комплектом: верх визуально отличается от первого, низ только юбка миди или прямая юбка, обувь аккуратная и низкая. Не повторять брючный силуэт первого лука.",
      "Лук 3 обязан быть мягким smart casual для встреч: другой верх и другой низ, более расслабленная посадка, но все еще деловой вид. Не повторять белый топ + серые брюки."
    ],
    "повседневная одежда": [
      "Лук 1 обязан быть расслабленным летним casual: деним или прямой легкий низ, открытая легкая обувь или балетки, без офисной строгости.",
      "Лук 2 обязан быть коротким летним силуэтом: шорты, мини или юбка-шорты, легкий топ, свежий цветовой акцент. Не делать миди-юбку и не делать деловые брюки.",
      "Лук 3 обязан быть другим casual-силуэтом: рубашка/топ с юбкой или джинсами, но без повторения низа из первых двух луков."
    ],
    "вечерние наряды": [
      "Лук 1 обязан быть вечерним с акцентом на талию: корсет или выразительный топ, женственный низ, маленькая сумка и нарядная обувь.",
      "Лук 2 обязан быть альтернативным вечерним силуэтом: мини, юбка-шорты или другой низ, заметно другой верх. Не повторять серую миди-юбку и белый базовый топ.",
      "Лук 3 обязан быть вечерним, но отличаться от первых двух по цвету, длине и аксессуарам. Нужен новый силуэт, не копия предыдущего."
    ]
  };

  return `${plans[occasion]?.[variant] || plans["повседневная одежда"][variant]} Точные выбранные товары для этого лука: ${exactLine}.`;
}

function selectLookProducts(items, index, data, profile, budgetLimit, diversityState = {}) {
  const categories = ["верх", "низ", "сумка", "обувь", "аксессуары"];
  const seedText = `${data.id} ${data.occasion} ${data.goal} ${data.colors} ${data.styles.join(" ")}`;
  const seed = [...seedText].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const usedProductKeys = diversityState.usedProductKeys || new Set();
  const usedFormulaKeys = diversityState.usedFormulaKeys || new Set();
  const usedBottomTypes = diversityState.usedBottomTypes || new Set();
  const usedBrandCounts = diversityState.usedBrandCounts || new Map();
  let bestAttempt = null;

  for (let attempt = 0; attempt < 9; attempt += 1) {
    let total = 0;
    const selected = [];
    const selectedBrandCounts = new Map();
    const selectedKeys = new Set();

    categories.forEach((category, categoryIndex) => {
      const options = items.filter((product) => product.category === category);
      const freshOptions = options.filter((product) => !usedProductKeys.has(productKey(product)) && !selectedKeys.has(productKey(product)));
      const candidateOptions = freshOptions.length ? freshOptions : options.filter((product) => !selectedKeys.has(productKey(product)));
      const fallback = items[categoryIndex % items.length];
      if (!candidateOptions.length) {
        selected.push(fallback);
        selectedKeys.add(productKey(fallback));
        total += fallback.price;
        return;
      }

      const remainingCategories = categories.slice(categoryIndex + 1);
      const reserved = minimumRemainingCost(items, remainingCategories);
      const maxForThisCategory = Math.max(0, budgetLimit - total - reserved);
      const typeBalancedOptions = category === "низ" ? avoidRepeatedBottomType(candidateOptions, usedBottomTypes) : candidateOptions;
      const occasionOptions = filterByOccasion(typeBalancedOptions, data, category);
      const scopedOccasionOptions = occasionOptions.length ? occasionOptions : typeBalancedOptions;
      const variantOptions = filterByLookVariant(scopedOccasionOptions, data, category, index);
      const scopedVariantOptions = variantOptions.length ? variantOptions : scopedOccasionOptions;
      const brandBalancedOptions = balanceBrandOptions(scopedVariantOptions, selectedBrandCounts, usedBrandCounts);
      const safeOptions = brandBalancedOptions.length ? brandBalancedOptions : scopedVariantOptions;
      const ranked = rankProducts(safeOptions, data, profile, seed + index * 53 + categoryIndex * 13 + attempt * 101, index);
      if (!ranked.length) return;
      const affordable = ranked.find((product) => product.price <= maxForThisCategory);
      const cheapest = ranked.reduce((best, product) => (product.price < best.price ? product : best), ranked[0]);
      const choice = affordable || cheapest;

      selected.push(choice);
      selectedKeys.add(productKey(choice));
      selectedBrandCounts.set(choice.brand, (selectedBrandCounts.get(choice.brand) || 0) + 1);
      total += choice.price;
    });

    if (selected.length !== categories.length || selected.some((product) => !product)) continue;

    const repaired = repairBudget(selected, items, categories, data, profile, budgetLimit, seed + index * 17 + attempt * 37, usedProductKeys, index);
    const formulaKey = lookFormulaKey(repaired);
    const repeatCount = repaired.filter((product) => usedProductKeys.has(productKey(product))).length;
    const bottom = repaired.find((product) => product.category === "низ");
    const repeatedBottomType = bottom && usedBottomTypes.has(bottomTypeKey(bottom)) ? 1 : 0;
    const formulaPenalty = usedFormulaKeys.has(formulaKey) ? 4 : 0;
    const brandSpread = new Set(repaired.map((product) => product.brand)).size;
    const maxBrandRepeat = Math.max(...[...repaired.reduce((counts, product) => {
      counts.set(product.brand, (counts.get(product.brand) || 0) + 1);
      return counts;
    }, new Map()).values()]);
    const befreeCount = repaired.filter((product) => product.brand === "Befree").length;
    const attemptScore = repeatCount * 20 + repeatedBottomType * 18 + formulaPenalty * 10 + Math.max(0, maxBrandRepeat - 2) * 16 + Math.max(0, befreeCount - 1) * 8 - brandSpread * 5;

    if (!bestAttempt || attemptScore < bestAttempt.score) {
      bestAttempt = { products: repaired, score: attemptScore };
    }
    if (!repeatCount && !repeatedBottomType && !formulaPenalty) break;
  }

  if (!bestAttempt) {
    throw new Error(`Для категории "${data.occasion}" пока не хватает товаров в каталоге. Добавьте позиции в curated-catalog.json или обновите live-catalog.json.`);
  }

  return bestAttempt.products;
}

function avoidRepeatedBottomType(options, usedBottomTypes) {
  if (!usedBottomTypes.size) return options;
  const freshTypes = options.filter((product) => !usedBottomTypes.has(bottomTypeKey(product)));
  return freshTypes.length ? freshTypes : options;
}

function bottomTypeKey(product) {
  const text = productText(product);
  if (/шорты|юбка-шорты/.test(text)) return "shorts";
  if (/мини/.test(text)) return "mini-skirt";
  if (/юбк|запах|асимметр|миди|трапеция/.test(text)) return "skirt";
  if (/джинс|деним/.test(text)) return "denim";
  if (/брюк|палаццо|защип/.test(text)) return "trousers";
  return product.displayName || product.name;
}

function productKey(product) {
  if (!product) return "";
  return product.sku || product.exactUrl || product.url || `${product.brand}:${product.name}:${product.color}`;
}

function lookFormulaKey(products) {
  const groups = {
    "верх": [/рубашк|блузк|манишк/, /корсет|бандо/, /топ|майка/],
    "низ": [/брюк|палаццо|защип/, /юбк|запах|асимметр/, /джинс|легинс/],
    "сумка": [/тоут|шоппер/, /клатч|мини|лакирован/, /замш|кросс-боди/],
    "обувь": [/балетк|мюли/, /сандал/, /ботильон|сапог|лофер/],
    "аксессуары": [/серьг|пусет|кольц/, /ремень|пояс/]
  };

  return products
    .map((product) => {
      const text = productText(product);
      const matchIndex = (groups[product.category] || []).findIndex((pattern) => pattern.test(text));
      return `${product.category}:${matchIndex >= 0 ? matchIndex : product.name}`;
    })
    .join("|");
}

function filterByLookVariant(options, data, category, lookIndex) {
  const variant = lookIndex % 3;
  const occasionPlans = {
    "офис и встречи": [
      {
        "верх": ["рубашка", "блузка", "манишка"],
        "низ": ["брюки прямые", "костюмные", "защип"],
        "сумка": ["тоут", "жесткой формы"],
        "обувь": ["балетки", "лоферы"],
        "аксессуары": ["пусеты", "серьги"]
      },
      {
        "верх": ["топ молочный", "блузка"],
        "низ": ["юбка миди", "прямая юбка"],
        "сумка": ["замши", "тоут"],
        "обувь": ["балетки"],
        "аксессуары": ["серьги"]
      },
      {
        "верх": ["рубашка", "вискозная"],
        "низ": ["брюки", "палаццо"],
        "сумка": ["лакирован", "кросс-боди"],
        "обувь": ["балетки", "ботильоны"],
        "аксессуары": ["полукольца", "серьги"]
      }
    ],
    "повседневная одежда": [
      {
        "верх": ["рубашка", "oversize", "вискозная"],
        "низ": ["джинсы", "wide leg", "деним"],
        "сумка": ["кросс-боди", "через плечо", "клатч"],
        "обувь": ["сандалии", "балетки"],
        "аксессуары": ["серьги", "полукольца"]
      },
      {
        "верх": ["топ", "молочный", "модала"],
        "низ": ["шорты", "мини", "юбка-шорты"],
        "сумка": ["голубой", "бежевый", "замши"],
        "обувь": ["балетки", "сандалии"],
        "аксессуары": ["серьги"]
      },
      {
        "верх": ["рубашка", "полоску", "хлопковая"],
        "низ": ["юбка-трапеция", "асимметр", "миди", "джинсы"],
        "сумка": ["тоут", "клатч", "через плечо"],
        "обувь": ["балетки", "лоферы"],
        "аксессуары": ["полукольца", "пусеты"]
      }
    ],
    "вечерние наряды": [
      {
        "верх": ["корсет"],
        "низ": ["запах", "асимметр", "миди"],
        "сумка": ["лакирован", "мини", "клатч"],
        "обувь": ["мюли", "балетки"],
        "аксессуары": ["серьги", "пусеты"]
      },
      {
        "верх": ["топ молочный", "топ"],
        "низ": ["мини", "юбка-шорты", "юбка миди", "трапеция"],
        "сумка": ["замши", "бордо"],
        "обувь": ["балетки", "мюли"],
        "аксессуары": ["серьги"]
      },
      {
        "верх": ["корсет", "топ"],
        "низ": ["трапеция", "миди", "асимметр"],
        "сумка": ["клатч", "лакирован"],
        "обувь": ["мюли", "балетки"],
        "аксессуары": ["пусеты", "серьги"]
      }
    ]
  };
  const plan = occasionPlans[data.occasion]?.[variant];
  const terms = plan?.[category];
  if (!terms) return options;

  const matched = options.filter((product) => terms.some((term) => productText(product).includes(term)));
  return matched.length ? matched : options;
}

function balanceBrandOptions(options, selectedBrandCounts, usedBrandCounts = new Map()) {
  if (options.length < 2) return options;

  let balanced = options;
  const underPerLookLimit = balanced.filter((product) => (selectedBrandCounts.get(product.brand) || 0) < 2);
  if (underPerLookLimit.length) balanced = underPerLookLimit;

  if (selectedBrandCounts.get("Befree")) {
    const nonBefree = balanced.filter((product) => product.brand !== "Befree");
    if (nonBefree.length) balanced = nonBefree;
  }

  if (selectedBrandCounts.size) {
    const minSelectedCount = Math.min(...balanced.map((product) => selectedBrandCounts.get(product.brand) || 0));
    const selectedBalanced = balanced.filter((product) => (selectedBrandCounts.get(product.brand) || 0) === minSelectedCount);
    if (selectedBalanced.length) balanced = selectedBalanced;
  }

  if (usedBrandCounts.size) {
    const minGlobalCount = Math.min(...balanced.map((product) => usedBrandCounts.get(product.brand) || 0));
    const globallyBalanced = balanced.filter((product) => (usedBrandCounts.get(product.brand) || 0) === minGlobalCount);
    if (globallyBalanced.length) balanced = globallyBalanced;
  }

  return balanced.length ? balanced : options;
}

function filterByOccasion(options, data, category) {
  const filtered = options.filter((product) => isAllowedForOccasion(product, data, category));
  if (options.some((product) => product.occasions?.length)) return filtered;
  return filtered.length ? filtered : options;
}

function isAllowedForOccasion(product, data, category) {
  if (product.occasions?.length && !product.occasions.includes(data.occasion)) return false;

  const text = productText(product);
  const occasion = data.occasion;

  if (occasion === "офис и встречи") {
    if (category === "верх" && /бандо|корсет|открыт/.test(text)) return false;
    if (category === "низ" && /легинсы|мини|экокожа|искусственной кожи/.test(text)) return false;
    if (category === "верхняя одежда" && /пуховик|мех|бомбер/.test(text)) return false;
    if (category === "обувь" && /сандалии|ботфорт/.test(text)) return false;
    if (category === "сумка" && /розов|замком и ключиком|клатч большая|голубой/.test(text)) return false;
  }

  if (occasion === "повседневная одежда") {
    if (category === "верхняя одежда" && /пальто|сапоги-трубы/.test(text)) return false;
    if (category === "обувь" && /лодочки|сапоги/.test(text)) return false;
    if (category === "верх" && /корсетный топ с шерстью/.test(text)) return false;
  }

  if (occasion === "вечерние наряды") {
    if (category === "верхняя одежда" && /ветровка|пуховик/.test(text)) return false;
    if (category === "обувь" && /кеды|сапоги/.test(text)) return false;
    if (category === "низ" && /джинсы|wide leg/.test(text)) return false;
  }

  return true;
}

function minimumRemainingCost(items, categories) {
  return categories.reduce((sum, category) => {
    const prices = items.filter((product) => product.category === category).map((product) => product.price);
    return sum + (prices.length ? Math.min(...prices) : 0);
  }, 0);
}

function rankProducts(products, data, profile, seed, lookIndex = 0) {
  return [...products].sort((a, b) => {
    const scoreA = productScore(a, data, profile, lookIndex) + (stableScore(productKey(a), seed) % 13) * 0.35;
    const scoreB = productScore(b, data, profile, lookIndex) + (stableScore(productKey(b), seed) % 13) * 0.35;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff) return scoreDiff;
    const seededDiff = (stableScore(productKey(b), seed) % 7) - (stableScore(productKey(a), seed) % 7);
    if (seededDiff) return seededDiff;
    return a.price - b.price;
  });
}

function productScore(product, data, profile, lookIndex = 0) {
  const text = productText(product);
  let score = 0;

  profile.prefer.forEach((word) => {
    if (text.includes(word)) score += 8;
  });
  profile.avoid.forEach((word) => {
    if (text.includes(word)) score -= 12;
  });

  const goal = data.goal.toLowerCase();
  if (goal.includes("женствен")) {
    if (text.includes("юбка") || text.includes("балетки") || text.includes("серьги")) score += 5;
    if (text.includes("джинсы") || text.includes("кеды")) score -= 4;
  }
  if (goal.includes("дороже") || goal.includes("собран")) {
    if (text.includes("рубашка") || text.includes("брюки") || text.includes("юбка") || text.includes("кожаная сумка")) score += 5;
    if (text.includes("бейсболка") || text.includes("кеды")) score -= 5;
  }
  if (data.styles.includes("деловой")) {
    if (text.includes("рубашка") || text.includes("брюки") || text.includes("юбка") || text.includes("лоферы") || text.includes("балетки")) score += 6;
  }
  if (data.styles.includes("романтика")) {
    if (text.includes("корсет") || text.includes("юбка") || text.includes("запах") || text.includes("балетки") || text.includes("мюли") || text.includes("серьги")) score += 8;
    if (text.includes("брюки прямые костюмные") || text.includes("ветровка")) score -= 6;
  }
  score += occasionProductScore(text, product.category, data.occasion);
  score += trendProductScore(text, product.category, data.occasion, lookIndex);
  score += lookVariantScore(text, product.category, data.occasion, lookIndex);
  return score;
}

function productText(product) {
  return `${product.name} ${product.displayName || ""} ${product.brand} ${product.category} ${product.color} ${product.visual}`.toLowerCase();
}

function occasionProductScore(text, category, occasion) {
  let score = 0;

  if (occasion === "офис и встречи") {
    if (/рубашка|блузка|топ молочный|брюки прямые|юбка миди|тоут|балетки|лоферы|пусеты|серый|молочный|темно-синий/.test(text)) score += 16;
    if (/корсет|бандо|мини|легинсы|сандалии|мюли|пуховик|пальто|тренч|плащ|бомбер|ветровка|куртка|экокожа|кожа под крокодила|розов|замком и ключиком/.test(text)) score -= 22;
  }

  if (occasion === "повседневная одежда") {
    if (/шорты|мини|юбка-шорты|джинсы|деним|wide leg|рубашка|oversize|топ|майка|кросс-боди|через плечо|сандалии|балетки|голубой|молочный/.test(text)) score += 16;
    if (/лодочки|корсетный топ с шерстью|сапоги-трубы|пальто|плащ|тренч|ветровка|бомбер|куртка/.test(text)) score -= 16;
  }

  if (occasion === "вечерние наряды") {
    if (/корсет|топ|юбка|мини|юбка-шорты|запах|асимметр|мюли|балетки|серьги|кружев|лакирован|бордов|молочный/.test(text)) score += 18;
    if (/рубашка-манишка|брюки прямые костюмные|джинсы|ветровка|пуховик|пальто|тренч|плащ|бомбер|куртка|сапоги/.test(text)) score -= 18;
  }

  return score;
}

function trendProductScore(text, category, occasion, lookIndex) {
  const variant = lookIndex % 3;
  let score = 0;

  if (occasion === "офис и встречи") {
    if (variant === 0 && /брюки прямые|прямая|рубашка|тоут|пусеты|серый|темно-синий/.test(text)) score += 12;
    if (variant === 1 && /топ молочный|рубашка|молочный|балетки|минимал|90/.test(text)) score += 10;
    if (variant === 2 && /юбка миди|асимметр|запах|серьги|лакирован|замша/.test(text)) score += 10;
    if (/мини|шорты|корсет|низкая посадка|прозрач/.test(text)) score -= 20;
  }

  if (occasion === "повседневная одежда") {
    if (variant === 0 && /деним|джинсы|wide leg|майка|рубашка|кросс-боди/.test(text)) score += 14;
    if (variant === 1 && /мини|шорты|юбка-шорты|графич|ванильный|балетки|сандалии/.test(text)) score += 14;
    if (variant === 2 && /хлопок|модал|вискоз|полоску|трапеция|мягк|голубой/.test(text)) score += 12;
    if (/корсетный топ с шерстью|ботильоны|сапоги|пальто|плащ/.test(text)) score -= 14;
  }

  if (occasion === "вечерние наряды") {
    if (variant === 0 && /корсет|талия|асимметр|запах|мюли|серьги/.test(text)) score += 16;
    if (variant === 1 && /топ|мини|юбка-шорты|атлас|кружев|молочный|балетки/.test(text)) score += 14;
    if (variant === 2 && /лакирован|металл|серебрист|бордов|клатч|мюли|серьги/.test(text)) score += 14;
    if (/рубашка-манишка|кеды|джинсы|офисная/.test(text)) score -= 14;
  }

  return score;
}

function lookVariantScore(text, category, occasion, lookIndex) {
  const variant = lookIndex % 3;
  let score = 0;

  if (occasion === "офис и встречи") {
    if (variant === 0 && /рубашка|брюки прямые|тоут|пусеты/.test(text)) score += 8;
    if (variant === 1 && /юбка миди|балетки|сумка из натуральной замши/.test(text)) score += 10;
    if (variant === 2 && /топ молочный|асимметричная юбка|лакирован/.test(text)) score += 9;
  }

  if (occasion === "повседневная одежда") {
    if (variant === 0 && /рубашка|джинсы|деним|сандалии|через плечо/.test(text)) score += 12;
    if (variant === 1 && /топ|шорты|мини|юбка-шорты|голубой|балетки/.test(text)) score += 10;
    if (variant === 2 && /полоску|юбка-трапеция|тоут|лоферы/.test(text)) score += 9;
  }

  if (occasion === "вечерние наряды") {
    if (variant === 0 && /корсет|юбка|мюли|серьги/.test(text)) score += 12;
    if (variant === 1 && /молочный топ|мини|юбка-шорты|асимметричная юбка|лакирован/.test(text)) score += 10;
    if (variant === 2 && /кружев|замша|балетки|клатч/.test(text)) score += 9;
  }

  return score;
}

function repairBudget(products, items, categories, data, profile, budgetLimit, seed, usedProducts = new Set(), lookIndex = 0) {
  let fixed = [...products];
  let total = fixed.reduce((sum, product) => sum + product.price, 0);
  if (total <= budgetLimit) return fixed;

  const categoryOrder = ["аксессуары", "сумка", "обувь", "низ", "верх"];

  categoryOrder.forEach((category, step) => {
    if (total <= budgetLimit) return;
    const currentIndex = categories.indexOf(category);
    const current = fixed[currentIndex];
    const rawAlternatives = items.filter((product) => product.category === category && product.price < current.price && isAllowedForOccasion(product, data, category));
    const freshAlternatives = rawAlternatives.filter((product) => !usedProducts.has(productKey(product)));
    const alternatives = rankProducts(freshAlternatives.length ? freshAlternatives : rawAlternatives, data, profile, seed + step, lookIndex);
    const replacement = alternatives.find((product) => total - current.price + product.price <= budgetLimit) || alternatives[alternatives.length - 1];
    if (!replacement) return;
    fixed[currentIndex] = replacement;
    total = total - current.price + replacement.price;
  });

  return fixed;
}

function stableScore(value, seed) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), seed);
}

function measurementLine(measurements) {
  const labels = {
    bust: "грудь",
    waist: "талия",
    hips: "бедра"
  };

  return Object.entries(measurements)
    .filter(([, value]) => value)
    .map(([key, value]) => `${labels[key]} ${value} см`)
    .join(", ");
}

function rotate(items, by) {
  return [...items.slice(by), ...items.slice(0, by)];
}

function budgetName(value) {
  return {
    budget: "до 25 000 ₽",
    middle: "25 000–70 000 ₽",
    designer: "70 000–180 000 ₽"
  }[value];
}

function itemCategoryName(value) {
  return {
    верх: "верх образа",
    низ: "низ образа",
    обувь: "обувь",
    сумка: "сумка",
    аксессуары: "аксессуар"
  }[value] || "вещь";
}

function renderResult(record) {
  const stores = connectedStoreNames(record);
  const several = record.looks.length > 1;

  resultState.innerHTML = `
    <p class="result-kicker">${several ? "Образы готовы" : "Образ готов"}</p>
    <h2>${escapeHtml(record.data.occasion)}: ${escapeHtml(record.data.goal)}</h2>
    <p class="summary">
      Бюджет на образ: ${budgetName(record.data.budget)}${record.data.age ? `, возраст ${escapeHtml(record.data.age)}` : ""}.
      Ваша вещь есть в каждом образе, а остальные позиции подобраны из магазинов.
    </p>
    <div class="tags">
      ${record.data.styles.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      ${record.data.colors ? `<span>${escapeHtml(record.data.colors)}</span>` : ""}
      <span>магазины: ${escapeHtml(stores.join(", "))}</span>
    </div>
    ${record.aiNote ? `<div class="note-box">${escapeHtml(record.aiNote)}</div>` : ""}
    ${renderColorProfile(record.analysis)}
    ${several ? renderLookTabs(record) : ""}
    ${record.looks.map((look, index) => renderLook(look, index)).join("")}
    ${renderShoppingSummary(record)}
  `;
}

function renderLookTabs(record) {
  return `
    <div class="look-tabs" role="tablist" aria-label="Образы">
      ${record.looks.map((look, index) => `
        <button type="button" class="look-tab${index === 0 ? " active" : ""}" role="tab" aria-selected="${index === 0}" data-look-tab="${index}">
          <strong>Образ ${index + 1}</strong>
          <span>${escapeHtml(look.name || "")}</span>
          <em data-tab-status="${index}"></em>
        </button>
      `).join("")}
    </div>
  `;
}

function showLook(index) {
  resultState.querySelectorAll("[data-look-card]").forEach((card) => {
    card.hidden = Number(card.dataset.lookCard) !== index;
  });
  resultState.querySelectorAll("[data-look-tab]").forEach((tab) => {
    const active = Number(tab.dataset.lookTab) === index;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function renderColorProfile(analysis) {
  if (!analysis) return "";
  const { person, item } = analysis;
  const chips = (values) => (values || []).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  const itemBlock = item
    ? `<p class="profile-item"><strong>Ваша вещь:</strong> ${escapeHtml(item.description)} · цвет: ${escapeHtml(item.color)} · стиль: ${escapeHtml(item.style)}</p>`
    : "";

  if (!person) return `<section class="color-profile">${itemBlock}</section>`;

  if (!person.visible) {
    return `
      <section class="color-profile">
        <p class="result-kicker">Цветотип</p>
        <p>${escapeHtml(person.comment || "По этому фото не удалось определить цвета. Попробуйте портрет при дневном свете.")}</p>
        ${itemBlock}
      </section>
    `;
  }

  return `
    <section class="color-profile">
      <p class="result-kicker">Ваш цветотип</p>
      <h3>${escapeHtml(person.color_type)}</h3>
      <dl>
        <div><dt>Кожа</dt><dd>${escapeHtml(person.skin_tone)}, подтон: ${escapeHtml(person.undertone)}</dd></div>
        <div><dt>Волосы</dt><dd>${escapeHtml(person.hair_color)}</dd></div>
        <div><dt>Глаза</dt><dd>${escapeHtml(person.eye_color)}</dd></div>
        <div><dt>Контраст</dt><dd>${escapeHtml(person.contrast)}</dd></div>
      </dl>
      <p class="profile-label">Вам идут</p>
      <div class="tags">${chips(person.best_colors)}</div>
      <p class="profile-label">Лучше избегать</p>
      <div class="tags">${chips(person.avoid_colors)}</div>
      <p class="profile-comment">Уверенность анализа: ${escapeHtml(person.confidence)}. ${escapeHtml(person.comment)}</p>
      ${itemBlock}
    </section>
  `;
}

function connectedStoreNames(record) {
  return [...new Set(record.looks.flatMap((look) => look.products.map((product) => product.brand)))].sort();
}

function renderShoppingSummary(record) {
  const stores = [...new Set(record.looks.flatMap((look) => look.products.map((product) => product.brand)))];
  const brief = buildBrief(record);

  return `
    <section class="shopping-summary">
      <div class="summary-head">
        <div>
          <p class="result-kicker">Список покупок</p>
          <h3>${record.looks.length > 1 ? `Образов: ${record.looks.length}` : "Один образ"} · магазинов: ${stores.length}</h3>
        </div>
      </div>
      <div class="shopping-stats">
        ${record.looks.map((look, index) => `<span>Образ ${index + 1} · ${look.products.length} вещи · ${formatPrice(look.total)}</span>`).join("")}
      </div>
      <div class="summary-actions">
        <button class="ghost-button copy-brief" type="button" data-brief="${escapeAttribute(brief)}">Скопировать список</button>
        <a class="primary-link" href="#stylistForm">Собрать новый образ</a>
      </div>
    </section>
  `;
}

function buildBrief(record) {
  const lines = [
    "StyleMate AI: подборка образов",
    `Повод: ${record.data.occasion}`,
    `Количество образов: ${record.looks.length}`,
    `Параметры: ${record.data.size}`,
    `Стратегия: ${record.data.styles.join(", ")}`,
    record.data.colors ? `Цвета: ${record.data.colors}` : "",
    record.data.avoid ? `Исключить: ${record.data.avoid}` : "",
    `Задача: ${record.data.goal}`,
    "",
    "Луки:"
  ].filter(Boolean);

  record.looks.forEach((look, index) => {
    lines.push(`${index + 1}. ${look.title} — ${formatPrice(look.total)}`);
    look.products.forEach((product) => {
      lines.push(`- ${product.category}: ${product.name}, ${product.brand}, ${product.color ? `цвет ${product.color}, ` : ""}арт. ${product.sku}, ${formatPrice(product.price)}, ${product.url}`);
    });
  });

  return lines.join("\n");
}

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderLook(look, index) {
  return `
    <article class="look-card" data-look-card="${index}"${index === 0 ? "" : " hidden"}>
      ${serverStatus.renderConfigured ? `
        <div class="look-visual">
          <div class="render-body" data-render-body="${index}"></div>
        </div>
      ` : ""}
      <div class="look-content">
        <div class="look-head">
          <h3>${escapeHtml(look.title)}</h3>
          <span>${formatPrice(look.total)}</span>
        </div>
        <p class="look-rationale">${escapeHtml(look.rationale)}</p>
        ${renderUserItem(look)}
        <div class="product-grid">
          ${look.products.map(renderProduct).join("")}
        </div>
      </div>
    </article>
  `;
}

function userItemLabel(category) {
  return { верх: "Верх", низ: "Низ", обувь: "Обувь", сумка: "Сумка", аксессуары: "Аксессуар" }[category] || "Вещь";
}

function renderUserItem(look) {
  if (!look.userItem) return "";

  return `
    <div class="user-item-card">
      <img src="${look.userItem.src}" alt="Ваша вещь" />
      <div>
        <small>Ваша вещь</small>
        <strong>${escapeHtml(userItemLabel(look.userItemCategory))}</strong>
        <span>основа этого образа</span>
      </div>
    </div>
  `;
}

function safeLink(url) {
  return /^https?:\/\//i.test(url || "") ? escapeAttribute(url) : "#";
}

function renderProduct(product) {
  const meta = [product.brand, product.color].filter(Boolean).join(" · ");
  return `
    <a class="product-card" href="${safeLink(product.url)}" target="_blank" rel="noreferrer">
      <span class="product-photo">
        ${product.productImage ? `<img src="${safeLink(product.productImage)}" alt="${escapeAttribute(product.name)}" loading="lazy" />` : ""}
      </span>
      <span class="product-info">
        <small>${escapeHtml(product.category)}</small>
        <strong>${escapeHtml(product.name)}</strong>
        <span class="product-meta">${escapeHtml(meta)}</span>
        <span class="product-price">${formatPrice(product.price)}</span>
      </span>
      <span class="product-open">В магазин ↗</span>
    </a>
  `;
}

function formatPrice(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value);
}

function showState(state) {
  [emptyState, loadingState, errorState, resultState].forEach((node) => node.classList.add("hidden"));
  state.classList.remove("hidden");
}

function saveRecord(record) {
  if (!historyList) return;

  const compactRecord = {
    ...record,
    data: {
      ...record.data,
      measurements: { ...record.data.measurements },
      itemPhoto: record.data.itemPhoto ? { name: record.data.itemPhoto.name, src: record.data.itemPhoto.src } : null
    }
  };
  historyItems = [compactRecord, ...historyItems.filter((item) => item.id !== record.id)].slice(0, 5);
  try {
    localStorage.setItem(historyKey, JSON.stringify(historyItems));
  } catch {
    historyItems = [compactRecord];
  }
  renderHistory(record.id);
}

function renderHistory(activeId) {
  if (!historyList) return;

  if (!historyItems.length) {
    historyList.innerHTML = `<p class="form-note">Пока нет сохраненных заявок.</p>`;
    return;
  }

  historyList.innerHTML = historyItems
    .map((record) => {
      const date = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(record.data.createdAt));

      return `
        <button class="history-card ${record.id === activeId ? "active" : ""}" type="button" data-id="${record.id}">
          <strong>${record.data.occasion}</strong>
          <p>${date} · ${budgetName(record.data.budget)}</p>
        </button>
      `;
    })
    .join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = getFormData();
  const validationError = validate(data);

  if (validationError) {
    errorText.textContent = validationError;
    showState(errorState);
    return;
  }

  renderRunId += 1;
  showState(loadingState);
  updateLoadingCopy(
    "Собираю образ",
    "Анализирую загруженную вещь, повод, бюджет и подбираю, с чем ее носить."
  );

  await wait(1200);

  let record;
  let step = "каталог";
  const startedAt = Date.now();
  try {
    updateLoadingCopy("Загружаю каталог", "Получаю список товаров с сервера. Если здесь долго, проблема в связи с сервером.");
    await catalogLoadPromise;
    if (catalogLoadFailed) {
      throw new Error("Не удалось загрузить каталог товаров с сервера. Проверьте интернет и обновите страницу.");
    }
    if (!activeCatalogProducts.length) {
      throw new Error("Каталог товаров сейчас пуст. Попробуйте позже.");
    }

    step = "статус сервера";
    updateLoadingCopy("Проверяю подключение", "Узнаю у сервера, доступен ли ChatGPT.");
    const status = await statusPromise;
    serverStatus = status;
    data.lookCount = status.looksCount || defaultLookCount;
    let ai = null;
    let aiNote = "";

    if (status.aiConfigured) {
      step = "ChatGPT";
      updateLoadingCopy(
        uploadedPersonData.photo ? "ChatGPT анализирует фото" : "ChatGPT подбирает образ",
        "Определяем цвета и подбираем вещи из каталога. Это может занять до минуты."
      );
      try {
        ai = await requestAiLook(data);
      } catch (error) {
        aiNote = `${error.message} Образ подобран по правилам без ChatGPT.`;
      }
    } else if (uploadedPersonData.photo) {
      aiNote = "ChatGPT на сервере не подключён: фото человека не анализировалось, образ подобран по правилам.";
    }

    step = "подбор по правилам";
    record = {
      id: data.id,
      data,
      aiNote,
      analysis: ai?.analysis || null,
      looks: ai ? buildAiLooks(data, ai) : generateLooks(data)
    };

    step = "показ результата";
    renderResult(record);
    saveRecord(record);
    reportClient("submit_ok", {
      мс: Date.now() - startedAt,
      режим: ai ? "ChatGPT" : "правила",
      фото_человека: uploadedPersonData.photo ? "да" : "нет",
      примечание: aiNote
    });
  } catch (error) {
    console.error(error);
    reportClient("submit_error", { шаг: step, сообщение: error.message, мс: Date.now() - startedAt });
    errorText.textContent = error.message;
    showState(errorState);
    return;
  }

  showState(resultState);
  currentRecord = record;
  showLook(0);
  if (serverStatus.renderConfigured) startRenders(record);
});

function setRenderState(session, index, state, payload) {
  if (session !== renderRunId) return;
  const body = resultState.querySelector(`[data-render-body="${index}"]`);
  if (!body) return;
  body.replaceChildren();

  const status = resultState.querySelector(`[data-tab-status="${index}"]`);
  if (status) {
    status.textContent = { loading: "рисуется…", ready: "готов", error: "ошибка" }[state];
    status.dataset.state = state;
  }

  if (state === "loading") {
    const skeleton = document.createElement("div");
    skeleton.className = "render-skeleton";
    const text = document.createElement("p");
    text.className = "render-text";
    text.textContent = "ChatGPT рисует образ на манекене. Обычно это 1–2 минуты. Подборка ниже уже готова, страницу можно не закрывать.";
    body.append(skeleton, text);
  } else if (state === "ready") {
    const image = document.createElement("img");
    image.className = "render-image";
    image.alt = "Образ на манекене. Нажмите, чтобы открыть на весь экран";
    image.src = payload;
    body.append(image);
  } else {
    const text = document.createElement("p");
    text.className = "render-text";
    text.textContent = `Не удалось нарисовать образ: ${payload}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ghost-button";
    retry.dataset.renderRetry = String(index);
    retry.textContent = "Повторить";
    body.append(text, retry);
  }
}

function startRenders(record) {
  const session = ++renderRunId;
  record.looks.forEach((_, index) => runRender(session, record, index));
}

async function requestJson(url, options, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs, options);
  return readJsonResponse(response, "Сервер ответил некорректно.");
}

async function runRender(session, record, index) {
  const look = record.looks[index];
  const startedAt = Date.now();
  setRenderState(session, index, "loading");

  try {
    const started = await requestJson(`${apiBaseUrl}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemPhotoDataUrl: record.data.itemPhoto.src,
        itemCategory: record.data.itemCategory,
        occasion: record.data.occasion,
        productUrls: look.products.map((product) => product.url)
      })
    }, 30000);

    if (started.status === "disabled") {
      resultState.querySelectorAll("[data-render-body]").forEach((node) => node.closest(".look-visual")?.remove());
      return;
    }
    if (started.status !== "pending") throw new Error(started.message || "Генерация не запустилась.");

    let failedPolls = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await wait(3000);
      if (session !== renderRunId) return;

      let job;
      try {
        job = await requestJson(`${apiBaseUrl}/api/render/${started.id}`, {}, 20000);
        failedPolls = 0;
      } catch (error) {
        failedPolls += 1;
        if (failedPolls >= 4) throw error;
        continue;
      }

      if (job.status === "ready") {
        setRenderState(session, index, "ready", job.imageDataUrl);
        reportClient("render_ok", { образ: index + 1, мс: Date.now() - startedAt });
        return;
      }
      if (job.status === "error") throw new Error(job.message || "Генерация не удалась.");
    }
    throw new Error("Генерация идёт слишком долго.");
  } catch (error) {
    reportClient("render_error", { образ: index + 1, сообщение: error.message, мс: Date.now() - startedAt });
    setRenderState(session, index, "error", error.message);
  }
}

resultState.addEventListener("click", (event) => {
  const retry = event.target.closest("[data-render-retry]");
  if (retry && currentRecord) {
    runRender(renderRunId, currentRecord, Number(retry.dataset.renderRetry));
    return;
  }

  const tab = event.target.closest("[data-look-tab]");
  if (tab) {
    showLook(Number(tab.dataset.lookTab));
    return;
  }

  const image = event.target.closest(".render-image");
  if (image) openLightbox(image.src);
});

function openLightbox(src) {
  let box = document.querySelector(".lightbox");
  if (!box) {
    box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    box.innerHTML = `<img alt="Образ на манекене" /><button type="button" aria-label="Закрыть">×</button>`;
    box.addEventListener("click", () => { box.hidden = true; });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") box.hidden = true; });
    document.body.append(box);
  }
  box.querySelector("img").src = src;
  box.hidden = false;
}


async function requestAiLook(data) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 100000);

  try {
    const response = await fetch(`${apiBaseUrl}/api/stylist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        itemPhotoDataUrl: data.itemPhoto.src,
        personPhotoDataUrl: uploadedPersonData.photo?.src || "",
        form: { occasion: data.occasion, budget: data.budget, itemCategory: data.itemCategory, age: data.age }
      })
    });
    const payload = await readJsonResponse(response, "ChatGPT ответил некорректно.");
    if (payload.status !== "ready") throw new Error(payload.message || "ChatGPT недоступен.");
    return payload;
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "ChatGPT отвечает слишком долго." : error.message);
  } finally {
    window.clearTimeout(timer);
  }
}

function buildAiLooks(data, ai) {
  return ai.looks.map((look, index) => ({
    name: look.title,
    title: `Образ ${index + 1}: ${look.title}`,
    products: normalizeCatalogProducts(look.products),
    userItem: data.itemPhoto,
    userItemCategory: data.itemCategory,
    total: look.total,
    budgetLimit: budgetLimits[data.budget],
    rationale: look.rationale
  }));
}

function updateLoadingCopy(title, text) {
  const titleNode = loadingState.querySelector("h2");
  const textNode = loadingState.querySelector("p");
  if (titleNode) titleNode.textContent = title;
  if (textNode) textNode.textContent = text;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

if (historyList) {
  historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    const record = historyItems.find((item) => item.id === button.dataset.id);
    if (!record) return;
    renderResult(record);
    renderHistory(record.id);
    showState(resultState);
  });
}

resultState.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-brief");
  if (!button) return;

  const brief = button.dataset.brief;
  try {
    await navigator.clipboard.writeText(brief);
    button.textContent = "Бриф скопирован";
    window.setTimeout(() => {
      button.textContent = "Скопировать бриф";
    }, 1600);
  } catch {
    button.textContent = "Не удалось скопировать";
  }
});

if (clearHistory) {
  clearHistory.addEventListener("click", () => {
    historyItems = [];
    localStorage.removeItem(historyKey);
    renderHistory();
    showState(emptyState);
  });
}

sampleButton.addEventListener("click", () => {
  document.querySelector("#gender").value = "women";
  document.querySelector("#age").value = "28";
  document.querySelector("#itemCategory").value = "верх";
  document.querySelector("#budget").value = "middle";
  document.querySelector("#occasion").value = "офис и встречи";
});

renderHistory();
