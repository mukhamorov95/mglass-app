'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalWeight?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  services?: { name: string; cost: number }[]
  comment?: string
}

type NotesData = {
  status?: string
  launched_at?: string
  work_started_at?: string
  production_days?: number
  user_notes?: string
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  items: OrderItem[]
  notes: string | null
  total_area: number
  total_weight: number
  created_at: string
}

// ─── Stage definitions ────────────────────────────────────────────────────────

const ITEM_STAGES = [
  { key: 'cutting',   label: 'Резка',     color: '#6366f1' },
  { key: 'polishing', label: 'Полировка', color: '#0ea5e9' },
  { key: 'drilling',  label: 'Сверление', color: '#8b5cf6' },
  { key: 'tempering', label: 'Закалка',   color: '#f97316' },
  { key: 'packaging', label: 'Упаковка',  color: '#22c55e' },
] as const

type GroupAction = { key: string; label: string; icon: string; danger?: boolean }

const GROUP_ACTIONS: GroupAction[] = [
  { key: 'cutting',           label: 'Резка выполнена',       icon: '✂️' },
  { key: 'polishing',         label: 'Полировка выполнена',   icon: '🔲' },
  { key: 'drilling',          label: 'Сверление выполнено',   icon: '🔩' },
  { key: 'sent_to_tempering', label: 'Отправлено на закалку', icon: '🔥' },
  { key: 'from_tempering',    label: 'Вернулось с закалки',   icon: '✅' },
  { key: 'packaging',         label: 'Упаковано',             icon: '📦' },
  { key: 'problem',           label: 'Проблема',              icon: '⚠️', danger: true },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function fmtDate(s: string | undefined | null): string {
  if (!s) return ''
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({ item, index }: { item: OrderItem; index: number }) {
  const svcs    = Array.isArray(item.services) ? item.services.map(s => s.name) : []
  const facet   = item.hasFacet
    ? (item.facetTypeMm ? `Фацет ${item.facetTypeMm} мм` : 'Фацет')
    : null
  const tags    = [
    item.hasTempering ? 'Закалка' : null,
    facet,
    ...svcs,
  ].filter(Boolean) as string[]
  const comment = item.comment?.trim() || null

  return (
    <div className="bg-white border border-[#e8e8e4] rounded-xl overflow-hidden">

      {/* Card header */}
      <div className="px-4 py-3 border-b border-[#f0f0ec]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-[#c4c4be]">#{index + 1}</span>
              <span className="text-[15px] font-bold text-[#111110] leading-tight">
                {item.materialName ?? '—'}
                {item.thickness ? (
                  <span className="text-[13px] font-normal text-[#6b6b66] ml-1.5">
                    {item.thickness} мм
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-[13px] text-[#6b6b66]">
              <span className="font-mono font-semibold text-[#111110]">
                {item.width ?? '—'}×{item.height ?? '—'} мм
              </span>
              <span>·</span>
              <span>
                {item.quantity ?? 1}&nbsp;{plural(item.quantity ?? 1, 'шт', 'шт', 'шт')}
              </span>
              {(item.totalAreaNet ?? 0) > 0 && (
                <>
                  <span>·</span>
                  <span className="text-[12px]">{(item.totalAreaNet ?? 0).toFixed(3)} м²</span>
                </>
              )}
            </div>
          </div>
          {item.category && (
            <span className="text-[10px] text-[#9a9a95] bg-[#f4f4f0] px-1.5 py-0.5 rounded flex-shrink-0">
              {item.category}
            </span>
          )}
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag, ti) => (
              <span
                key={ti}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  tag === 'Закалка'
                    ? 'bg-orange-50 text-orange-700 border border-orange-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Comment */}
        {comment && (
          <p className="mt-1.5 text-[11px] text-[#8a8a85] italic">{comment}</p>
        )}
      </div>

      {/* Stages row */}
      <div className="px-4 py-2.5 bg-[#fafaf9]">
        <div className="flex gap-1.5 flex-wrap">
          {ITEM_STAGES.map(stage => {
            const skip = stage.key === 'drilling' && !(item.services?.some(s =>
              /сверл|drill/i.test(s.name)
            )) && false // show all for now — filter in Commit 4
            if (skip) return null
            return (
              <div key={stage.key} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-medium text-[#c4c4be] bg-[#f4f4f0] border border-[#e8e8e4] px-2 py-0.5 rounded-md whitespace-nowrap">
                  {stage.label}
                </span>
                <span className="text-[8px] text-[#c4c4be]">ожидает</span>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MobileOrderWorkPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const id = Number(orderId)

  const [order, setOrder]     = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setError('Не авторизован. Войдите в систему.'); setLoading(false); return }

      const { data, error: dbErr } = await sb
        .from('b2b_orders')
        .select('id,client_name,custom_number,client_order_number,items,notes,total_area,total_weight,created_at')
        .eq('id', id)
        .single()

      if (dbErr || !data) { setError('Заказ не найден'); setLoading(false); return }

      setOrder({
        ...data,
        items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
      })
      setLoading(false)
    }

    if (id && !isNaN(id)) load()
    else { setError('Неверный ID заказа'); setLoading(false) }
  }, [id])

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center">
      <div className="text-[14px] text-[#8a8a85]">Загрузка...</div>
    </div>
  )

  // ─── Error ─────────────────────────────────────────────────────────────────

  if (error || !order) return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center px-4">
      <div className="text-center max-w-xs">
        <div className="text-4xl mb-4">🔍</div>
        <p className="text-[15px] font-semibold text-[#111110] mb-2">{error ?? 'Ошибка загрузки'}</p>
        <p className="text-[13px] text-[#8a8a85] mb-5">
          Попробуйте открыть производственный лист и сканировать QR ещё раз.
        </p>
        <Link
          href="/b2b-orders"
          className="text-[13px] text-blue-600 underline underline-offset-2"
        >
          Перейти к списку заказов
        </Link>
      </div>
    </div>
  )

  // ─── Derived values ────────────────────────────────────────────────────────

  const pn          = parseNotes(order.notes)
  const launchDate  = fmtDate(pn.launched_at ?? pn.work_started_at)
  const orderLabel  = order.custom_number?.trim() || `#${order.id}`
  const totalQty    = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)
  const totalArea   = (order.total_area ?? 0) > 0
    ? order.total_area
    : order.items.reduce((s, i) => s + (i.totalAreaNet ?? 0), 0)
  const totalWeight = (order.total_weight ?? 0) > 0
    ? order.total_weight
    : order.items.reduce((s, i) => s + (i.totalWeight ?? 0), 0)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-10">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e4e4e0] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/b2b-orders"
            className="text-[#6b6b66] hover:text-[#111110] transition-colors p-1 -ml-1"
            aria-label="Назад"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <p className="text-[10px] text-[#9a9a95] uppercase tracking-widest leading-none mb-0.5">Производство</p>
            <p className="text-[15px] font-bold text-[#111110] leading-none">{orderLabel}</p>
          </div>
        </div>
        <div className="text-[11px] text-[#9a9a95]">
          {order.items.length}&nbsp;{plural(order.items.length, 'позиция', 'позиции', 'позиций')}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* ── Read-only warning ─────────────────────────────────────────────── */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <span className="text-[18px] flex-shrink-0 mt-0.5">ℹ️</span>
          <div>
            <p className="text-[13px] font-semibold text-amber-800">Режим просмотра</p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Отметки этапов будут доступны на следующем этапе разработки.
            </p>
          </div>
        </div>

        {/* ── Order summary card ────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e8e8e4] rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-[14px] font-bold text-[#111110]">{order.client_name}</p>
          {order.client_order_number && (
            <p className="text-[12px] text-[#6b6b66]">
              Номер клиента: <span className="font-mono">{order.client_order_number}</span>
            </p>
          )}
          {launchDate && (
            <p className="text-[12px] text-[#6b6b66]">
              Запуск: <span className="font-medium text-emerald-700">{launchDate}</span>
              {pn.production_days ? (
                <span className="text-[#9a9a95]"> · {pn.production_days} дн.</span>
              ) : null}
            </p>
          )}
          <div className="flex gap-3 flex-wrap pt-0.5">
            <span className="text-[12px] text-[#6b6b66]">
              <span className="font-semibold text-[#111110]">{totalQty}</span> шт
            </span>
            {totalArea > 0 && (
              <span className="text-[12px] text-[#6b6b66]">
                <span className="font-semibold text-[#111110]">{totalArea.toFixed(2)}</span> м²
              </span>
            )}
            {totalWeight > 0 && (
              <span className="text-[12px] text-[#6b6b66]">
                <span className="font-semibold text-[#111110]">{totalWeight.toFixed(1)}</span> кг
              </span>
            )}
          </div>
        </div>

        {/* ── Items list ────────────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2.5 px-0.5">
            Позиции
          </p>

          {order.items.length === 0 ? (
            <div className="bg-white border border-[#e8e8e4] rounded-xl px-4 py-8 text-center">
              <p className="text-[14px] text-[#9a9a95]">В заказе нет позиций</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {order.items.map((item, idx) => (
                <ItemCard key={idx} item={item} index={idx} />
              ))}
            </div>
          )}
        </div>

        {/* ── Group actions (disabled) ──────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2.5 px-0.5">
            Групповые действия
          </p>
          <div className="bg-white border border-[#e8e8e4] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-[#f8f8f7] border-b border-[#f0f0ec]">
              <p className="text-[11px] text-[#9a9a95]">
                Будет доступно после подключения сохранения этапов
              </p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {GROUP_ACTIONS.map(action => (
                <button
                  key={action.key}
                  disabled
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium
                    border transition-none cursor-not-allowed opacity-40 select-none
                    ${action.danger
                      ? 'border-red-200 text-red-600 bg-red-50'
                      : 'border-[#e8e8e4] text-[#6b6b66] bg-[#f8f8f7]'
                    }`}
                >
                  <span className="text-[16px] leading-none">{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
