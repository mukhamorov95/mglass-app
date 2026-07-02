'use client'

import { useEffect } from 'react'

export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3] p-6">
      <div className="text-center max-w-sm">
        <p className="text-[15px] font-semibold text-[#111110] mb-1">Что-то пошло не так</p>
        <p className="text-[13px] text-[#9a9a95] mb-4">Страница не загрузилась. Попробуйте обновить.</p>
        <button onClick={() => location.reload()}
          className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          Обновить
        </button>
      </div>
    </div>
  )
}
