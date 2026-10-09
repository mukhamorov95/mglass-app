'use client'

import { useState } from 'react'

// Фото детали с сайта поставщика; ссылка умерла — подпись вместо битой картинки.
export function Thumb({ src, alt, size }: { src?: string | null; alt: string; size: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`${size} shrink-0 rounded-lg bg-white border border-[#efefeb] overflow-hidden flex items-center justify-center`}>
      {src && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-contain" />
        : <span className="text-[10px] text-[#c9c9c4] text-center px-1">нет фото</span>}
    </div>
  )
}
