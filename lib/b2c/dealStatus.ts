// Статус сделки B2C — ПРОИЗВОДНАЯ от содержимого, не отдельный набор состояний и не
// хранимое поле: иначе появится второе место правды и статус разойдётся с карточкой.
// Пока в сделке живут только расчёты (шаг 2); замер/чертёж/счёт/оплата подключатся
// на шагах 4+ и здесь добавятся ветками, не ломая существующие.
//
// Зоны воронки зафиксированы в SYSTEM.md — новых не изобретаем, отражаем то, что есть.

export type DealCalc = { status?: string | null }

export type DealStage = { key: string; label: string; tone: 'plain' | 'sent' | 'good' }

export function dealStage(calcs: DealCalc[]): DealStage {
  if (!calcs || calcs.length === 0) return { key: 'new', label: 'Новая', tone: 'plain' }
  const has = (s: string) => calcs.some(c => c.status === s)
  if (has('approved')) return { key: 'approved', label: 'Согласовано', tone: 'good' }
  if (has('sent'))     return { key: 'sent',     label: 'КП отправлено', tone: 'sent' }
  return { key: 'quote', label: 'Просчёт', tone: 'plain' }
}
