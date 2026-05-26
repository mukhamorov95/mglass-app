# Content Skill — Навык контента и маркетинга

## Назначение
Управлять контент-планом, генерировать AI-материалы для соцсетей, хранить медиабиблиотеку. Полностью независим от продажных Skills — развивается отдельно.

## Модули и страницы
- `/marketing` — Marketing Center (главная)
- `/marketing/content` — контент-план (сетка публикаций)
- `/marketing/video-factory` — AI Video Factory (сценарии Reels)
- `/marketing/media-library` — медиабиблиотека
- `/marketing/daily` — дневной план AI-маркетолога
- `/marketing/partners` — партнёры (referral, совместные акции)
- `/marketing/promos` — акции и спецпредложения
- `/marketing/tasks` — задачи маркетинга
- `/marketing/ai` — AI-маркетолог (чат)
- `/admin/shower-images` — изображения душевых (медиа)

## API маршруты
- `GET/POST /api/marketing/content` — контент-план
- `GET/POST /api/marketing/daily` — дневной AI-план
- `GET/POST /api/marketing/media` — медиа
- `GET/POST /api/marketing/partners` — партнёры
- `GET/POST /api/marketing/promos` — акции
- `GET/POST /api/marketing/scripts` — скрипты продаж
- `GET/POST /api/marketing/tasks` — задачи маркетинга
- `GET/POST /api/marketing/videos` — видео и сценарии
- `POST /api/ai/content-generate` — AI-генерация поста/текста
- `POST /api/ai/marketing-chat` — AI-маркетолог (диалог)
- `GET/POST /api/admin/influencers` — инфлюенсеры
- `GET/POST /api/admin/shower-images` — медиабиблиотека душевых

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `marketing_content` | Контент-план: platform, type, status, publish_date, text |
| `marketing_tasks` | Задачи: title, assignee, deadline, status |
| `marketing_partners` | Партнёры: name, type, contact, conditions |
| `marketing_promos` | Акции: title, discount_pct, valid_from, valid_to |
| `marketing_videos` | Видео: title, script, platform, status |
| `shower_images` | Изображения: url, model, tags, is_active |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/marketingManagerPrompt.ts` | System prompt AI-маркетолога — стиль, тон, экспертиза |
| `lib/contentGeneratorPrompt.ts` | Промпты для генерации контента по платформам |

## Роли и доступ
- **seo**: полный доступ — контент-план, медиа, AI-маркетолог, задачи
- **ceo**: просмотр и управление всем маркетингом
- **admin**: полный доступ

## Входные данные
Тема/продукт/акция, платформа (Instagram/Telegram/VK/Avito), тон (экспертный/дружелюбный/продающий).

## Выходные данные
Тексты постов, сценарии Reels, контент-план с датами, AI-сгенерированный контент.

## Что уже реализовано
- Полная структура страниц маркетинга (8 разделов)
- AI-маркетолог с персонализированным промптом (`lib/marketingManagerPrompt.ts`)
- Генерация контента через Claude API
- Медиабиблиотека изображений душевых
- Контент-план с сеткой

## Что нужно доработать
- Прямая публикация контента в соцсети (API Instagram/VK/Telegram)
- Автопостинг по расписанию контент-плана
- Аналитика контента: охваты, реакции, конверсии
- Интеграция с Avito для управления объявлениями

## Риски
- AI-генерация требует `ANTHROPIC_API_KEY` — без него все AI-функции недоступны
- Нет модерации перед публикацией — при прямой публикации риск неудачного контента
- Медиабиблиотека хранит только URL без CDN — при удалении из Storage ссылки сломаются

## Тесты
- Smoke: все 8 страниц маркетинга рендерятся без ошибок
- Integration: POST `/api/ai/content-generate` с темой → текст поста
- Integration: GET `/api/marketing/content` → список плановых публикаций

## Связи с другими Skills
- **Integration Skill** — публикация через Telegram-бота, будущая интеграция с соцсетями
- **CEO Analytics Skill** — ROI маркетинга (сколько лидов пришло из контента)
