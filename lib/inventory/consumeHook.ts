import 'server-only'
import type { DocType, MoveOrigin } from './types'
import { buildConsumePlan, applyConsume, type MoveActor } from './db'

// Единая точка автосписания под ЗАВЕРШЕНИЕ заказа — для СЕРВЕРНЫХ хуков, не для
// прямой правки склада человеком. Оба хука зовут её:
//   • производство — на переходе флага packaged в mirrorOrderStages;
//   • b2b-orders   — на ручной отметке packaged.
//
// Почему отдельный путь, а не HTTP /api/inventory/consume: тот гейтится
// requireInventoryWrite (нет менеджера — и правильно, это гейт ПРЯМОЙ операции).
// Списание же — системный побочный эффект действия, которое инициатор и так
// уполномочен совершить (закрыть упаковку). Прав человека это не расширяет:
// функция server-only, из браузера недоступна по построению (import 'server-only'
// роняет случайный клиентский импорт на сборке).
//
// origin по умолчанию 'plan': материал физически ушёл на резке, а списываем на
// упаковке по резерву — движение честно помечается планом, не выдаётся за факт.
//
// best-effort: НИКОГДА не бросает. Ошибка склада не должна ронять отметку
// «Готово», иначе цех/менеджер начнут её обходить.

export type ConsumeHookResult = {
  ok:              boolean
  inserted:        number
  released:        number
  alreadyConsumed: boolean
  error?:          string
}

export async function consumeForOrder(
  docType: DocType,
  docId:   string,
  by:      MoveActor,
  origin:  MoveOrigin = 'plan',
): Promise<ConsumeHookResult> {
  try {
    const plan = await buildConsumePlan(docType, docId)
    if (plan.already) {
      return { ok: true, inserted: 0, released: 0, alreadyConsumed: true }
    }
    // by доезжает до движения: applyConsume → addMoves пишет created_by/created_by_name.
    const res = await applyConsume(plan, by, undefined, origin)
    return { ok: true, inserted: res.inserted, released: res.released, alreadyConsumed: false }
  } catch (e) {
    // Списание провалилось — отметку «Готово» не роняем, отдаём ошибку флагом.
    return { ok: false, inserted: 0, released: 0, alreadyConsumed: false, error: (e as Error).message }
  }
}
