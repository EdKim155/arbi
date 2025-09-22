# Arbi Monitor

Моно-репозиторий с сервисами для мониторинга цен токенов и отправки уведомлений в Telegram.

## Структура

- `apps/backend` — API (Express + WebSocket) для аутентификации, управления контрактами и выдачи обновлений цен.
- `apps/worker` — воркер, который агрегирует котировки с бирж и может писать их в Redis/pub-sub.
- `apps/frontend` — интерфейс на Next.js для работы с мониторингом и визуализацией цен.
- `apps/telegram-bot` — Telegram‑бот для привязки аккаунта и управления уведомлениями.
- `packages/shared` — типы и утилиты, общие для всех сервисов.
- `data/` — папка для JSON‑хранилища пользователей и мониторингов.

## Быстрый старт (development)

```bash
npm install
npm --workspace @arbi/shared run build
npm --workspace @arbi/backend run dev
```

По умолчанию бекенд стартует на `http://localhost:4000` и использует файл `data/store.json` для хранения данных.

### Переменные окружения бекенда

| Переменная | Назначение | Значение по умолчанию |
|------------|------------|------------------------|
| `PORT` | Порт HTTP сервера | `4000` |
| `JWT_SECRET` | Секрет для генерации JWT | `dev-secret-change-me` |
| `DATA_FILE` | Путь к JSON‑хранилищу | `data/store.json` |
| `PRICE_POLL_INTERVAL_MS` | Период опроса цен в мс | `5000` |
| `TELEGRAM_BOT_TOKEN` | Токен бота для отправки сообщений | — |
| `FRONTEND_URL` | Разрешённый origin для CORS | `*` |

### Запуск воркера

```bash
npm --workspace @arbi/price-worker run dev
```

Воркер принимает конфигурацию через переменные окружения:

- `MONITOR_CONTRACTS` — JSON‑массив конфигов `{ contractAddress, mexcSymbol?, jupiterMintAddress? }`.
- `MONITOR_CONFIG_FILE` — путь к JSON файлу с такими же конфигами.
- `REDIS_URL` — строка подключения к Redis (по желанию).
- `PRICE_CACHE_TTL` — TTL кэша в секундах (по умолчанию 5).
- `PRICE_POLL_INTERVAL_MS` — период обновления котировок (по умолчанию 5000 мс).

### Telegram‑бот

```bash
npm --workspace @arbi/telegram-bot run dev
```

Необходимы переменные:

- `BOT_TOKEN` — токен Telegram бота.
- `BACKEND_URL` — адрес бекенда (по умолчанию `http://localhost:4000`).

Команды бота:

- `/link <JWT>` — привязка аккаунта по токену.
- `/notify <on|off>` — переключение уведомлений.
- `/id` — показать ваш Telegram ID.
- `/help` — список команд.

### Frontend (Next.js)

```bash
npm --workspace @arbi/frontend run dev
```

Дополнительные переменные окружения:

- `NEXT_PUBLIC_API_BASE_URL` — базовый URL API (по умолчанию `http://localhost:4000`).
- `NEXT_PUBLIC_WS_URL` — URL WebSocket сервера (по умолчанию формируется из API).

## Тестовые запросы

```bash
# Регистрация
curl -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"secret123"}'

# Добавление контракта
curl -X POST http://localhost:4000/monitoring/contracts \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"contractAddress":"So11111111111111111111111111111111111111112","mexcSymbol":"SOL_USDT","conditions":[{"type":"spread_greater_than","threshold":1,"isActive":true}]}'
```

## Лицензия

MIT
