'use client'

import { useState, useEffect, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'import' | 'sheets' | 'logs'

type ImportTarget = 'suppliers' | 'b2b_clients' | 'purchase_orders'

type FieldDef = { key: string; label: string; required?: boolean }

type ImportLog = {
  id: number
  source: string
  source_name: string | null
  target_module: string | null
  rows_total: number | null
  rows_ok: number | null
  rows_error: number | null
  error_details: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IMPORT_TARGETS: Record<ImportTarget, { label: string; fields: FieldDef[] }> = {
  suppliers: {
    label: 'Поставщики',
    fields: [
      { key: 'name',         label: 'Название',        required: true },
      { key: 'type',         label: 'Тип поставок' },
      { key: 'contact',      label: 'Контактное лицо' },
      { key: 'phone',        label: 'Телефон' },
      { key: 'whatsapp',     label: 'WhatsApp' },
      { key: 'telegram',     label: 'Telegram' },
      { key: 'email',        label: 'Email' },
      { key: 'city',         label: 'Город' },
      { key: 'address',      label: 'Адрес' },
      { key: 'work_hours',   label: 'График работы' },
      { key: 'materials',    label: 'Материалы / Категория' },
      { key: 'notes',        label: 'Заметки' },
    ],
  },
  b2b_clients: {
    label: 'B2B Клиенты',
    fields: [
      { key: 'name',             label: 'Название компании', required: true },
      { key: 'contact',          label: 'Контактное лицо' },
      { key: 'phone',            label: 'Телефон' },
      { key: 'discount_percent', label: 'Скидка (%)' },
      { key: 'notes',            label: 'Заметки' },
    ],
  },
  purchase_orders: {
    label: 'Закупки (Канбан)',
    fields: [
      { key: 'supplier_name',  label: 'Поставщик', required: true },
      { key: 'invoice_number', label: 'Номер счёта' },
      { key: 'amount',         label: 'Сумма' },
      { key: 'items_list',     label: 'Позиции' },
      { key: 'comment',        label: 'Комментарий' },
    ],
  },
}

const AUTO_MAP: Record<string, string> = {
  'название': 'name', 'наименование': 'name', 'name': 'name', 'компания': 'name',
  'телефон': 'phone', 'phone': 'phone', 'тел': 'phone', 'моб': 'phone',
  'контакт': 'contact', 'contact': 'contact', 'контактное лицо': 'contact', 'фио': 'contact',
  'email': 'email', 'почта': 'email', 'e-mail': 'email',
  'whatsapp': 'whatsapp', 'вотсап': 'whatsapp',
  'telegram': 'telegram', 'тг': 'telegram', 'телеграм': 'telegram',
  'адрес': 'address', 'address': 'address',
  'город': 'city', 'city': 'city',
  'режим': 'work_hours', 'график': 'work_hours', 'часы': 'work_hours',
  'материалы': 'materials', 'номенклатура': 'materials', 'категория': 'type',
  'тип': 'type', 'type': 'type',
  'заметки': 'notes', 'комментарий': 'notes', 'notes': 'notes', 'примечание': 'notes',
  'поставщик': 'supplier_name', 'supplier': 'supplier_name',
  'счёт': 'invoice_number', 'номер счёта': 'invoice_number',
  'сумма': 'amount', 'amount': 'amount',
  'скидка': 'discount_percent',
}

const SOURCE_ICONS: Record<string, string> = {
  csv: '📄', google_sheets: '📊', manual: '✏️', telegram: '✈️',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DataHubPage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-5xl mx-auto px-6 py-6">

        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-[#111110]">Центр данных MGlass</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Единая точка импорта, синхронизации и управления источниками данных</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-[#e4e4e0]">
          {([
            { key: 'overview', label: 'Обзор' },
            { key: 'import',   label: 'Импорт' },
            { key: 'sheets',   label: 'Google Sheets' },
            { key: 'logs',     label: 'Логи' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95] hover:text-[#6b6b66]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab />}
        {tab === 'import'   && <ImportTab />}
        {tab === 'sheets'   && <SheetsTab onImported={() => setTab('logs')} />}
        {tab === 'logs'     && <LogsTab />}
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const integrations = [
    {
      name: 'Google Sheets',
      icon: '📊',
      status: 'available',
      desc: 'Импорт данных из любой таблицы Google — поставщики, клиенты, закупки. Таблица должна быть открыта по ссылке.',
      action: 'Перейти к импорту',
    },
    {
      name: 'CSV / Excel',
      icon: '📄',
      status: 'available',
      desc: 'Загрузи файл CSV или Excel. Данные будут распознаны автоматически — останется выбрать куда импортировать.',
      action: 'Перейти к импорту',
    },
    {
      name: 'Telegram',
      icon: '✈️',
      status: 'active',
      desc: 'Бот Vladislav уже подключён. Сообщения из чатов обрабатываются AI и попадают в систему.',
      sub: 'Группы: Замеры, Оплаты, Производство, Монтажи, Логистика',
    },
    {
      name: 'AmoCRM',
      icon: '🔗',
      status: 'active',
      desc: 'Синхронизация лидов и заказов с AmoCRM работает через Wazzup / Vladislav.',
      sub: 'Монитор: /admin/integrations',
    },
    {
      name: 'Excel / 1С',
      icon: '📑',
      status: 'planned',
      desc: 'Прямой импорт из 1С и Excel-выгрузок. Поддержка форматов .xlsx, .xls будет добавлена.',
    },
    {
      name: 'API поставщиков',
      icon: '🏭',
      status: 'planned',
      desc: 'Прямые интеграции с API поставщиков для автоматического получения прайсов и остатков.',
    },
    {
      name: 'Банки / Оплаты',
      icon: '🏦',
      status: 'planned',
      desc: 'Автоматический импорт банковских выписок для сверки оплат с заказами.',
    },
    {
      name: 'Google Drive',
      icon: '📁',
      status: 'planned',
      desc: 'Прикрепление файлов из Google Drive напрямую к заказам, поставщикам и производству.',
    },
  ]

  const statusMeta = {
    active:    { label: 'Работает',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    available: { label: 'Доступно',  cls: 'bg-blue-50    text-blue-700    border-blue-200'    },
    planned:   { label: 'В планах',  cls: 'bg-gray-100   text-gray-500    border-gray-200'    },
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#111110] text-white rounded-xl px-6 py-5">
        <p className="text-[15px] font-bold">🔗 MGlass становится единым центром данных</p>
        <p className="text-[12px] text-[#a0a09a] mt-1">
          Google Sheets и Telegram — источники для миграции и начального импорта. Финальное хранилище — MGlass Platform.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integrations.map(i => {
          const sm = statusMeta[i.status as keyof typeof statusMeta]
          return (
            <div key={i.name} className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{i.icon}</span>
                  <p className="text-[14px] font-semibold text-[#111110]">{i.name}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${sm.cls}`}>{sm.label}</span>
              </div>
              <p className="text-[12px] text-[#6b6b66] leading-relaxed">{i.desc}</p>
              {i.sub && <p className="text-[11px] text-[#9a9a95] mt-1">{i.sub}</p>}
            </div>
          )
        })}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
        <p className="text-[13px] font-semibold text-blue-800 mb-2">📐 Архитектура данных MGlass</p>
        <div className="grid grid-cols-3 gap-3 text-[11px]">
          {[
            { title: 'Внутренние данные', items: ['Заказы MGlass / B2B', 'Расчёты и калькуляторы', 'Производство и склад', 'Закупки и маршруты', 'Поставщики и клиенты'] },
            { title: 'Внешние источники', items: ['Google Sheets (импорт)', 'Telegram (события)', 'AmoCRM (лиды)', 'Excel / CSV (файлы)', 'API поставщиков (планируется)'] },
            { title: 'Ручной ввод', items: ['Корректировки остатков', 'Фактические оплаты', 'Расходы и затраты', 'Статусы маршрутов', 'Комментарии и логи'] },
          ].map(col => (
            <div key={col.title}>
              <p className="font-bold text-blue-700 mb-1.5">{col.title}</p>
              <ul className="space-y-0.5 text-blue-600">
                {col.items.map(i => <li key={i}>• {i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Import (CSV + field mapping) ─────────────────────────────────────────────

function ImportTab() {
  const [step, setStep]           = useState<'upload' | 'map' | 'done'>('upload')
  const [target, setTarget]       = useState<ImportTarget>('suppliers')
  const [headers, setHeaders]     = useState<string[]>([])
  const [rows, setRows]           = useState<Record<string, string>[]>([])
  const [mapping, setMapping]     = useState<Record<string, string>>({})
  const [sourceName, setSourceName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<{ ok: number; err: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseCSV(text: string): string[][] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
    return lines.map(line => {
      const result: string[] = []
      let current = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { if (inQ && line[i+1] === '"') { current += '"'; i++ } else inQ = !inQ }
        else if (ch === ',' && !inQ) { result.push(current.trim()); current = '' }
        else current += ch
      }
      result.push(current.trim())
      return result
    })
  }

  function autoMap(headers: string[]): Record<string, string> {
    const m: Record<string, string> = {}
    for (const h of headers) {
      const k = h.toLowerCase().trim()
      if (AUTO_MAP[k]) m[h] = AUTO_MAP[k]
    }
    return m
  }

  function handleFile(file: File) {
    setSourceName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (parsed.length < 2) return
      const hdrs = parsed[0]
      const dataRows = parsed.slice(1).map(row => {
        const obj: Record<string, string> = {}
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? '' })
        return obj
      })
      setHeaders(hdrs)
      setRows(dataRows)
      setMapping(autoMap(hdrs))
      setStep('map')
    }
    reader.readAsText(file, 'utf-8')
  }

  async function doImport() {
    setImporting(true)
    const res = await fetch('/api/admin/data-hub/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, rows, mapping, source_name: sourceName, source: 'csv' }),
    })
    const data = await res.json()
    setResult({ ok: data.rows_ok, err: data.rows_error, errors: data.errors ?? [] })
    setStep('done')
    setImporting(false)
  }

  const targetFields = IMPORT_TARGETS[target].fields

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-[13px] font-semibold text-[#111110]">Импортировать в:</p>
        <select value={target} onChange={e => { setTarget(e.target.value as ImportTarget); setStep('upload'); setRows([]) }}
          className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white">
          {(Object.keys(IMPORT_TARGETS) as ImportTarget[]).map(k => (
            <option key={k} value={k}>{IMPORT_TARGETS[k].label}</option>
          ))}
        </select>
      </div>

      {step === 'upload' && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          className="border-2 border-dashed border-[#e4e4e0] rounded-xl p-12 text-center cursor-pointer hover:border-[#111110] transition-colors">
          <p className="text-3xl mb-3">📄</p>
          <p className="text-[14px] font-semibold text-[#111110]">Перетащи CSV-файл или нажми</p>
          <p className="text-[12px] text-[#9a9a95] mt-1">Поддерживается: CSV с кодировкой UTF-8 или Windows-1251</p>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">
              Найдено строк: {rows.length} · Столбцов: {headers.length}
            </p>
            <div className="overflow-x-auto">
              <table className="text-[11px] border-collapse">
                <thead>
                  <tr>{headers.slice(0, 6).map(h => <th key={h} className="px-2 py-1 bg-[#f8f8f7] border border-[#e4e4e0] text-left font-semibold text-[#9a9a95] whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 3).map((row, i) => (
                    <tr key={i}>{headers.slice(0, 6).map(h => <td key={h} className="px-2 py-1 border border-[#f0f0ec] text-[#4b4b47] max-w-[120px] truncate">{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">Сопоставление столбцов</p>
            <div className="space-y-2">
              {headers.map(h => (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-[12px] text-[#6b6b66] w-40 flex-shrink-0 truncate" title={h}>{h}</span>
                  <span className="text-[#c4c4be]">→</span>
                  <select
                    value={mapping[h] ?? ''}
                    onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                    className="flex-1 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px] outline-none focus:border-[#111110] bg-white">
                    <option value="">— не импортировать —</option>
                    {targetFields.map(f => (
                      <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={doImport} disabled={importing}
              className="flex-1 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-xl disabled:opacity-40 hover:bg-[#2a2a28]">
              {importing ? 'Импортируется...' : `Импортировать ${rows.length} строк`}
            </button>
            <button onClick={() => { setStep('upload'); setRows([]) }}
              className="px-4 py-2.5 border border-[#e4e4e0] text-[12px] text-[#6b6b66] rounded-xl hover:bg-[#f8f8f7]">
              Назад
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 space-y-3 text-center">
          <p className="text-3xl">{result.err === 0 ? '✅' : '⚠️'}</p>
          <p className="text-[16px] font-semibold text-[#111110]">Импорт завершён</p>
          <div className="flex justify-center gap-6 text-[13px]">
            <span className="text-emerald-700">✓ Успешно: {result.ok}</span>
            {result.err > 0 && <span className="text-red-600">✗ Ошибок: {result.err}</span>}
          </div>
          {result.errors.length > 0 && (
            <div className="text-left bg-red-50 border border-red-100 rounded-lg p-3 text-[11px] text-red-700 space-y-0.5">
              {result.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
          <button onClick={() => { setStep('upload'); setRows([]); setResult(null) }}
            className="px-4 py-2 bg-[#111110] text-white text-[12px] rounded-lg hover:bg-[#2a2a28]">
            Импортировать ещё
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Google Sheets ─────────────────────────────────────────────────────────────

function SheetsTab({ onImported }: { onImported: () => void }) {
  const [url,     setUrl]     = useState('')
  const [gid,     setGid]     = useState('0')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows,    setRows]    = useState<Record<string, string>[]>([])
  const [target,  setTarget]  = useState<ImportTarget>('suppliers')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [step,    setStep]    = useState<'input' | 'map' | 'done'>('input')
  const [importing, setImporting] = useState(false)
  const [result, setResult]   = useState<{ ok: number; err: number } | null>(null)

  function autoMap(headers: string[]): Record<string, string> {
    const m: Record<string, string> = {}
    for (const h of headers) { const k = h.toLowerCase().trim(); if (AUTO_MAP[k]) m[h] = AUTO_MAP[k] }
    return m
  }

  async function fetchSheet() {
    if (!url.trim()) { setError('Вставь ссылку на таблицу'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/admin/data-hub/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), gid }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); setLoading(false); return }
    const { headers: hdrs, preview } = data
    const dataRows = (preview as string[][]).map(row => {
      const obj: Record<string, string> = {}
      hdrs.forEach((h: string, i: number) => { obj[h] = row[i] ?? '' })
      return obj
    })
    setHeaders(hdrs)
    setRows(dataRows)
    setMapping(autoMap(hdrs))
    setStep('map')
    setLoading(false)
  }

  async function doImport() {
    setImporting(true)
    // Re-fetch full data (preview is only 10 rows)
    const fetchRes = await fetch('/api/admin/data-hub/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), gid }),
    })
    const fetchData = await fetchRes.json()
    if (!fetchRes.ok) { setError(fetchData.error); setImporting(false); return }
    const hdrs: string[] = fetchData.headers
    const allRows: string[][] = fetchData.rows.slice(1)
    const fullRows = allRows.map(row => {
      const obj: Record<string, string> = {}
      hdrs.forEach((h, i) => { obj[h] = row[i] ?? '' })
      return obj
    })

    const res = await fetch('/api/admin/data-hub/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, rows: fullRows, mapping, source_name: url.trim(), source: 'google_sheets' }),
    })
    const data = await res.json()
    setResult({ ok: data.rows_ok, err: data.rows_error })
    setStep('done')
    setImporting(false)
  }

  const targetFields = IMPORT_TARGETS[target].fields

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-[12px] text-blue-800">
        <p className="font-semibold mb-1">📌 Как подготовить таблицу</p>
        <p>Открой таблицу в Google → Файл → Доступ → «Все, у кого есть ссылка, могут просматривать».</p>
        <p className="mt-1">Если таблица уже открыта — вставь ссылку ниже и нажми «Загрузить».</p>
      </div>

      {step === 'input' && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-3">
          <div>
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide mb-1">Ссылка на Google Sheets</p>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#111110]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide mb-1">ID листа (gid, необязательно)</p>
              <input value={gid} onChange={e => setGid(e.target.value)}
                placeholder="0"
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#111110]" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide mb-1">Импортировать в</p>
              <select value={target} onChange={e => setTarget(e.target.value as ImportTarget)}
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#111110] bg-white">
                {(Object.keys(IMPORT_TARGETS) as ImportTarget[]).map(k => (
                  <option key={k} value={k}>{IMPORT_TARGETS[k].label}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <button onClick={fetchSheet} disabled={loading}
            className="w-full py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-xl disabled:opacity-40 hover:bg-[#2a2a28]">
            {loading ? 'Загружаю таблицу...' : 'Загрузить и просмотреть'}
          </button>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">Предпросмотр (первые 10 строк)</p>
            <div className="overflow-x-auto">
              <table className="text-[11px] border-collapse">
                <thead>
                  <tr>{headers.slice(0, 6).map(h => <th key={h} className="px-2 py-1 bg-[#f8f8f7] border border-[#e4e4e0] text-left font-semibold text-[#9a9a95] whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 3).map((row, i) => (
                    <tr key={i}>{headers.slice(0, 6).map(h => <td key={h} className="px-2 py-1 border border-[#f0f0ec] text-[#4b4b47] max-w-[120px] truncate">{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">Сопоставление столбцов</p>
            <div className="space-y-2">
              {headers.map(h => (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-[12px] text-[#6b6b66] w-40 flex-shrink-0 truncate">{h}</span>
                  <span className="text-[#c4c4be]">→</span>
                  <select value={mapping[h] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                    className="flex-1 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px] outline-none focus:border-[#111110] bg-white">
                    <option value="">— не импортировать —</option>
                    {targetFields.map(f => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={doImport} disabled={importing}
              className="flex-1 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-xl disabled:opacity-40 hover:bg-[#2a2a28]">
              {importing ? 'Импортируется...' : 'Импортировать все строки'}
            </button>
            <button onClick={() => { setStep('input'); setRows([]) }}
              className="px-4 py-2.5 border border-[#e4e4e0] text-[12px] text-[#6b6b66] rounded-xl hover:bg-[#f8f8f7]">
              Назад
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-center space-y-3">
          <p className="text-3xl">{result.err === 0 ? '✅' : '⚠️'}</p>
          <p className="text-[16px] font-semibold text-[#111110]">Импорт завершён</p>
          <div className="flex justify-center gap-6 text-[13px]">
            <span className="text-emerald-700">✓ Успешно: {result.ok}</span>
            {result.err > 0 && <span className="text-red-600">✗ Ошибок: {result.err}</span>}
          </div>
          <div className="flex justify-center gap-2">
            <button onClick={() => { setStep('input'); setRows([]); setResult(null); setUrl('') }}
              className="px-4 py-2 bg-[#111110] text-white text-[12px] rounded-lg hover:bg-[#2a2a28]">
              Импортировать ещё
            </button>
            <button onClick={onImported}
              className="px-4 py-2 border border-[#e4e4e0] text-[12px] text-[#6b6b66] rounded-lg hover:bg-[#f8f8f7]">
              Посмотреть логи
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function LogsTab() {
  const [logs, setLogs]       = useState<ImportLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/data-hub/logs')
      .then(r => r.json())
      .then(d => { setLogs(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  const fmtDate = (d: string) => new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const targetLabels: Record<string, string> = {
    suppliers: 'Поставщики', b2b_clients: 'B2B Клиенты',
    purchase_orders: 'Закупки', materials: 'Материалы',
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-center py-8 text-[13px] text-[#9a9a95]">Загрузка...</p>
      ) : logs.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
          <p className="text-[13px] text-[#9a9a95]">Импортов ещё не было</p>
          <p className="text-[11px] text-[#9a9a95] mt-1">Используй вкладку «Импорт» или «Google Sheets»</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Источник</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Файл / URL</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Куда</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Строк</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Статус</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Время</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f8f8f7]">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-2.5">
                    <span className="text-base">{SOURCE_ICONS[log.source] ?? '📌'}</span>
                    <span className="ml-1 text-[#6b6b66]">{log.source}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[#9a9a95] max-w-[180px] truncate" title={log.source_name ?? ''}>
                    {log.source_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[#6b6b66]">
                    {targetLabels[log.target_module ?? ''] ?? log.target_module ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-[#111110]">
                    {log.rows_total ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {log.rows_error === 0 || log.rows_error == null ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ {log.rows_ok ?? 0}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" title={log.error_details ?? ''}>
                        ✓ {log.rows_ok} / ✗ {log.rows_error}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[#9a9a95]">{fmtDate(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
