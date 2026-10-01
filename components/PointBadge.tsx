// Заказ точки на стройрынке (b2b_clients.is_point): цех делает такие первыми.
// Заметная, но спокойная — красный цвет занят «СРОЧНО» и просрочкой.
export default function PointBadge({ className = '' }: { className?: string }) {
  return (
    <span title="Заказ точки на рынке — делать первым"
      className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-800 ${className}`}>
      Точка
    </span>
  )
}
