import 'server-only'
import type { DocType, MoveOrigin } from './types'
import {
  buildConsumePlan, applyConsume, orderHasCuttingTasks, sweepCuttingConsume,
  consumeItemAtStage, reverseItemConsume as reverseItemConsumeDb, type MoveActor,
} from './db'

// Списание материала со склада под ЗАВЕРШЕНИЕ работы — для СЕРВЕРНЫХ хуков, не для
// прямой правки склада человеком.
//
// Почему отдельный путь, а не HTTP /api/inventory/consume: тот гейтится
// requireInventoryWrite (нет менеджера/цеха — и правильно, это гейт ПРЯМОЙ операции).
// Списание же — системный побочный эффект действия, которое инициатор и так
// уполномочен совершить (закрыть резку/упаковку). Прав человека это не расширяет:
// функция server-only, из браузера недоступна по построению (import 'server-only'
// роняет случайный клиентский импорт на сборке).
//
// Две точки списания (решение владельца 27.08.2026):
//   • РЕЗКА (основной путь) — consumeForItem по детали при закрытии cutting-задачи.
//     Материал физически уходит именно на резке. Идемпотентность по (заказ, позиция,
//     этап, попытка): переделка (attempt++) списывает новый лист, повтор попытки — no-op.
//   • УПАКОВКА — consumeForOrder на packaged. Для заказа МИМО цеха (без задач резки)
//     списывает весь план. Для заказа ЧЕРЕЗ цех проходит по позициям тем же ключом
//     резки: живые уже списаны (БД отсеивает), а закрытые каскадом без живой отметки
//     дописывает здесь — иначе они не спишутся никогда.
//
// origin по умолчанию 'plan' на обоих путях: количество плановое — площадь берётся
// из заказа, стекло не взвешивают, обрезь не меряют. Ось origin про происхождение
// КОЛИЧЕСТВА, не момента: переезд на резку убрал временной лаг «на руках», но не
// сделал количество измеренным фактом. 'fact' появится, когда начнём мерить расход
// на деталь. (См. миграцию 20260828_inventory_move_origin.sql.)
//
// best-effort: НИКОГДА не бросает. Ошибка склада не должна ронять отметку этапа,
// иначе цех/менеджер начнут её обходить.

export type ConsumeHookResult = {
  ok:              boolean
  inserted:        number
  released:        number
  alreadyConsumed: boolean
  error?:          string
}

// Упаковочный путь (страховка для заказов мимо цеха). Заказ с задачами резки
// пропускается — по нему списание идёт подетально на резке, иначе двойной учёт.
export async function consumeForOrder(
  docType: DocType,
  docId:   string,
  by:      MoveActor,
  origin:  MoveOrigin = 'plan',
): Promise<ConsumeHookResult> {
  try {
    if (docType === 'b2b_order' && await orderHasCuttingTasks(docId)) {
      // Заказ через цех: списание ведёт резка подетально. На упаковке ПРОХОДИМ по
      // всем позициям тем же ключом — живые уже списаны (БД отсеивает), а позиции,
      // где резку закрыл каскад без живой отметки, списываем здесь. Иначе они не
      // спишутся никогда (дыра: 48 заказов с задачами, но без живых отметок резки).
      const sweep = await sweepCuttingConsume(docId, by, origin)
      return { ok: true, inserted: sweep.inserted, released: 0, alreadyConsumed: sweep.inserted === 0 }
    }
    const plan = await buildConsumePlan(docType, docId)
    if (plan.already) {
      return { ok: true, inserted: 0, released: 0, alreadyConsumed: true }
    }
    // by доезжает до движения: applyConsume → addMoves пишет created_by/created_by_name.
    const res = await applyConsume(plan, by, undefined, origin)
    return { ok: true, inserted: res.inserted, released: res.released, alreadyConsumed: false }
  } catch (e) {
    // Списание провалилось — отметку этапа не роняем, отдаём ошибку флагом.
    return { ok: false, inserted: 0, released: 0, alreadyConsumed: false, error: (e as Error).message }
  }
}

export type ItemConsumeHookResult = {
  ok:       boolean
  inserted: number
  matched:  boolean   // нашлась ли складская позиция под материал детали
  name?:    string
  qty?:     number
  error?:   string
}

// РЕЗКА — основной путь. Зовётся из производственного контура на ЖИВОЙ отметке
// закрытия резки по детали (не по каскаду auto_closed — это гарантируют вызовы).
// attempt = production_tasks.rework_count на момент отметки. Пустой актор допустим
// (у части живых отметок нет исполнителя) — никого не выдумываем.
export async function consumeForItem(
  docType:   DocType,
  docId:     string,
  itemIndex: number,
  attempt:   number,
  by:        MoveActor,
  origin:    MoveOrigin = 'plan',
): Promise<ItemConsumeHookResult> {
  if (docType !== 'b2b_order') {
    return { ok: true, inserted: 0, matched: false, error: `подетальное списание поддержано только для b2b_order` }
  }
  try {
    const r = await consumeItemAtStage(docId, itemIndex, attempt, 'cutting', by, origin)
    return { ok: r.ok, inserted: r.inserted, matched: r.matched, name: r.name, qty: r.qty }
  } catch (e) {
    return { ok: false, inserted: 0, matched: false, error: (e as Error).message }
  }
}

// Откат ошибочной отметки резки (UNSET — мисклик/«не тот заказ»): встречное
// движение-коррекция. Для «Переделать» (REOPEN) откат НЕ нужен — материал
// израсходован, следующая попытка спишет ещё лист. Различает UNSET/REOPEN вызывающий.
export async function reverseItemConsume(
  docType:   DocType,
  docId:     string,
  itemIndex: number,
  attempt:   number,
  by:        MoveActor,
): Promise<ItemConsumeHookResult> {
  if (docType !== 'b2b_order') {
    return { ok: true, inserted: 0, matched: false }
  }
  try {
    const r = await reverseItemConsumeDb(docId, itemIndex, attempt, 'cutting', by)
    return { ok: r.ok, inserted: r.inserted, matched: r.matched }
  } catch (e) {
    return { ok: false, inserted: 0, matched: false, error: (e as Error).message }
  }
}
