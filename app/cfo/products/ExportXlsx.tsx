'use client'

import { useState } from 'react'

export type ExportRow = Record<string, string | number | null>

export default function ExportXlsx({ rows, fileName }: { rows: ExportRow[]; fileName: string }) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setErr(null); setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Изделия')
      XLSX.writeFile(wb, fileName)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось собрать файл')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={run} disabled={busy || rows.length === 0}
        className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] bg-white hover:bg-[#f5f5f3] disabled:opacity-50">
        {busy ? 'Собираю…' : '⬇ Выгрузить XLSX'}
      </button>
      {err && <span className="text-xs text-red-600">Выгрузка не удалась: {err}</span>}
    </span>
  )
}
