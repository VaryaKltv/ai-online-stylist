# API Contract

Черновой контракт для backend-версии StyleMate AI.

## POST `/api/style-requests`

Создает заявку на генерацию примерок.

### Request

```json
{
  "customer": {
    "phone": "+7 999 000-00-00",
    "telegram": "@style_client"
  },
  "profile": {
    "gender": "women",
    "size": "168 см, S-M, обувь 38",
    "measurements": {
      "bust": 88,
      "waist": 66,
      "hips": 94
    }
  },
  "preferences": {
    "occasion": "офис и встречи",
    "lookCount": 3,
    "budget": "middle",
    "styles": ["минимализм", "smart casual", "дизайнерский акцент"],
    "colors": "молочный, графит, шалфей, бордо",
    "avoid": "тонкий трикотаж, слишком яркий принт",
    "goal": "выглядеть дороже и собраннее"
  },
  "photos": {
    "front": "file-id-front"
  }
}
```

### Response

```json
{
  "requestId": "sty_123",
  "status": "ready",
  "looks": [
    {
      "id": "look_1",
      "title": "Лук 1: Собранный день",
      "renderUrl": "https://cdn.example.com/renders/look_1.png",
      "total": 76858,
      "products": [
        {
          "category": "верх",
          "name": "Рубашка из плотного хлопка",
          "brand": "Gate31",
          "price": 8900,
          "size": "M",
          "inStock": true,
          "productUrl": "https://example.com/product"
        }
      ]
    }
  ]
}
```

## Production Notes

- Фото должны храниться как приватные объекты и удаляться по политике хранения.
- `renderUrl` должен вести на готовый фотореалистичный результат именно загруженного пользователя, а не на общий demo-render.
- Если render еще не готов, backend должен вернуть статус `queued` или `processing`, а frontend не должен показывать чужого человека как результат.
- `productUrl` должен быть прямой ссылкой на карточку товара с выбранным размером, если магазин поддерживает deep link.
- Проверка размеров должна учитывать размерную сетку бренда, а не только S/M/L.

## Local Prototype

Локальный `server.mjs` не генерирует фотореалистичные примерки — сервис собирает образ из карточек товаров каталога (`data/curated-catalog.json` / `data/live-catalog.json`) вокруг загруженной пользователем вещи, без обращения к внешним AI-сервисам.
