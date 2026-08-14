'use client'

import { useEffect, useState } from 'react'
import { createScopedClient } from '@/lib/supabase-browser'
import {
  type B2BLegalEntity, type EntityForm, ENTITY_FIELDS,
  emptyEntityForm, entityToForm, formToRow, entityTitle,
} from '@/lib/b2bLegalEntities'

// Управление юрлицами клиента в CRM-карточке. Реквизиты добавляются, не затирая
// старые (add-without-delete): «Убрать» лишь снимает active. Основное юрлицо
// зеркалится в плоские колонки b2b_clients — счёт/пакетный счёт заполняются сами.

const TABLE = 'b2b_client_legal_entities'

export default function EntitiesEditor({ clientId, orgId, onChanged }: { clientId: number; orgId: number; onChanged?: () => void }) {
  const [list, setList] = useState<B2BLegalEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null | undefined>(undefined) // undefined = форма закрыта, null = новое
  const [form, setForm] = useState<EntityForm>(emptyEntityForm())
  const [paste, setPaste] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 2000) }

  async function load() {
    const { fromOrg } = createScopedClient(orgId)
    const { data } = await fromOrg(TABLE)
      .eq('client_id', clientId).eq('active', true)
      .order('is_default', { ascending: false }).order('id', { ascending: true })
    setList((data ?? []) as B2BLegalEntity[])
    setLoading(false)
  }
  // Загрузка в .then-колбэке (setState не синхронно в теле эффекта — правило
  // react-hooks/set-state-in-effect). load() выше — для перезагрузки после действий.
  useEffect(() => {
    let alive = true
    const { fromOrg } = createScopedClient(orgId)
    fromOrg(TABLE).eq('client_id', clientId).eq('active', true)
      .order('is_default', { ascending: false }).order('id', { ascending: true })
      .then((res: { data: B2BLegalEntity[] | null }) => { if (alive) { setList(res.data ?? []); setLoading(false) } })
    return () => { alive = false }
  }, [clientId, orgId])

  // Основное юрлицо → плоские колонки b2b_clients (совместимость).
  async function mirrorDefault(form: EntityForm) {
    const { sb } = createScopedClient(orgId)
    await sb.from('b2b_clients').update(formToRow(form)).eq('id', clientId).eq('organization_id', orgId)
  }

  function openNew() { setForm(emptyEntityForm()); setEditingId(null); setPaste('') }
  function openEdit(e: B2BLegalEntity) { setForm(entityToForm(e)); setEditingId(e.id); setPaste('') }
  function closeForm() { setEditingId(undefined) }

  async function parse() {
    if (!paste.trim()) return
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: paste }),
      })
      const cu = (await r.json()).customer ?? {}
      setForm(prev => ({
        ...prev,
        full_name: cu.name ?? prev.full_name, inn: cu.inn ?? prev.inn, kpp: cu.kpp ?? prev.kpp,
        ogrn: cu.ogrn ?? prev.ogrn, legal_address: cu.legal_address ?? cu.address ?? prev.legal_address,
        bank_account: cu.account ?? prev.bank_account, bank_name: cu.bank ?? prev.bank_name,
        bik: cu.bik ?? prev.bik, corr_account: cu.corr_account ?? prev.corr_account,
      }))
      flash('Реквизиты разобраны — проверьте поля')
    } catch { flash('Не удалось разобрать текст') } finally { setParsing(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const { sb, insertOrg } = createScopedClient(orgId)
      const row = formToRow(form)
      if (editingId == null) {
        // Новое юрлицо. Первое у клиента становится основным.
        const isFirst = list.length === 0
        const { error } = await insertOrg(TABLE, { ...row, client_id: clientId, is_default: isFirst, active: true })
        if (error) { flash('Ошибка при добавлении'); return }
        if (isFirst) await mirrorDefault(form)
        flash('Юрлицо добавлено')
      } else {
        const { error } = await sb.from(TABLE).update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', editingId).eq('organization_id', orgId)
        if (error) { flash('Ошибка при сохранении'); return }
        if (list.find(e => e.id === editingId)?.is_default) await mirrorDefault(form)
        flash('Сохранено')
      }
      closeForm(); await load(); onChanged?.()
    } finally { setSaving(false) }
  }

  async function makeDefault(e: B2BLegalEntity) {
    setBusyId(e.id)
    try {
      const { sb } = createScopedClient(orgId)
      await sb.from(TABLE).update({ is_default: false }).eq('client_id', clientId).eq('organization_id', orgId)
      await sb.from(TABLE).update({ is_default: true }).eq('id', e.id).eq('organization_id', orgId)
      await mirrorDefault(entityToForm(e))
      flash('Основное юрлицо изменено'); await load(); onChanged?.()
    } finally { setBusyId(null) }
  }

  async function deactivate(e: B2BLegalEntity) {
    if (!confirm(`Убрать юрлицо «${entityTitle(e)}» из списка? Старые счета не изменятся.`)) return
    setBusyId(e.id)
    try {
      const { sb } = createScopedClient(orgId)
      await sb.from(TABLE).update({ active: false, is_default: false }).eq('id', e.id).eq('organization_id', orgId)
      // если убрали основное — назначим основным первое из оставшихся
      const rest = list.filter(x => x.id !== e.id)
      if (e.is_default && rest[0]) {
        await sb.from(TABLE).update({ is_default: true }).eq('id', rest[0].id).eq('organization_id', orgId)
        await mirrorDefault(entityToForm(rest[0]))
      }
      flash('Юрлицо убрано'); await load(); onChanged?.()
    } finally { setBusyId(null) }
  }

  if (loading) return <div className="text-[12px] text-[#9a9a95] py-2">Загрузка юрлиц…</div>

  return (
    <div className="space-y-3">
      {msg && <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 inline-block">{msg}</div>}

      {list.length === 0 && editingId === undefined && (
        <p className="text-[12px] text-[#9a9a95]">Юрлиц пока нет. Добавьте первое — оно будет подставляться в счета.</p>
      )}

      {list.map(e => (
        <div key={e.id} className="border border-[#e4e4e0] rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-[#111110] truncate">
              {entityTitle(e)}
              {e.is_default && <span className="ml-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 align-middle">основное</span>}
            </p>
            <p className="text-[11px] text-[#9a9a95] truncate">
              {[e.inn && `ИНН ${e.inn}`, e.kpp && `КПП ${e.kpp}`, e.bank_name, e.bank_account && `р/с ${e.bank_account}`].filter(Boolean).join(' · ') || '— реквизиты не заполнены'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!e.is_default && (
              <button onClick={() => makeDefault(e)} disabled={busyId === e.id}
                className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40">Сделать основным</button>
            )}
            <button onClick={() => openEdit(e)} className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110]">Изменить</button>
            <button onClick={() => deactivate(e)} disabled={busyId === e.id}
              className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-red-400 hover:border-red-400 hover:text-red-600 disabled:opacity-40">Убрать</button>
          </div>
        </div>
      ))}

      {editingId === undefined ? (
        <button onClick={openNew} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28]">＋ Добавить юрлицо</button>
      ) : (
        <div className="border border-[#d4d4cf] rounded-xl p-3 bg-[#fafaf9] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-bold text-[#111110]">{editingId == null ? 'Новое юрлицо' : 'Изменить юрлицо'}</h4>
            <button onClick={closeForm} className="text-[#9a9a95] hover:text-[#111110] text-[13px]">✕</button>
          </div>
          <div className="flex items-start gap-2">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2}
              placeholder="Вставьте реквизиты одним куском — разберу автоматически…"
              className="flex-1 border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white resize-y" />
            <button onClick={parse} disabled={parsing || !paste.trim()}
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 whitespace-nowrap">{parsing ? 'Разбираю…' : '🪄 Разобрать'}</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {ENTITY_FIELDS.map(f => (
              <div key={f.key} className={f.wide ? 'md:col-span-3' : ''}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{f.label}</p>
                <input type={f.type === 'date' ? 'date' : 'text'} value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="text-[12px] font-semibold bg-[#111110] text-white px-4 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">{saving ? '…' : 'Сохранить юрлицо'}</button>
            <button onClick={closeForm} className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110]">Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}
