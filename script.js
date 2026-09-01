const telegram = window.Telegram?.WebApp;
if (telegram) {
  telegram.ready();
  telegram.expand();
}

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

const historyKey = "stylemate-ai-history-v4";
const apiBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:8012" : "";
let historyItems = JSON.parse(localStorage.getItem(historyKey) || "[]");
const uploadedItemData = {};
let activeCatalogProducts = [];
let catalogLinksValidated = false;
const catalogLoadPromise = loadProductCatalog();

const defaultLookCount = 1;
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

const catalog = {
  women: {
    budget: [
      item("Бейсболка из хлопка", "Befree", "головной убор", 1299, search("Lamoda", "женская бейсболка хлопок")),
      item("Рубашка свободного кроя", "Zarina", "верх", 3999, "https://zarina.ru/catalog/rubashki/"),
      item("Брюки палаццо", "Befree", "низ", 3499, "https://befree.ru/catalog/women/bryuki/"),
      item("Тренч прямого силуэта", "O'STIN", "верхняя одежда", 7999, search("Ozon", "женский тренч прямой")),
      item("Сумка кросс-боди", "Ozon", "сумка", 3490, search("Ozon", "женская сумка кросс боди")),
      item("Лоферы", "Lamoda", "обувь", 6490, search("Lamoda", "женские лоферы кожаные")),
      item("Серьги-кольца", "Ozon", "аксессуары", 1290, search("Ozon", "серьги кольца минимализм"))
    ],
    middle: [
      item("Платок с графичным принтом", "LIME", "головной убор", 3999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/aksessuary/"),
      item("Берет из шерсти", "12 STOREEZ", "головной убор", 6980, "https://12storeez.com/catalog/zhenskaya-odezhda/aksessuary/"),
      item("Косынка из вискозы", "Ushatava", "головной убор", 5900, "https://ushatava.com/catalog/"),
      item("Рубашка из плотного хлопка", "Gate31", "верх", 8900, "https://gate31.ru/catalog/women/shirts/"),
      item("Трикотажный топ молочного цвета", "LIME", "верх", 4999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/trikotazh/"),
      item("Кардиган с V-вырезом", "LIME", "верх", 6999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/trikotazh/"),
      item("Атласный топ", "Zarina", "верх", 3999, "https://zarina.ru/catalog/topy/"),
      item("Голубая рубашка oversize", "12 STOREEZ", "верх", 12980, "https://12storeez.com/catalog/zhenskaya-odezhda/rubashki/"),
      item("Юбка миди", "12 STOREEZ", "низ", 12980, "https://12storeez.com/catalog/zhenskaya-odezhda/yubki/"),
      item("Атласная юбка миди", "LIME", "низ", 7999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/yubki/"),
      item("Юбка А-силуэта", "Zarina", "низ", 4999, "https://zarina.ru/catalog/yubki/"),
      item("Брюки с защипами", "Gate31", "низ", 12900, "https://gate31.ru/catalog/women/trousers/"),
      item("Прямые джинсы светлого денима", "LIME", "низ", 8999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/dzhinsy/"),
      item("Пальто-халат", "LIME", "верхняя одежда", 17999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/verkhnyaya-odezhda/"),
      item("Кожаная куртка", "Ekonika", "верхняя одежда", 24990, "https://ekonika.ru/catalog/women/clothes/"),
      item("Длинный тренч", "Gate31", "верхняя одежда", 21900, "https://gate31.ru/catalog/women/outerwear/"),
      item("Укороченный жакет", "Zarina", "верхняя одежда", 7999, "https://zarina.ru/catalog/zhakety/"),
      item("Кожаная сумка", "Ekonika", "сумка", 12990, "https://ekonika.ru/catalog/women/bags/"),
      item("Сумка-тоут кремовая", "12 STOREEZ", "сумка", 17980, "https://12storeez.com/catalog/zhenskaya-odezhda/aksessuary/"),
      item("Структурная сумка-тоут", "LIME", "сумка", 7999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/aksessuary/sumki/"),
      item("Мини-сумка бордовая", "LIME", "сумка", 5999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/aksessuary/sumki/"),
      item("Клатч мягкой формы", "Zarina", "сумка", 3999, "https://zarina.ru/catalog/aksessuary/sumki/"),
      item("Балетки с острым мысом", "Lamoda", "обувь", 7990, search("Lamoda", "женские балетки кожаные")),
      item("Лоферы на низком ходу", "LIME", "обувь", 6990, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/obuv/"),
      item("Туфли-лодочки", "Lamoda", "обувь", 8990, search("Lamoda", "женские туфли лодочки")),
      item("Мюли на низком каблуке", "Zarina", "обувь", 4999, "https://zarina.ru/catalog/obuv/"),
      item("Черные ботильоны", "Ekonika", "обувь", 15990, "https://ekonika.ru/catalog/women/boots/"),
      item("Минималистичные кеды", "Lamoda", "обувь", 6990, search("Lamoda", "женские белые кеды кожаные")),
      item("Серьги-акцент", "Avgvst", "аксессуары", 12000, "https://avgvstjewelry.com/catalog/"),
      item("Тонкий ремень", "LIME", "аксессуары", 2999, "https://lime-shop.com/ru_ru/catalog/zhenshchinam/aksessuary/"),
      item("Серебристые серьги", "Avgvst", "аксессуары", 9000, "https://avgvstjewelry.com/catalog/")
    ],
    designer: [
      item("Косынка из шелка", "Ushatava", "головной убор", 8900, "https://ushatava.com/catalog/"),
      item("Топ архитектурного кроя", "NNedre", "верх", 12900, "https://nnedre.ru/catalog/"),
      item("Брюки с защипами", "Gate31", "низ", 15900, "https://gate31.ru/catalog/women/trousers/"),
      item("Тренч с поясом", "All We Need", "верхняя одежда", 32900, "https://allweneed.ru/catalog/verkhnyaya-odezhda/"),
      item("Сумка жесткой формы", "Ekonika", "сумка", 18990, "https://ekonika.ru/catalog/women/bags/"),
      item("Сапоги-трубы", "Ekonika", "обувь", 24990, "https://ekonika.ru/catalog/women/boots/"),
      item("Колье", "Avgvst", "аксессуары", 16000, "https://avgvstjewelry.com/catalog/")
    ]
  },
  men: {
    budget: [
      item("Бейсболка без логотипа", "O'STIN", "головной убор", 1299, search("Ozon", "мужская бейсболка без логотипа")),
      item("Оксфордская рубашка", "Befree", "верх", 2999, "https://befree.ru/catalog/men/rubashki/"),
      item("Чиносы прямого кроя", "O'STIN", "низ", 3499, "https://ostin.com/catalog/muzhchinam/odezhda/bryuki/"),
      item("Куртка-рубашка", "Gloria Jeans", "верхняя одежда", 4999, "https://www.gloria-jeans.ru/c/muzhchinam/odezhda/kurtki/"),
      item("Сумка-планшет", "Ozon", "сумка", 2990, search("Ozon", "мужская сумка планшет")),
      item("Кеды минималистичные", "Lamoda", "обувь", 5990, search("Lamoda", "мужские кеды белые")),
      item("Кожаный ремень", "Ozon", "аксессуары", 2490, search("Ozon", "мужской кожаный ремень"))
    ],
    middle: [
      item("Шапка бини", "LIME", "головной убор", 2999, "https://lime-shop.com/ru_ru/catalog/muzhchinam/"),
      item("Поло из плотного трикотажа", "Finn Flare", "верх", 5999, "https://www.finn-flare.ru/catalog/muzhskie-polo/"),
      item("Брюки relaxed fit", "12 STOREEZ", "низ", 14980, "https://12storeez.com/catalog/muzhskaya-odezhda/bryuki/"),
      item("Пиджак без жесткой конструкции", "LIME", "верхняя одежда", 15999, "https://lime-shop.com/ru_ru/catalog/muzhchinam/"),
      item("Сумка через плечо", "Ozon", "сумка", 4990, search("Ozon", "мужская сумка через плечо кожа")),
      item("Дерби из кожи", "Lamoda", "обувь", 12990, search("Lamoda", "мужские дерби кожаные")),
      item("Часы минималистичные", "Ozon", "аксессуары", 6990, search("Ozon", "мужские часы минималистичные"))
    ],
    designer: [
      item("Шерстяная бини", "Ushatava", "головной убор", 7900, "https://ushatava.com/catalog/"),
      item("Свитер из мериноса", "NNedre", "верх", 16900, "https://nnedre.ru/catalog/"),
      item("Брюки с защипами", "Gate31", "низ", 15900, "https://gate31.ru/catalog/men/trousers/"),
      item("Пальто прямого силуэта", "12 STOREEZ", "верхняя одежда", 59980, "https://12storeez.com/catalog/muzhskaya-odezhda/verkhnyaya-odezhda/"),
      item("Кожаная сумка", "Ekonika Men", "сумка", 19990, "https://ekonika.ru/catalog/men/"),
      item("Лоферы", "Ekonika Men", "обувь", 19990, "https://ekonika.ru/catalog/men/"),
      item("Шарф из шерсти", "Ushatava", "аксессуары", 12900, "https://ushatava.com/catalog/")
    ]
  }
};

const accessibleCatalog = {
  women: {
    budget: [
      item("Бейсболка без логотипа", "Befree", "головной убор", 1299, "https://befree.ru/zhenskaya/product/ShortRibHat5/50"),
      item("Рубашка свободного кроя", "Befree", "верх", 3999, "https://befree.ru/zhenskaya/product/BF2631121018/55"),
      item("Брюки палаццо", "Befree", "низ", 3499, "https://befree.ru/zhenskaya/product/WidePants/50"),
      item("Тренч прямого силуэта", "Love Republic", "верхняя одежда", 7999, "https://loverepublic.ru/catalog/odezhda/verhnyaya-odezhda/292707/"),
      item("Сумка кросс-боди", "Love Republic", "сумка", 3499, "https://loverepublic.ru/catalog/sumki/292612/"),
      item("Лоферы", "Love Republic", "обувь", 4499, "https://loverepublic.ru/catalog/shoes/269822/"),
      item("Серьги-кольца", "Love Republic", "аксессуары", 1299, "https://loverepublic.ru/catalog/ukrasheniya/sergi/304763/")
    ],
    middle: [
      item("Косынка хлопковая в полоску", "Befree", "головной убор", 299, "https://befree.ru/zhenskaya/product/BF2625341011/55", {
        title: "Косынка хлопковая в полоску bf2625341011",
        article: "BF2625341011-55",
        color: "черный",
        visual: "черная хлопковая косынка в тонкую полоску, завязывается у лица или на волосах"
      }),
      item("Шарф узкий", "Befree", "головной убор", 799, "https://befree.ru/zhenskaya/product/BF2635341009/60", {
        title: "Шарф узкий bf2635341009",
        article: "BF2635341009-60",
        color: "молочный",
        visual: "молочный узкий шарф, можно носить как акцент у шеи или волос"
      }),
      item("Платок с вышивкой и кружевом", "Love Republic", "головной убор", 2599, "https://loverepublic.ru/catalog/odezhda/accessory/platki/317645/", {
        title: "Платок с вышивкой и кружевом 644615027-60",
        article: "644615027-60",
        color: "молочный",
        visual: "молочный платок с вышивкой и кружевной отделкой, мягкий женственный акцент у лица",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64461/thumb/150_9999/644615027_60_4.jpg"
      }),
      item("Узкий платок с цветочным узором", "Love Republic", "головной убор", 399, "https://loverepublic.ru/catalog/odezhda/accessory/platki/311601/", {
        title: "Узкий платок с цветочным узором 644415012-99",
        article: "644415012-99",
        color: "мультиколор",
        visual: "узкий платок с цветочным узором, работает как style trick на волосах, шее или сумке",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64441/thumb/150_9999/644415012_99_4.jpg"
      }),
      item("Рубашка оверсайз вискозная в полоску", "Befree", "верх", 2599, "https://befree.ru/zhenskaya/product/BF2631418092/65", {
        title: "Рубашка оверсайз вискозная в полоску bf2631418092",
        article: "BF2631418092-65",
        color: "бежевый",
        visual: "бежево-светлая вискозная рубашка oversize в тонкую полоску"
      }),
      item("Рубашка-манишка хлопковая в клетку", "Befree", "верх", 1999, "https://befree.ru/zhenskaya/product/BF2631418093/65", {
        title: "Рубашка-манишка хлопковая в клетку bf2631418093",
        article: "BF2631418093-65",
        color: "бежевый",
        visual: "бежево-светлая хлопковая рубашка-манишка в клетку"
      }),
      item("Блузка в спортивном стиле", "Befree", "верх", 3599, "https://befree.ru/zhenskaya/product/BF2631418072/16", {
        title: "Блузка в спортивном стиле с воротником-стойкой и карманом bf2631418072",
        article: "BF2631418072-16",
        color: "зеленый",
        visual: "зеленая блузка с воротником-стойкой, одним карманом и свободной посадкой"
      }),
      item("Корсетный топ с шерстью", "Love Republic", "верх", 2599, "https://loverepublic.ru/catalog/odezhda/topy/293949/", {
        title: "Корсетный топ с шерстью 5450008316-32",
        article: "5450008316-32",
        color: "серый",
        visual: "серый корсетный топ с шерстью, четкая линия лифа и подчеркнутая талия",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/54500/thumb/150_9999/5450008316_32_4.jpg"
      }),
      item("Топ молочный", "Love Republic", "верх", 3599, "https://loverepublic.ru/catalog/odezhda/bluzy/298716/", {
        title: "Топ 6151012399-60",
        article: "6151012399-60",
        color: "молочный",
        visual: "молочный лаконичный топ, чистая летняя база под брюки, юбку и акцентные аксессуары",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/61510/thumb/150_9999/6151012399_60.jpg"
      }),
      item("Базовая хлопковая рубашка", "MAAG", "верх", 5999, "https://maag-fashion.com/product/zhenskaya-bazovaya-rubashka-iz-khlopka-s-karmanom-lavanda-w2400401/", {
        title: "Женская базовая рубашка из хлопка с карманом W2400401",
        article: "W2400401",
        color: "лаванда",
        visual: "светлая хлопковая рубашка regular с карманом, подходит для офиса и мягкого smart casual"
      }),
      item("Рубашка oversize в полоску", "MAAG", "верх", 7999, "https://maag-fashion.com/product/zhenskaya-rubashka-oversayz-v-polosku-s-karmanom-seryy-w2602009/", {
        title: "Женская рубашка оверсайз в полоску с карманом W2602009",
        article: "W2602009",
        color: "серый",
        visual: "серая рубашка oversize в полоску, расслабленная вертикаль и дорогая городская база"
      }),
      item("Хлопковая рубашка regular в полоску", "MAAG", "верх", 7999, "https://maag-fashion.com/product/zhenskaya-khlopkovaya-rubashka-regular-v-polosku-korichnevyy-w2602025/", {
        title: "Женская хлопковая рубашка regular в полоску W2602025",
        article: "W2602025",
        color: "коричневый",
        visual: "коричневая хлопковая рубашка regular в тонкую полоску, спокойная деловая фактура"
      }),
      item("Топ из модала", "Incanto", "верх", 3999, "https://incanto.eu/products/top_pd76/", {
        title: "Топ INCANTO PD76",
        article: "PD76",
        color: "молочный",
        visual: "молочный лаконичный топ из мягкого модала, база под вечерний или повседневный образ"
      }),
      item("Брюки прямые костюмные", "Befree", "низ", 3599, "https://befree.ru/zhenskaya/product/BF2631308035/38", {
        title: "Брюки прямые костюмные со средней посадкой bf2631308035",
        article: "BF2631308035-38",
        color: "серый",
        visual: "серые прямые костюмные брюки со средней посадкой"
      }),
      item("Брюки прямые из искусственной кожи", "Befree", "низ", 4599, "https://befree.ru/zhenskaya/product/BF2631308037PL/26", {
        title: "Брюки прямые из искусственной кожи под крокодила bf2631308037pl",
        article: "BF2631308037PL-26",
        color: "коричневый",
        visual: "коричневые прямые брюки из искусственной кожи с фактурой под крокодила"
      }),
      item("Юбка прямая миди костюмная", "Befree", "низ", 3599, "https://befree.ru/zhenskaya/product/BF2631312034/38", {
        title: "Юбка прямая миди костюмная с разрезом bf2631312034",
        article: "BF2631312034-38",
        color: "серый",
        visual: "серая прямая костюмная юбка миди с аккуратным разрезом"
      }),
      item("Брюки из экозамши", "Love Republic", "низ", 2599, "https://loverepublic.ru/catalog/odezhda/bryuki/293677/", {
        title: "Брюки из экозамши 5450113713-3",
        article: "5450113713-3",
        color: "молочный",
        visual: "молочные брюки из экозамши, мягкая фактура и спокойная посадка",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/54501/thumb/150_9999/5450113713_3_4.jpg"
      }),
      item("Джинсы wide leg", "Gloria Jeans", "низ", 3999, "https://www.gloria-jeans.ru/product/GJN028391-1/dzhinsy-wide-leg", {
        title: "Джинсы wide leg GJN028391-1",
        article: "GJN028391-1",
        color: "голубой деним",
        visual: "светло-голубые джинсы wide leg, повседневная база без тяжести"
      }),
      item("Юбка-шорты мини из тенсела", "Befree", "низ", 1299, "https://befree.ru/zhenskaya/product/BF2621312040/50", {
        title: "Юбка-шорты мини из тенсела с асимметричным низом bf2621312040",
        article: "BF2621312040-50",
        color: "черный",
        visual: "черная короткая юбка-шорты мини из легкого тенсела с асимметричным низом и кружевной отделкой"
      }),
      item("Мини-юбка джинсовая ванильная", "Befree", "низ", 1599, "https://befree.ru/zhenskaya/product/BF2621212012/2", {
        title: "Юбка джинсовая мини с узором bf2621212012",
        article: "BF2621212012-2",
        color: "ванильный",
        visual: "ванильная джинсовая мини-юбка прямого кроя из легкого хлопкового денима с фактурным узором"
      }),
      item("Джинсовые мини-шорты", "Befree", "низ", 1599, "https://befree.ru/zhenskaya/product/2421111010/50", {
        title: "Шорты женские Befree 2421111010",
        article: "2421111010-50",
        color: "черный",
        visual: "черные летние мини-шорты свободнее по бедру, повседневная альтернатива джинсам"
      }),
      item("Прямые брюки", "O'STIN", "низ", 3599, "https://ostin.com/product/pryamye-bryuki-33864030299", {
        title: "Прямые брюки 33864030299",
        article: "33864030299",
        color: "черный",
        visual: "черные прямые брюки, чистая линия для офиса и городских встреч"
      }),
      item("Ветровка оверсайз молочная", "Befree", "верхняя одежда", 4599, "https://befree.ru/zhenskaya/product/BF2631601019/60", {
        title: "Ветровка оверсайз с воротником-стойкой и скрытым капюшоном bf2631601019",
        article: "BF2631601019-60",
        color: "молочный",
        visual: "молочная ветровка oversize с воротником-стойкой и скрытым капюшоном"
      }),
      item("Ветровка оверсайз черная", "Befree", "верхняя одежда", 4599, "https://befree.ru/zhenskaya/product/BF2631601019/50", {
        title: "Ветровка оверсайз с воротником-стойкой и скрытым капюшоном bf2631601019",
        article: "BF2631601019-50",
        color: "черный",
        visual: "черная ветровка oversize с воротником-стойкой и скрытым капюшоном"
      }),
      item("Плащ с высоким воротником", "Love Republic", "верхняя одежда", 7599, "https://loverepublic.ru/catalog/odezhda/verhnyaya-odezhda/trenchi_plaschi/309754/", {
        title: "Плащ с высоким воротником 6254512112-192",
        article: "6254512112-192",
        color: "темно-синий",
        visual: "темно-синий плащ с высоким воротником, вертикаль и собранная деловая линия",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/62545/thumb/150_9999/6254512112_192.jpg"
      }),
      item("Бомбер из шерсти", "Love Republic", "верхняя одежда", 4999, "https://loverepublic.ru/catalog/odezhda/verhnyaya-odezhda/kurtki/307282/", {
        title: "Бомбер из шерсти 6153503103-26",
        article: "6153503103-26",
        color: "коричневый",
        visual: "коричневый шерстяной бомбер, мягкий объем и игра пропорций",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/61535/thumb/150_9999/6153503103_26.jpg"
      }),
      item("Жакет прямого кроя", "O'STIN", "верхняя одежда", 5999, "https://ostin.com/product/zhaket-pryamogo-kroya-33864010299", {
        title: "Жакет прямого кроя 33864010299",
        article: "33864010299",
        color: "темно-синий",
        visual: "темно-синий прямой жакет, структурирует офисный образ без тяжелого костюма"
      }),
      item("Сумка-тоут из искусственной кожи", "Befree", "сумка", 4599, "https://befree.ru/zhenskaya/product/BF2635457040/93", {
        title: "Сумка-тоут из искусственной кожи с замком и ключиком bf2635457040",
        article: "BF2635457040-93",
        color: "розовый",
        visual: "розовая структурная сумка-тоут из искусственной кожи с замком и ключиком"
      }),
      item("Сумка-клатч большая", "Befree", "сумка", 2299, "https://befree.ru/zhenskaya/product/BF2635457034/43", {
        title: "Сумка-клатч большая из искусственной кожи bf2635457034",
        article: "BF2635457034-43",
        color: "голубой",
        visual: "голубой большой клатч из искусственной кожи"
      }),
      item("Сумка из натуральной замши", "Love Republic", "сумка", 9999, "https://loverepublic.ru/catalog/sumki/306536/", {
        title: "Сумка из натуральной замши 644220007",
        article: "644220007",
        color: "коричневый",
        visual: "коричневая сумка из натуральной замши, мягкая фактура и статусный повседневный акцент",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64422/thumb/150_9999/644220007_27_4.jpg"
      }),
      item("Сумка из лакированной экокожи", "Love Republic", "сумка", 4999, "https://loverepublic.ru/catalog/sumki/324382/", {
        title: "Сумка из лакированной экокожи 644820042",
        article: "644820042",
        color: "бордовый",
        visual: "бордовая лакированная сумка, выразительный акцент и тренд на блеск",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64482/thumb/150_9999/644820042_22_4.jpg"
      }),
      item("Сумка через плечо", "Kari", "сумка", 2999, "https://kari.com/product/25447640/", {
        title: "Сумка женская Kari 25447640",
        article: "25447640",
        color: "бежевый",
        visual: "бежевая сумка через плечо, спокойный светлый аксессуар для casual"
      }),
      item("Лаконичная сумка", "Ekonika", "сумка", 12990, "https://ekonika.ru/product/en33142-black-23l/", {
        title: "Сумка Ekonika EN33142",
        article: "EN33142",
        color: "черный",
        visual: "черная лаконичная сумка жесткой формы, поддерживает деловой и вечерний образ"
      }),
      item("Балетки сетчатые с ремешком", "Befree", "обувь", 2299, "https://befree.ru/zhenskaya/product/BF2636682003/1", {
        title: "Балетки сетчатые с ремешком bf2636682003",
        article: "BF2636682003-1",
        color: "белый",
        visual: "белые сетчатые балетки с тонким ремешком"
      }),
      item("Балетки с ремешком на лодыжке", "Befree", "обувь", 2299, "https://befree.ru/zhenskaya/product/BF2626682018/50", {
        title: "Балетки из искусственной кожи с ремешком на лодыжке bf2626682018",
        article: "BF2626682018-50",
        color: "черный",
        visual: "черные балетки из искусственной кожи с ремешком на лодыжке"
      }),
      item("Мюли на каблуке", "Befree", "обувь", 2999, "https://befree.ru/zhenskaya/product/BF2636682009/50", {
        title: "Мюли на каблуке из искусственной кожи bf2636682009",
        article: "BF2636682009-50",
        color: "черный",
        visual: "черные мюли на каблуке из искусственной кожи"
      }),
      item("Ботильоны из натуральной замши", "Love Republic", "обувь", 11999, "https://loverepublic.ru/catalog/shoes/311114/", {
        title: "Ботильоны из натуральной замши 644270021",
        article: "644270021",
        color: "коричневый",
        visual: "коричневые ботильоны из натуральной замши, устойчивый силуэт и фактурная база",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64427/thumb/150_9999/644270021_27_4.jpg"
      }),
      item("Сандалии из натуральной замши", "Love Republic", "обувь", 8599, "https://loverepublic.ru/catalog/shoes/312906/", {
        title: "Сандалии из натуральной замши 644470022",
        article: "644470022",
        color: "коричневый",
        visual: "коричневые замшевые сандалии, мягкая летняя фактура",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64447/thumb/150_9999/644470022_20_4.jpg"
      }),
      item("Лоферы кожаные", "Ralf Ringer", "обувь", 7990, "https://ralf.ru/catalog/693102ns/", {
        title: "Лоферы женские Ralf Ringer 693102НС",
        article: "693102НС",
        color: "черный",
        visual: "черные кожаные лоферы, деловая база с плотной устойчивой линией"
      }),
      item("Балетки кожаные", "Ekonika", "обувь", 9990, "https://ekonika.ru/product/en6344-01-black-23l/", {
        title: "Балетки Ekonika EN6344-01",
        article: "EN6344-01",
        color: "черный",
        visual: "черные кожаные балетки с аккуратным мысом, женственная альтернатива лодочкам"
      }),
      item("Сандалии на плоском ходу", "Kari", "обувь", 2999, "https://kari.com/product/26780410/", {
        title: "Сандалии женские Kari 26780410",
        article: "26780410",
        color: "молочный",
        visual: "молочные сандалии на плоском ходу, легкая повседневная обувь"
      }),
      item("Серьги-гвоздики золотистые", "Befree", "аксессуары", 499, "https://befree.ru/zhenskaya/product/BF2635551060/6", {
        title: "Серьги-гвоздики золотистые в виде капель bf2635551060",
        article: "BF2635551060-6",
        color: "золотистый",
        visual: "золотистые серьги-гвоздики в форме капель"
      }),
      item("Серьги-полукольца серебристые", "Befree", "аксессуары", 399, "https://befree.ru/zhenskaya/product/BF2635551075/7", {
        title: "Серьги-полукольца серебристые bf2635551075",
        article: "BF2635551075-7",
        color: "серебристый",
        visual: "серебристые серьги-полукольца"
      }),
      item("Круглые серьги-пусеты", "Love Republic", "аксессуары", 1599, "https://loverepublic.ru/catalog/ukrasheniya/sergi/322762/", {
        title: "Круглые серьги-пусеты 644548029",
        article: "644548029",
        color: "золотистый",
        visual: "круглые золотистые серьги-пусеты, чистый акцент у лица",
        productImage: "https://imgcdn.loverepublic.ru/upload/images/64454/thumb/150_9999/644548029_99.jpg"
      })
    ],
    designer: [
      item("Платок шелковистый", "Love Republic", "головной убор", 3999, "https://loverepublic.ru/catalog/odezhda/accessory/platki/276434/"),
      item("Топ архитектурного кроя", "Love Republic", "верх", 9999, "https://loverepublic.ru/catalog/odezhda/topy/290297/"),
      item("Брюки с защипами", "Love Republic", "низ", 11999, "https://loverepublic.ru/catalog/odezhda/bryuki/300375/"),
      item("Пальто прямого силуэта", "Love Republic", "верхняя одежда", 24999, "https://loverepublic.ru/catalog/odezhda/verhnyaya-odezhda/292707/"),
      item("Сумка жесткой формы", "Love Republic", "сумка", 18990, "https://loverepublic.ru/catalog/sumki/298014/"),
      item("Сапоги-трубы", "Love Republic", "обувь", 24990, "https://loverepublic.ru/catalog/shoes/298938/"),
      item("Акцентные серьги", "Love Republic", "аксессуары", 2999, "https://loverepublic.ru/catalog/ukrasheniya/sergi/304765/")
    ]
  },
  men: {
    budget: [
      item("Бейсболка без логотипа", "O'STIN", "головной убор", 1299, "https://ostin.com/catalog/muzhchinam/aksessuary/"),
      item("Оксфордская рубашка", "Befree", "верх", 2999, "https://befree.ru/catalog/men/rubashki/"),
      item("Чиносы прямого кроя", "O'STIN", "низ", 3499, "https://ostin.com/catalog/muzhchinam/odezhda/bryuki/"),
      item("Куртка-рубашка", "Gloria Jeans", "верхняя одежда", 4999, "https://www.gloria-jeans.ru/c/muzhchinam/odezhda/kurtki/"),
      item("Сумка-планшет", "Kari", "сумка", 2999, "https://kari.com/catalog/muzhchinam/sumki/"),
      item("Кеды минималистичные", "Kari", "обувь", 3999, "https://kari.com/catalog/muzhchinam/obuv/"),
      item("Кожаный ремень", "O'STIN", "аксессуары", 1999, "https://ostin.com/catalog/muzhchinam/aksessuary/")
    ],
    middle: [
      item("Бини", "MAAG", "головной убор", 2499, "https://maag-fashion.com/catalog/aksessuary/"),
      item("Поло из плотного трикотажа", "O'STIN", "верх", 3999, "https://ostin.com/catalog/muzhchinam/odezhda/futbolki-i-polo/"),
      item("Рубашка relaxed fit", "Befree", "верх", 3999, "https://befree.ru/catalog/men/rubashki/"),
      item("Брюки relaxed fit", "MAAG", "низ", 8999, "https://maag-fashion.com/catalog/muzhchinam/odezhda/bryuki/"),
      item("Джинсы прямого кроя", "Gloria Jeans", "низ", 3999, "https://www.gloria-jeans.ru/c/muzhchinam/odezhda/dzhinsy/"),
      item("Пиджак без жесткой конструкции", "MAAG", "верхняя одежда", 14999, "https://maag-fashion.com/catalog/muzhchinam/odezhda/"),
      item("Сумка через плечо", "Kari", "сумка", 4999, "https://kari.com/catalog/muzhchinam/sumki/"),
      item("Дерби из кожи", "Ralf Ringer", "обувь", 12990, "https://ralf.ru/catalog/muzhskaya-obuv/"),
      item("Часы минималистичные", "Kari", "аксессуары", 3999, "https://kari.com/catalog/aksessuary/")
    ],
    designer: [
      item("Шерстяная бини", "MAAG", "головной убор", 3999, "https://maag-fashion.com/catalog/aksessuary/"),
      item("Свитер из мериноса", "MAAG", "верх", 9999, "https://maag-fashion.com/catalog/muzhchinam/odezhda/trikotazh/"),
      item("Брюки с защипами", "MAAG", "низ", 11999, "https://maag-fashion.com/catalog/muzhchinam/odezhda/bryuki/"),
      item("Пальто прямого силуэта", "MAAG", "верхняя одежда", 24999, "https://maag-fashion.com/catalog/muzhchinam/odezhda/verkhnyaya-odezhda/"),
      item("Кожаная сумка", "Kari", "сумка", 8999, "https://kari.com/catalog/muzhchinam/sumki/"),
      item("Лоферы", "Ralf Ringer", "обувь", 14990, "https://ralf.ru/catalog/muzhskaya-obuv/"),
      item("Шарф из шерсти", "O'STIN", "аксессуары", 2999, "https://ostin.com/catalog/muzhchinam/aksessuary/")
    ]
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

if (itemInput && itemPreview) {
  itemInput.addEventListener("change", async () => {
    const file = itemInput.files[0];
    if (!file) {
      delete uploadedItemData.photo;
      itemPreview.removeAttribute("src");
      itemPreview.classList.remove("visible");
      return;
    }

    try {
      const optimizedSrc = await optimizePhotoForTryOn(file);
      uploadedItemData.photo = {
        name: file.name,
        src: optimizedSrc
      };
      itemPreview.src = optimizedSrc;
      itemPreview.classList.add("visible");
    } catch {
      errorText.textContent = "Не удалось подготовить фото вещи. Попробуйте JPG/PNG без сильного размытия.";
      showState(errorState);
    }
  });
}

function optimizePhotoForTryOn(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", reject);
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", reject);
      image.addEventListener("load", () => {
        const maxSide = 1600;
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

function item(name, brand, category, price, url, facts = {}) {
  return {
    name: facts.title || name,
    displayName: name,
    brand,
    category,
    price,
    url,
    sku: facts.article || extractSku(url),
    exactUrl: isExactProductUrl(url),
    color: facts.color || "",
    visual: facts.visual || "",
    productImage: facts.productImage || getBefreeProductImage(url),
    inStock: facts.inStock !== false
  };
}

function search(store, query) {
  const encoded = encodeURIComponent(query);
  const links = {
    Lamoda: `https://www.lamoda.ru/catalogsearch/result/?q=${encoded}`,
    Ozon: `https://www.ozon.ru/search/?text=${encoded}`,
    Wildberries: `https://www.wildberries.ru/catalog/0/search.aspx?search=${encoded}`
  };
  return links[store] || `https://www.google.com/search?q=${encoded}`;
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

async function loadProductCatalog() {
  const live = await loadCatalogFile("data/live-catalog.json");
  const liveProducts = normalizeCatalogProducts(live?.products || []);
  if (hasCompleteProductSet(liveProducts.filter((product) => product.inStock))) {
    activeCatalogProducts = liveProducts;
    return activeCatalogProducts;
  }

  const curated = await loadCatalogFile("data/curated-catalog.json");
  activeCatalogProducts = normalizeCatalogProducts(curated?.products || []);
  return activeCatalogProducts;
}

async function loadCatalogFile(path) {
  try {
    const response = await fetch(`${apiBaseUrl}/${path}`);
    if (!response.ok) return null;
    return await readJsonResponse(response, `Не удалось прочитать ${path}.`);
  } catch {
    return null;
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

async function validateActiveCatalogProducts() {
  if (catalogLinksValidated) return;
  if (!activeCatalogProducts.length) {
    activeCatalogProducts = normalizeCatalogProducts(accessibleCatalog.women.middle || []);
  }

  activeCatalogProducts = activeCatalogProducts.map((product) => ({
    ...product,
    linkOk: product.linkOk !== false
  }));
  catalogLinksValidated = true;
  return;

  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api/validate-products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        products: activeCatalogProducts.map((product) => ({
          key: productKey(product),
          sku: product.sku,
          url: product.url,
          brand: product.brand,
          name: product.name
        }))
      })
    });
  } catch {
    throw new Error("Запрос проверки товаров не дошел до backend. Откройте сервис по http://127.0.0.1:8012/ai-online-stylist/ и убедитесь, что node server.mjs запущен.");
  }

  const payload = await readJsonResponse(
    response,
    "Backend проверки товаров не ответил корректно. Откройте сервис по http://127.0.0.1:8012/ai-online-stylist/ и обновите страницу."
  );
  if (!response.ok || payload.status !== "ready") {
    throw new Error(payload.message || "Не удалось проверить товарные ссылки. Backend должен быть открыт по http://127.0.0.1:8012/ai-online-stylist/.");
  }

  const statusByKey = new Map((payload.results || []).map((result) => [result.key, result]));
  activeCatalogProducts = activeCatalogProducts.map((product) => {
    const status = statusByKey.get(productKey(product));
    return {
      ...product,
      linkOk: Boolean(status?.ok),
      linkStatus: status?.status || 0,
      linkReason: status?.reason || "not-checked",
      url: status?.ok && status.finalUrl ? status.finalUrl : product.url
    };
  });
  catalogLinksValidated = true;

  const validCount = activeCatalogProducts.filter((product) => product.linkOk).length;
  if (validCount < 5) {
    throw new Error("После проверки осталось слишком мало рабочих товарных ссылок. Нужно обновить каталог конкретными карточками, которые реально открываются в магазинах.");
  }
}

function validate(data) {
  if (!data.itemPhoto) {
    return "Загрузите фото вещи, вокруг которой нужно собрать аутфиты.";
  }

  return "";
}

function generateLooks(data) {
  const genderKey = data.gender === "men" ? "men" : "women";
  const catalogItems = genderKey === "women"
    ? activeCatalogProducts
    : accessibleCatalog[genderKey][data.budget];
  const baseItems = catalogItems.filter((product) => product.exactUrl && product.inStock && product.linkOk !== false);
  if (!hasCompleteProductSet(baseItems)) {
    throw new Error("Не загрузился каталог конкретных товаров. Откройте сервис по ссылке http://127.0.0.1:8012/ai-online-stylist/ и обновите страницу, чтобы образы собирались только из точных карточек магазинов.");
  }
  const avoid = data.avoid.toLowerCase();
  const pool = baseItems.filter((product) => !avoid || !product.name.toLowerCase().includes(avoid)) || baseItems;
  const styleLine = data.styles.join(", ");
  const palette = data.colors || "нейтральная база, деним, черный и один глубокий акцент";
  const profile = occasionProfiles[data.occasion] || occasionProfiles["повседневная одежда"];
  const budgetLimit = budgetLimits[data.budget] || budgetLimits.middle;
  const lookCount = Math.min(data.lookCount || 1, 1);
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
      title: `Лук ${index + 1}: ${type.name} · ${styleLine}`,
      products: outfitProducts,
      userItem: data.itemPhoto,
      userItemCategory: data.itemCategory,
      total,
      budgetLimit,
      trendStrategy,
      diversityBrief,
      size: data.size,
      measurements: data.measurements,
      rationale: `Лук строится вокруг загруженной вещи: ${data.itemPhoto.name}. Это ${itemCategoryName(data.itemCategory)}, поэтому сервис добирает к ней остальные части образа из магазинов. Категория "${data.occasion}", лимит ${formatPrice(budgetLimit)} на один образ: вещи держат ${profile.mood}. Тренд-опора SS26: ${trendStrategy}. Палитра: ${palette}. ${styleMethodNote} Задача: ${data.goal}.`
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

function isExactProductUrl(url) {
  return /\/product\/(?:[^/]+\/)*[^/?]+\/?(\?.*)?$/.test(url)
    || /\/products\/[^/?]+\/?(\?.*)?$/.test(url)
    || /ralf\.ru\/catalog\/[a-z0-9]+\/?$/i.test(url)
    || /\/catalog\/.+\/\d+\/?$/.test(url);
}

function extractSku(url) {
  const befreeMatch = url.match(/\/product\/([^/]+)\/([^/]+)\/?$/);
  if (befreeMatch) return `${befreeMatch[1]}-${befreeMatch[2]}`;

  const catalogMatch = url.match(/\/(\d+)\/?$/);
  if (catalogMatch) return catalogMatch[1];

  return "нужен фид";
}

function getBefreeProductImage(url) {
  const match = url.match(/befree\.ru\/zhenskaya\/product\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return "";
  const [, article, colorCode] = match;
  return `https://imgcdn.befree.ru/rest/V1/images/1024/product/images/${article}/${article}_${colorCode}_1.jpg`;
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

function genderName(value) {
  return {
    women: "женская примерка",
    men: "мужская примерка",
    unisex: "универсальная примерка"
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

  resultState.innerHTML = `
    <p class="result-kicker">Образ готов</p>
    <h2>${record.data.occasion}: ${record.data.goal}</h2>
    <p class="summary">
      ${genderName(record.data.gender)}${record.data.age ? `, возраст ${record.data.age}` : ""}, бюджет ${budgetName(record.data.budget)}.
      Загруженная вещь используется как основа каждого лука, а из магазинов добираются остальные позиции.
    </p>
    <div class="tags">
      ${record.data.styles.map((tag) => `<span>${tag}</span>`).join("")}
      ${record.data.colors ? `<span>${record.data.colors}</span>` : ""}
      <span>магазины: ${stores.join(", ")}</span>
    </div>
    ${record.looks.map(renderLook).join("")}
    ${renderShoppingSummary(record)}
    <div class="note-box">
      Сейчас сервис берет вещи только из магазинов с конкретными карточками товаров: ${stores.join(", ")}.
      LIME, Mango и 12 STOREEZ лучше добавлять через фид или API, чтобы не получать ссылки на разделы и 404.
    </div>
  `;
}

function connectedStoreNames(record) {
  return [...new Set(record.looks.flatMap((look) => look.products.map((product) => product.brand)))].sort();
}

function renderShoppingSummary(record) {
  const products = record.looks.flatMap((look) => look.products);
  const total = products.reduce((sum, product) => sum + product.price, 0);
  const stores = [...new Set(products.map((product) => product.brand))];
  const brief = buildBrief(record);

  return `
    <section class="shopping-summary">
      <div class="summary-head">
        <div>
          <p class="result-kicker">Список покупок</p>
          <h3>${products.length} вещей · ${stores.length} магазинов</h3>
        </div>
        <strong>${formatPrice(total)}</strong>
      </div>
      <div class="shopping-stats">
        <span>Посадка рассчитана по фото</span>
        <span>Наличие онлайн отмечено</span>
        <span>Карточки товаров + артикулы</span>
      </div>
      <div class="summary-actions">
        <button class="ghost-button copy-brief" type="button" data-brief="${escapeAttribute(brief)}">Скопировать бриф</button>
        <a class="primary-link" href="#stylistForm">Создать новую заявку</a>
      </div>
    </section>
  `;
}

function buildBrief(record) {
  const lines = [
    "StyleMate AI: заявка на примерку",
    `Повод: ${record.data.occasion}`,
    "Количество образов: 1",
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

function renderLook(look) {
  return `
    <article class="look-card">
      <div class="look-content">
        <div class="look-head">
          <h3>${look.title}</h3>
          <span>${formatPrice(look.total)}</span>
        </div>
        <p>${look.rationale}</p>
        ${renderUserItem(look)}
        <div class="item-list">
          ${look.products.map(renderProduct).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderUserItem(look) {
  if (!look.userItem) return "";

  return `
    <div class="user-item-card">
      <img src="${look.userItem.src}" alt="Загруженная вещь" />
      <div>
        <small>Вещь пользователя</small>
        <strong>${escapeHtml(look.userItem.name)}</strong>
        <span>обязательная основа этого аутфита</span>
      </div>
    </div>
  `;
}

function renderProduct(product) {
  return `
    <div class="item-line">
      ${product.productImage ? `<img class="item-thumb" src="${product.productImage}" alt="${product.name}" loading="lazy" />` : ""}
      <div>
        <small>${product.category}</small>
        <strong>${product.name}</strong>
        <em>${product.color ? `цвет: ${product.color} · ` : ""}арт. ${product.sku}</em>
      </div>
      <span>${product.brand} · ${formatPrice(product.price)}</span>
    </div>
    <div class="availability-row">
      <span>Размер подходит</span>
      <span>В наличии онлайн</span>
    </div>
    <a class="buy-link" href="${product.url}" target="_blank" rel="noreferrer">Открыть товар</a>
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

  showState(loadingState);
  updateLoadingCopy(
    "Собираю образ",
    "Анализирую загруженную вещь, повод, бюджет и подбираю, с чем ее носить."
  );

  await wait(1200);

  let record;
  try {
    await catalogLoadPromise;
    updateLoadingCopy(
      "Проверяю товарные ссылки",
      "Открываю карточки магазинов и убираю товары, которые дают 404 или страницу «не найдена»."
    );
    await validateActiveCatalogProducts();
    record = {
      id: data.id,
      data,
      looks: generateLooks(data)
    };
  } catch (error) {
    errorText.textContent = error.message;
    showState(errorState);
    return;
  }

  renderResult(record);
  saveRecord(record);
  showState(resultState);
});

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
