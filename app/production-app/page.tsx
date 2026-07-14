import { redirect } from 'next/navigation'

// Главный экран цеха — «Мои задачи» (решение владельца 14.07: «Обзор» убран,
// его закрывают Мои задачи + Заказы). Матрица заказ×этапы осталась по прямому
// адресу /production-app/board.
export default function ProductionHome() {
  redirect('/production-app/my-queue')
}
