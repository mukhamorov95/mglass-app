'use client'

// Кнопки над печатным листом цеха: назад, сохранить файлом, напечатать. На бумагу и в файл не попадают.

import { useState, type RefObject } from 'react'
import Link from 'next/link'
import { saveSheetPdf } from '@/lib/pdfCapture'
import { toast } from '@/lib/toast'

// Неразрывны строки таблицы и блоки .pdf-keep; шапка таблицы не остаётся одна внизу страницы.
const KEEP = 'tbody tr, tfoot tr, .pdf-keep'

export default function SheetActions({ sheet, fileName, backHref, backLabel }: {
  sheet: RefObject<HTMLElement | null>; fileName: string; backHref: string; backLabel: string
}) {
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!sheet.current) return
    setBusy(true)
    try {
      await saveSheetPdf(sheet.current, fileName, KEEP)
    } catch (e) {
      toast.error('PDF не сохранён', { detail: `${e instanceof Error ? e.message : 'ошибка'}. Нажмите «Печать» и выберите «Сохранить как PDF».` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Link href={backHref} className="h-10 px-3 inline-flex items-center rounded-lg border border-[#e4e4e0] bg-white text-[13px] text-[#4b4b47]">← {backLabel}</Link>
      <button onClick={() => void save()} disabled={busy} className="h-10 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">{busy ? 'Готовлю PDF…' : 'Сохранить PDF'}</button>
      <button onClick={() => window.print()} className="h-10 px-3 rounded-lg border border-[#e4e4e0] bg-white text-[13px] text-[#4b4b47]">Печать</button>
    </div>
  )
}
