'use client'

import { useEffect, useState } from 'react'

// A7: партнёр сам ведёт свои юрлица (реквизиты для счёта). Данные — /api/partner/legal-entities.

type Entity = {
  id: number; full_name: string | null; inn: string | null; kpp: string | null; ogrn: string | null
  legal_address: string | null; bank_account: string | null; bank_name: string | null
  bik: string | null; corr_account: string | null; is_default: boolean
}
type Form = { id?: number; full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string; bank_name: string; bank_account: string; bik: string; corr_account: string }

const EMPTY: Form = { full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_name: '', bank_account: '', bik: '', corr_account: '' }
const toForm = (e: Entity): Form => ({
  id: e.id, full_name: e.full_name ?? '', inn: e.inn ?? '', kpp: e.kpp ?? '', ogrn: e.ogrn ?? '',
  legal_address: e.legal_address ?? '', bank_name: e.bank_name ?? '', bank_account: e.bank_account ?? '', bik: e.bik ?? '', corr_account: e.corr_account ?? '',
})

const FIELDS: [keyof Form, string, boolean][] = [
  ['full_name', 'Полное наименование', true], ['inn', 'ИНН', false], ['kpp', 'КПП', false],
  ['ogrn', 'ОГРН / ОГРНИП', false], ['legal_address', 'Юридический адрес', true],
  ['bank_name', 'Банк', false], ['bank_account', 'Расчётный счёт', false], ['bik', 'БИК', false], ['corr_account', 'Корр. счёт', false],
]

export default function LegalEntities() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function load() {
    return fetch('/api/partner/legal-entities').then(r => r.json())
      .then((d: { entities: Entity[] }) => setEntities(d.entities ?? [])).catch(() => setEntities([]))
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function save() {
    if (!form) return
    if (!form.full_name.trim()) { setErr('Укажите наименование'); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/partner/legal-entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Ошибка'); return }
      setForm(null); await load()
    } catch { setErr('Сеть недоступна') } finally { setSaving(false) }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>Юридические лица</h3>
        {!form && <button className="ghost" style={{ padding: '6px 12px' }} onClick={() => { setForm({ ...EMPTY }); setErr(null) }}>＋ Добавить</button>}
      </div>

      <div style={{ padding: '4px 2px 2px' }}>
        {loading && <div className="cap">Загрузка…</div>}

        {!loading && !form && entities.length === 0 && (
          <div className="cap">Реквизиты не заданы. Добавьте юрлицо — оно подставится в счёт-спецификацию.</div>
        )}

        {!loading && !form && entities.map(e => (
          <div key={e.id} onClick={() => { setForm(toForm(e)); setErr(null) }}
            style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{e.full_name || 'Без названия'}</span>
              {e.is_default && <span className="pill p-quote" style={{ fontSize: 11, padding: '2px 8px' }}>основное</span>}
              <span className="cap" style={{ marginLeft: 'auto' }}>изменить ✎</span>
            </div>
            <div className="cap" style={{ marginTop: 4 }}>{[e.inn ? `ИНН ${e.inn}` : '', e.kpp ? `КПП ${e.kpp}` : ''].filter(Boolean).join(' · ') || 'реквизиты не заполнены'}</div>
            {e.legal_address && <div className="cap" style={{ marginTop: 2 }}>{e.legal_address}</div>}
          </div>
        ))}

        {form && (
          <div className="frm" style={{ marginTop: 4 }}>
            {FIELDS.map(([k, label, full]) => (
              <div className={`fld${full ? ' full' : ''}`} key={k}>
                <span className="lab">{label}</span>
                <input value={form[k] as string} onChange={ev => setForm(f => f ? { ...f, [k]: ev.target.value } : f)} placeholder={label} />
              </div>
            ))}
            {err && <div className="fld full" style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
            <div className="fld full" style={{ flexDirection: 'row', gap: 8 }}>
              <button className="primary" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : form.id ? 'Сохранить' : 'Добавить юрлицо'}</button>
              <button className="ghost" onClick={() => { setForm(null); setErr(null) }}>Отмена</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
