'use client'

import { useEffect, useState } from 'react'
import { loadJson, sendOrToast, toast } from '@/lib/toast'

type Row = { id: number; code: string; name: string; value: number; cost_price: number; active: boolean }
type Draft = { value: string; cost: string }

// Ориентир — клиентский прайс БСК от 15.01.2026 со скидкой 15 % (продажа, не наша себестоимость).
const BSK: Record<string, number> = { cutout_outer_1: 401, cutout_outer_2: 625, cutout_inner_1: 490, cutout_inner_2: 1071 }

const parse = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (t === '') return 0
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function CutoutsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    loadJson<{ rows: Row[] }>('/api/admin/cutouts').then(r => {
      if (r.data === null) { setError(r.error); return }
      const list = r.data.rows
      setRows(list)
      setDrafts(Object.fromEntries(list.map(x => [x.id, { value: String(Number(x.value) || ''), cost: String(Number(x.cost_price) || '') }])))
    })
  }, [])

  async function save(row: Row) {
    const d = drafts[row.id]
    const value = parse(d?.value ?? ''), cost = parse(d?.cost ?? '')
    if (value === null || cost === null) { toast.error('Не сохранено', { detail: 'Цена — одно число, например 650 или 650,50' }); return }
    setBusy(row.id)
    const r = await sendOrToast('Не сохранено', '/api/admin/cutouts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, value, cost_price: cost }),
    })
    setBusy(null)
    if (!r) return
    const j = await r.json().catch(() => null) as { row?: Row } | null
    if (!j?.row) { toast.error('Не сохранено', { detail: 'Сервер не вернул строку' }); return }
    setRows(prev => prev?.map(x => (x.id === row.id ? j.row! : x)) ?? null)
    toast.success(`${row.name}: сохранено`, { detail: 'Калькулятор B2B считает по новой цене в новых позициях' })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4 text-[#111110]">
      <div>
        <h1 className="text-[20px] font-semibold">Вырезы в стекле</h1>
        <p className="text-[13px] text-[#6b6b66] mt-1 leading-relaxed">
          Цена за один вырез. Менеджер выбирает в позиции вид, категорию и сколько вырезов на деталь;
          сумма = цена × вырезов × деталей. Пока продажная цена не задана, позиция с таким вырезом не добавляется.
        </p>
      </div>

      {error && <p className="text-[13px] text-red-600">Не удалось загрузить: {error}</p>}
      {!rows && !error && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

      {rows && (
        <div className="border border-[#e4e4e0] rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-[11px] text-[#9a9a95] uppercase tracking-wide">
              <tr className="border-b border-[#e4e4e0]">
                <th className="text-left font-medium px-3 py-2">Вырез</th>
                <th className="text-right font-medium px-3 py-2">Себестоимость, ₽</th>
                <th className="text-right font-medium px-3 py-2">Продажа, ₽</th>
                <th className="text-right font-medium px-3 py-2" title="Клиентский прайс БСК от 15.01.2026 со скидкой 15 % — продажа конкурента, не наша цена">БСК, янв. 2026</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const d = drafts[row.id] ?? { value: '', cost: '' }
                const dirty = parse(d.value) !== Number(row.value) || parse(d.cost) !== Number(row.cost_price)
                const unpriced = !(Number(row.value) > 0)
                return (
                  <tr key={row.id} className="border-b border-[#f0f0ec] last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      {unpriced && <div className="text-[11px] text-red-600">цена не задана — в калькуляторе недоступен</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input inputMode="decimal" value={d.cost} placeholder="0"
                        onChange={e => setDrafts(p => ({ ...p, [row.id]: { ...d, cost: e.target.value } }))}
                        className="w-24 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-right outline-none focus:border-[#111110]" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input inputMode="decimal" value={d.value} placeholder="0"
                        onChange={e => setDrafts(p => ({ ...p, [row.id]: { ...d, value: e.target.value } }))}
                        className="w-24 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-right outline-none focus:border-[#111110]" />
                    </td>
                    <td className="px-3 py-2 text-right text-[#9a9a95]">{BSK[row.code] ? rub(BSK[row.code]) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => save(row)} disabled={!dirty || busy === row.id}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#111110] text-white disabled:bg-[#e4e4e0] disabled:text-[#9a9a95]">
                        {busy === row.id ? '…' : dirty ? 'Сохранить' : 'Сохранено'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[12px] text-[#9a9a95] leading-relaxed">
        Колонка БСК — продажная цена конкурента для ориентира, а не наша себестоимость; прайс старый, цены у них с тех пор выросли.
        Цены уже посчитанных позиций не меняются — только новые и пересчитанные.
      </p>
    </div>
  )
}
