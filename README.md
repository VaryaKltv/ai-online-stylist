# StyleMate AI

Рабочий прототип онлайн-стилиста без загрузки фотографий и без API-ключей. Пользователь выбирает бюджет и один из трех сценариев, а сервис возвращает 3 разные подборки вещей с прямыми ссылками на товары.

## Что есть

- мобильный премиальный интерфейс в черно-белой гамме;
- анкета без фото, телефона, мерок и OpenAI API key;
- выбор аудитории: только `Девушка / женщина`;
- 3 сценария: офис и встречи, повседневная одежда, вечерние наряды;
- подборка из 3 разных луков;
- каждый лук состоит из верха, низа, сумки, обуви и аксессуаров;
- карточки товаров с брендом, ценой, цветом, артикулом и ссылкой;
- общий список покупок и копирование текстового списка;
- состояния пустого результата, загрузки и ошибки;
- простой Node.js server для локального запуска и Timeweb health check.

## Запуск

```bash
cd ai-online-stylist
npm start
```

Откройте:

```text
http://127.0.0.1:8012/ai-online-stylist/
```

Переменные окружения не нужны. Файл `.env` для этой версии не используется и не должен загружаться в GitHub.

## Timeweb

Настройки приложения:

- Environment: `Node.js`
- Framework: `Express` или `Node.js`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/status`
- Environment variables: не добавлять

## Каталог

Основной каталог лежит в:

```text
data/curated-catalog.json
```

Если нужно добавить новые магазины или заменить товар, добавьте карточку товара в этот файл. Чем точнее `url`, `name`, `color`, `visual` и `image`, тем честнее будет подборка.

## Структура

```text
ai-online-stylist/
├── index.html
├── styles.css
├── script.js
├── server.mjs
├── package.json
├── README.md
├── data/
│   ├── brand-sources.json
│   ├── curated-catalog.json
│   └── live-catalog.json
├── tools/
│   └── catalog-sync.mjs
└── assets/
    └── stylist-hero.png
```
