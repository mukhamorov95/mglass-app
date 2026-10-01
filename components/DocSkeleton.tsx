// Скелетон документа (У11): пока грузится счёт, КП или УПД, человек видит форму
// листа, а не слово «Загрузка…». Форма совпадает с документом — шапка, реквизиты,
// таблица позиций, итог, — поэтому переход к готовому листу не прыгает.

export default function DocSkeleton({ rows = 6 }: { rows?: number }) {
  const bar = 'bg-[#ebebe8] rounded animate-pulse'
  return (
    <div className="min-h-screen bg-[#f5f5f3] py-8 px-4" aria-busy="true" aria-label="Документ загружается">
      <div className="max-w-[820px] mx-auto bg-white border border-[#e4e4e0] rounded-lg p-8">
        <div className={`${bar} h-5 w-56 mb-6`} />
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className={`${bar} h-3 w-full`} />
          <div className={`${bar} h-3 w-4/5 justify-self-end`} />
          <div className={`${bar} h-3 w-3/4`} />
          <div className={`${bar} h-3 w-2/3 justify-self-end`} />
        </div>
        <div className="space-y-2.5 mb-8">
          {Array.from({ length: rows }, (_, i) => <div key={i} className={`${bar} h-3.5`} style={{ width: `${95 - i * 4}%` }} />)}
        </div>
        <div className={`${bar} h-4 w-40 ml-auto`} />
      </div>
    </div>
  )
}
