'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

interface ISpeechRecognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((e: any) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechWindow = {
  SpeechRecognition?: new () => ISpeechRecognition
  webkitSpeechRecognition?: new () => ISpeechRecognition
}

type Spec = { label: string; value: string; accent?: boolean }
type Item = { name: string; desc?: string; qty?: string; price?: string; sum?: string }
type Form = {
  number: string; date: string; valid_until: string; valid_until_iso?: string
  title: string; subtitle: string
  client_name: string; client_phone: string
  spec: Spec[]; items: Item[]
  subtotal: string; total: string
  spec_note: string; vat_label: string; vat_note: string
  production_days: string; warranty: string; vat: string
  photo_url: string | null
}

type HistoryRow = {
  id: number; number: string; client_name: string | null
  total: number | null; status: string; manager_name: string | null; created_at: string
  content: Record<string, unknown>
}

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const numOr = (v: string | number | undefined) => {
  if (v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : 0
}
const RUB = (v: string | number | undefined) => numOr(v).toLocaleString('ru-RU')

function emptyForm(): Form {
  const now = new Date()
  const till = new Date(now.getTime() + 10 * 86400000)
  return {
    number: '', date: fmtDate(now), valid_until: fmtDate(till), valid_until_iso: isoDate(till),
    title: '', subtitle: '', client_name: '', client_phone: '',
    spec: [], items: [],
    subtotal: '', total: '',
    spec_note: 'Стекло закалённое и безопасное: при повреждении рассыпается на мелкие неострые фрагменты. Кромка полируется по всему периметру.',
    vat_label: 'НДС 5% ВКЛЮЧЁН', vat_note: '', production_days: '15 раб. дней', warranty: 'Изделие + монтаж', vat: '5% включён',
    photo_url: null,
  }
}

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white'

export default function KpPage() {
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [form, setForm] = useState<Form>(emptyForm())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [transcript, setTranscript] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [canDelete, setCanDelete] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [interimText, setInterimText] = useState('')
  const [speechSupported, setSpeechSupported] = useState(true)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const transcriptRef = useRef('')

  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => {
    setSpeechSupported(typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window))
  }, [])

  // Подтяжка из «Быстрого расчёта» (/calculator/quick)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mglass_kp_prefill')
      if (!raw) return
      sessionStorage.removeItem('mglass_kp_prefill')
      const p = JSON.parse(raw) as { title?: string; items?: { name: string; qty?: number; price?: number; sum?: number }[]; subtotal?: number; total?: number }
      setTab('new')
      setForm(f => ({
        ...f,
        title: p.title ?? f.title,
        items: Array.isArray(p.items) ? p.items.map(it => ({
          name: String(it.name ?? ''),
          qty: it.qty != null ? String(it.qty) : '',
          price: it.price != null ? String(it.price) : '',
          sum: it.sum != null ? String(it.sum) : '',
        })) : f.items,
        subtotal: p.subtotal != null ? String(p.subtotal) : f.subtotal,
        total: p.total != null ? String(p.total) : f.total,
      }))
    } catch { /* ignore */ }
  }, [])

  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setSavedId(null) }

  async function loadHistory() {
    try {
      const res = await fetch('/api/kp')
      const data = await res.json()
      setHistory(Array.isArray(data.items) ? data.items : [])
      setCanDelete(!!data.canDelete)
      const now = new Date()
      setExpanded(new Set([`${now.getFullYear()}-${now.getMonth()}`]))
    } catch { setHistory([]) }
  }

  async function deleteKp(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Удалить это КП безвозвратно?')) return
    try {
      const res = await fetch('/api/kp', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      if (res.ok) setHistory(prev => prev.filter(r => r.id !== id))
    } catch { /* ignore */ }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])

  // ── voice (браузерное распознавание, живое) ─────────────
  function startRec() {
    const w = window as unknown as SpeechWindow
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) { setBusy('Голос не поддерживается в этом браузере — впишите текст ниже'); setTimeout(() => setBusy(null), 3500); return }
    const rec = new SR()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '', finalChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += t; else interim += t
      }
      if (finalChunk) setTranscript(prev => (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + finalChunk)
      setInterimText(interim)
    }
    rec.onerror = () => { setRecording(false); setInterimText('') }
    rec.onend = () => { setRecording(false); setInterimText('') }
    recognitionRef.current = rec
    rec.start(); setRecording(true); setBusy(null)
  }

  function stopRec() {
    recognitionRef.current?.stop()
    setRecording(false); setInterimText('')
    setTimeout(() => { const t = transcriptRef.current.trim(); if (t) structure(t) }, 350)
  }

  async function structure(text: string) {
    setBusy('AI раскладывает по структуре…')
    try {
      const existing = { title: form.title, subtitle: form.subtitle, spec: form.spec, items: form.items,
        subtotal: form.subtotal, total: form.total, production_days: form.production_days, warranty: form.warranty }
      const res = await fetch('/api/ai/kp-structure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, existing }),
      }).then(r => r.json())
      if (res.kp) applyKp(res.kp)
      else setBusy('Не удалось разобрать')
    } catch { setBusy('Ошибка разбора') } finally { setTimeout(() => setBusy(null), 800) }
  }

  function applyKp(kp: Record<string, unknown>) {
    setForm(f => {
      const next = { ...f }
      const s = (k: keyof Form, v: unknown) => { if (v != null && v !== '') (next as Record<string, unknown>)[k] = String(v) }
      s('title', kp.title); s('subtitle', kp.subtitle); s('client_name', kp.client_name); s('client_phone', kp.client_phone)
      s('warranty', kp.warranty); s('valid_until', kp.valid_until); s('spec_note', kp.spec_note)
      if (Array.isArray(kp.spec) && kp.spec.length) next.spec = (kp.spec as Spec[]).map(x => ({ label: String(x.label ?? ''), value: String(x.value ?? ''), accent: x.accent }))
      if (Array.isArray(kp.items) && kp.items.length) next.items = (kp.items as Record<string, unknown>[]).map(x => ({
        name: String(x.name ?? ''), desc: x.desc ? String(x.desc) : '',
        qty: x.qty != null ? String(x.qty) : '1', price: x.price != null ? String(x.price) : '', sum: x.sum != null ? String(x.sum) : '',
      }))
      if (kp.subtotal != null) next.subtotal = String(kp.subtotal)
      if (kp.total != null) next.total = String(kp.total)
      return recompute(next)
    })
    setSavedId(null)
  }

  // ── items math ─────────────────────────────────────────
  function recompute(f: Form): Form {
    const items = f.items.map(it => {
      const sum = it.sum && numOr(it.sum) ? it.sum : String(numOr(it.qty || '1') * numOr(it.price))
      return { ...it, sum }
    })
    const subtotal = items.reduce((s, it) => s + numOr(it.sum), 0)
    return { ...f, items, subtotal: subtotal ? String(subtotal) : f.subtotal, total: f.total && numOr(f.total) ? f.total : (subtotal ? String(subtotal) : f.total) }
  }
  const updItem = (i: number, patch: Partial<Item>) => setForm(f => { const items = f.items.slice(); items[i] = { ...items[i], ...patch, sum: patch.sum ?? '' }; return recompute({ ...f, items }) })
  const addItem = () => set({ items: [...form.items, { name: '', desc: '', qty: '1', price: '', sum: '' }] })
  const rmItem = (i: number) => setForm(f => recompute({ ...f, items: f.items.filter((_, j) => j !== i) }))
  const updSpec = (i: number, patch: Partial<Spec>) => setForm(f => { const spec = f.spec.slice(); spec[i] = { ...spec[i], ...patch }; return { ...f, spec } })
  const addSpec = () => set({ spec: [...form.spec, { label: '', value: '', accent: false }] })
  const rmSpec = (i: number) => set({ spec: form.spec.filter((_, j) => j !== i) })

  // ── photo ──────────────────────────────────────────────
  async function uploadPhoto(file: File) {
    setBusy('Загрузка фото…')
    try {
      const sb = createClient()
      const path = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await sb.storage.from('kp-photos').upload(path, file, { upsert: true })
      if (error) { setBusy('Ошибка загрузки фото'); setTimeout(() => setBusy(null), 2500); return }
      const { data } = sb.storage.from('kp-photos').getPublicUrl(path)
      set({ photo_url: data.publicUrl })
    } finally { setBusy(null) }
  }

  // ── save ───────────────────────────────────────────────
  async function save() {
    setSaving(true); setSaveError(null)
    try {
      const content = { ...form }
      if (editingId) {
        const res = await fetch('/api/kp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingId, content }) })
        const data = await res.json().catch(() => ({}))
        if (res.ok) setSavedId(editingId)
        else setSaveError(data.error || `Ошибка ${res.status}`)
      } else {
        const res = await fetch('/api/kp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.id) {
          setEditingId(data.id)
          // setForm напрямую (не set — тот сбрасывает savedId)
          if (data.number && !form.number) setForm(f => ({ ...f, number: data.number }))
          setSavedId(data.id)
        } else {
          setSaveError(data.error || `Ошибка ${res.status}`)
        }
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally { setSaving(false) }
  }

  function editRow(r: HistoryRow) {
    const c = r.content as Partial<Form>
    setForm({ ...emptyForm(), ...c, spec: c.spec ?? [], items: c.items ?? [], photo_url: c.photo_url ?? null, number: r.number })
    setEditingId(r.id); setSavedId(null); setTranscript(''); setTab('new')
  }

  function newKp() { setForm(emptyForm()); setEditingId(null); setSavedId(null); setTranscript(''); setTab('new') }

  // group history by month
  const groups = (() => {
    const m = new Map<string, { label: string; rows: HistoryRow[] }>()
    for (const r of history) {
      const d = new Date(r.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!m.has(key)) m.set(key, { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, rows: [] })
      m.get(key)!.rows.push(r)
    }
    return [...m.entries()]
  })()

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Коммерческие предложения</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Надиктуйте голосом — AI соберёт КП, отредактируйте и получите PDF</p>
          </div>
          <div className="flex gap-1 bg-white border border-[#e4e4e0] rounded-lg p-1">
            <button onClick={newKp} className={`px-3 py-1.5 text-[13px] font-medium rounded-md ${tab === 'new' ? 'bg-[#111110] text-white' : 'text-[#6b6b66]'}`}>Новое КП</button>
            <button onClick={() => setTab('history')} className={`px-3 py-1.5 text-[13px] font-medium rounded-md ${tab === 'history' ? 'bg-[#111110] text-white' : 'text-[#6b6b66]'}`}>История</button>
          </div>
        </div>

        {tab === 'new' ? (
          <div className="space-y-4">
            {/* voice */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={recording ? stopRec : startRec}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-[#E1442E] text-white hover:bg-[#c93a26]'}`}>
                  {recording ? '⏹ Остановить и разобрать' : '🎤 Записать голосом'}
                </button>
                {busy && <span className="text-[12px] text-[#6b6b66]">{busy}</span>}
                {recording && <span className="text-[12px] text-red-500">● идёт запись, говорите…</span>}
                {form.title && !busy && !recording && <span className="text-[12px] text-emerald-600">✓ структура собрана — проверьте ниже</span>}
              </div>
              {!speechSupported && <p className="text-[12px] text-amber-600 mt-2">Голосовой ввод недоступен в этом браузере — впишите текст вручную и нажмите «Разобрать».</p>}
              <textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Здесь появится расшифровка. Можно править текст и нажать «Разобрать»."
                className="w-full mt-3 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] h-20 resize-y" />
              {interimText && <p className="text-[12px] text-[#9a9a95] mt-1 italic">…{interimText}</p>}
              <button onClick={() => transcript.trim() && structure(transcript)} disabled={!transcript.trim() || !!busy}
                className="mt-2 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] disabled:opacity-50">Разобрать текст → структуру</button>
            </div>

            {/* header fields */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 grid grid-cols-3 gap-3">
              <div><label className={L}>Номер КП</label><input className={I} value={form.number} onChange={e => set({ number: e.target.value })} placeholder="авто" /></div>
              <div><label className={L}>Дата</label><input className={I} value={form.date} onChange={e => set({ date: e.target.value })} /></div>
              <div><label className={L}>Актуально до</label><input className={I} value={form.valid_until} onChange={e => set({ valid_until: e.target.value })} /></div>
              <div className="col-span-3"><label className={L}>Заголовок</label><input className={I} value={form.title} onChange={e => set({ title: e.target.value })} placeholder="ДУШЕВАЯ КАБИНА CRYSTAL VISION" /></div>
              <div className="col-span-3"><label className={L}>Подзаголовок</label><input className={I} value={form.subtitle} onChange={e => set({ subtitle: e.target.value })} placeholder="Осветлённое закалённое стекло 8 мм · фурнитура VETRO…" /></div>
              <div><label className={L}>Клиент (внутр.)</label><input className={I} value={form.client_name} onChange={e => set({ client_name: e.target.value })} /></div>
              <div><label className={L}>Телефон (внутр.)</label><input className={I} value={form.client_phone} onChange={e => set({ client_phone: e.target.value })} /></div>
              <div><label className={L}>Итого, ₽</label><input className={I} value={form.total} onChange={e => set({ total: e.target.value })} placeholder="авто из сметы" /></div>
            </div>

            {/* spec */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#111110]">01 · Спецификация</span>
                <button onClick={addSpec} className="text-[12px] text-[#E1442E] font-medium">+ строка</button>
              </div>
              <div className="space-y-2">
                {form.spec.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={`${I} flex-1`} value={s.label} onChange={e => updSpec(i, { label: e.target.value })} placeholder="ГАБАРИТЫ" />
                    <input className={`${I} flex-1`} value={s.value} onChange={e => updSpec(i, { value: e.target.value })} placeholder="1244 × 1000 мм" />
                    <button onClick={() => updSpec(i, { accent: !s.accent })} title="Выделить красным" className={`px-2 py-1.5 rounded-lg text-[12px] ${s.accent ? 'bg-[#E1442E] text-white' : 'bg-[#f0f0ec] text-[#9a9a95]'}`}>A</button>
                    <button onClick={() => rmSpec(i)} className="px-2 py-1.5 text-[#c4c4be] hover:text-red-500">✕</button>
                  </div>
                ))}
                {!form.spec.length && <p className="text-[12px] text-[#9a9a95]">Пусто — надиктуйте или добавьте строку.</p>}
              </div>
            </div>

            {/* estimate */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#111110]">02 · Смета</span>
                <button onClick={addItem} className="text-[12px] text-[#E1442E] font-medium">+ позиция</button>
              </div>
              <div className="space-y-3">
                {form.items.map((it, i) => (
                  <div key={i} className="border border-[#f0f0ec] rounded-lg p-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[12px] font-bold text-[#E1442E] w-6">{pad(i + 1)}</span>
                      <input className={`${I} flex-1`} value={it.name} onChange={e => updItem(i, { name: e.target.value })} placeholder="Наименование" />
                      <button onClick={() => rmItem(i)} className="px-2 py-1.5 text-[#c4c4be] hover:text-red-500">✕</button>
                    </div>
                    <input className={`${I} mb-2`} value={it.desc ?? ''} onChange={e => updItem(i, { desc: e.target.value })} placeholder="Описание позиции" />
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><label className={L}>Кол-во</label><input className={I} value={it.qty ?? ''} onChange={e => updItem(i, { qty: e.target.value })} /></div>
                      <div className="flex-1"><label className={L}>Цена, ₽</label><input className={I} value={it.price ?? ''} onChange={e => updItem(i, { price: e.target.value })} /></div>
                      <div className="flex-1"><label className={L}>Сумма, ₽</label><input className={I} value={it.sum ?? ''} onChange={e => updItem(i, { sum: e.target.value })} placeholder={RUB(numOr(it.qty || '1') * numOr(it.price))} /></div>
                    </div>
                  </div>
                ))}
                {!form.items.length && <p className="text-[12px] text-[#9a9a95]">Пусто — надиктуйте или добавьте позицию.</p>}
              </div>
              {!!form.items.length && (
                <div className="flex justify-end gap-6 mt-3 text-[13px] font-semibold text-[#111110]">
                  <span className="text-[#9a9a95]">Промежуточный итог</span><span>{RUB(form.subtotal)} ₽</span>
                </div>
              )}
            </div>

            {/* conditions + photo */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 grid grid-cols-3 gap-3">
              <div><label className={L}>Срок изготовления</label>
                <select className={I} value={form.production_days} onChange={e => set({ production_days: e.target.value })}>
                  {['10 раб. дней', '12 раб. дней', '15 раб. дней', '20 раб. дней', '25 раб. дней'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className={L}>Гарантия</label><input className={I} value={form.warranty} onChange={e => set({ warranty: e.target.value })} /></div>
              <div><label className={L}>НДС</label><input className={I} value={form.vat} onChange={e => set({ vat: e.target.value })} /></div>
              <div className="col-span-3">
                <label className={L}>Фото / чертёж изделия (в PDF)</label>
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0])} className="text-[12px]" />
                  {form.photo_url && (
                    <>{/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.photo_url} alt="" className="h-14 rounded border border-[#e4e4e0]" />
                    <button onClick={() => set({ photo_url: null })} className="text-[12px] text-red-500">убрать</button></>
                  )}
                </div>
              </div>
            </div>

            {/* actions */}
            <div className="flex items-center gap-3 sticky bottom-4">
              <button onClick={save} disabled={saving || (!form.title && !form.items.length)}
                className="px-5 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50 shadow-lg">
                {saving ? 'Сохранение…' : editingId ? 'Сохранить изменения' : 'Сохранить КП'}
              </button>
              {savedId && (
                <a href={`/kp/${savedId}/print?print=1`} target="_blank" rel="noreferrer"
                  className="px-5 py-2.5 bg-[#E1442E] text-white text-[13px] font-semibold rounded-lg hover:bg-[#c93a26] shadow-lg">
                  💾 Сохранить в PDF
                </a>
              )}
              {savedId && (
                <a href={`/kp/${savedId}/print`} target="_blank" rel="noreferrer"
                  className="px-4 py-2.5 bg-white border border-[#e4e4e0] text-[#6b6b66] text-[13px] font-medium rounded-lg hover:bg-[#fafaf9]">
                  Открыть
                </a>
              )}
              {savedId && <span className="text-[12px] text-emerald-600">Сохранено ✓</span>}
              {saveError && <span className="text-[12px] text-red-600">Не сохранилось: {saveError}</span>}
            </div>
          </div>
        ) : (
          /* ── HISTORY ── */
          <div className="space-y-3">
            {!history.length && <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[13px] text-[#9a9a95]">Пока нет КП. Создайте первое во вкладке «Новое КП».</div>}
            {groups.map(([key, g]) => {
              const open = expanded.has(key)
              const sum = g.rows.reduce((s, r) => s + (r.total ?? 0), 0)
              return (
                <div key={key} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <button onClick={() => setExpanded(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafaf9]">
                    <span className="flex items-center gap-2"><span className="text-[11px] text-[#6b6b66] w-3">{open ? '▼' : '▶'}</span>
                      <span className="text-[14px] font-semibold text-[#111110]">{g.label}</span>
                      <span className="text-[11px] text-[#9a9a95]">· {g.rows.length} КП · {RUB(sum)} ₽</span></span>
                  </button>
                  {open && (
                    <div className="divide-y divide-[#f5f5f3] border-t border-[#f0f0ec]">
                      {g.rows.map(r => (
                        <div key={r.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-[#fafaf9]">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[#111110] truncate">№ {r.number} · {(r.content?.title as string) ?? r.client_name ?? 'без названия'}</p>
                            <p className="text-[11px] text-[#9a9a95]">{r.client_name ?? ''} · {r.manager_name ?? ''} · {new Date(r.created_at).toLocaleDateString('ru-RU')}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-[13px] font-semibold text-[#111110]">{RUB(r.total ?? 0)} ₽</span>
                            <button onClick={() => editRow(r)} className="text-[12px] text-[#6b6b66] hover:text-[#111110]">✏️</button>
                            <a href={`/kp/${r.id}/print`} target="_blank" rel="noreferrer" className="text-[12px] text-[#E1442E] font-medium">PDF</a>
                            {canDelete && <button onClick={e => deleteKp(r.id, e)} className="text-[12px] text-red-400 hover:text-red-600" title="Удалить (только админ)">🗑</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
