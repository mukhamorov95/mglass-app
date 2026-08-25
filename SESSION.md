## Текущая задача
Маршрут A3→A10 конфигуратора (вкладка «Сайт + 3D»). Сделаны A3 (реализм сцены) и A4 v1 (конфигурируемость M1).

## Что сделано (эта сессия)
- A2 (избранное «наши позиции» + сравнение поставщиков) → PR #217 (территория Прайса, уедет в main через их ветку)
- Координация 2 сессий → docs/CONFIGURATOR_COORDINATION.md (файловая граница, контракт, лог)
- ТЗ M1 → docs/configurator/M1_CONFIG_SPEC.md
- A3 сцена как рендер → components/configurator/Partition3D.tsx (отражающий пол, ACES, блики)
- A4 M1 конфигурируемость:
  - spec? в MetalPart/HardwarePlacement; variant (6-й арг) в buildFromModel; MDims += trayDepth/ceilingHeight → components/configurator/scene/assembly.ts
  - Геометрия 4 креплений (perp90/diag45/stabilizer/ceiling) + 2 обвязок (partial/perimeter) со spec-кодами
  - UI M1 (выбор крепления/обвязки + поддон/потолок) + проброс variant в 3D и quote → ConfiguratorClient.tsx, Partition3D(View).tsx

## Следующий шаг
Продолжить маршрут: доработать визуал креплений M1 (труба/кронштейны как в жизни, отдельные 3D-формы вместо плейсхолдеров kp002/kp006), затем A5 «Клиентский UX». Прайс (A9) не трогаю.
При переходе на POST /api/configurator/options+/quote — мигрировать полную разбивку ConfiguratorClient под KitPriceResult (пингнуть Прайс, они уберут GET).

## Контекст
Ветка feat/shower-3d-configurator. tsc 0, lint по изменённым чист.
Контракт с Прайсом: variant Record<string,string> (mount∈{perp90,diag45,stabilizer,ceiling}, profileFrame∈{partial,perimeter}); spec-коды tube-*/profile-*/mount-*. trayDepth по умолчанию 1000 → длина трубы perp90 (важно для FDT-351/352). Верифицировано в /embed/shower.
Себестоимость не в клиенте — цена с сервера.

## Открытые вопросы
- Плейсхолдеры 3D-форм для mount-diag45/mount-stabilizer (сейчас kp002). Уточнить визуал креплений с владельцем.
- Точная геометрия diag45 (угол/длина) — приближение, показать владельцу.
