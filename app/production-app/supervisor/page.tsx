import { redirect } from 'next/navigation'

// «Панель производства» слита в единый обзор цеха (П6). Её сводка, фильтры
// (просрочка / горит / проблемы / готовы / с отменами) и счётчик отмен этапов
// переехали туда. Своих данных она не теряет: панель стояла целиком на
// notes.detail_stages и не обращалась к production_tasks вообще — то есть
// показывала переходную модель как единственную и расходилась с остальным цехом.
export default function SupervisorMergedIntoBoard() {
  redirect('/production-app/board')
}
