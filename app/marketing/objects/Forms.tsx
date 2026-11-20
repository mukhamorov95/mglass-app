'use client'

import { useActionState, useState } from 'react'
import { PLATFORMS } from '@/lib/marketing/publications'
import { createObject, createPublication, markPublished, type ActionState } from './actions'

const input = 'w-full rounded-lg border border-[#e4e4e0] bg-white px-3 py-2 text-sm'
const btn = 'rounded-lg bg-[#111110] px-3 py-2 text-sm text-white disabled:opacity-50'

function Result({ state }: { state: ActionState }) {
  if (!state) return null
  return <p className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>{state.message}</p>
}

export function NewObjectForm() {
  const [state, action, pending] = useActionState(createObject, null)
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="title" placeholder="Название: ЖК «Событие»" className={input} required />
      <input name="slug" placeholder="Метка латиницей: zhk-sobytie" className={input} required />
      <input name="product" placeholder="Что сделали: зеркала с подсветкой" className={input} />
      <input name="district" placeholder="Район (без адреса)" className={input} />
      <input name="page_url" placeholder="Страница объекта на сайте: https://…" className={`${input} sm:col-span-2`} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={btn}>{pending ? 'Сохраняю…' : 'Добавить объект'}</button>
        <Result state={state} />
      </div>
    </form>
  )
}

export function NewPublicationForm({ objectId, pageUrl }: { objectId: string; pageUrl: string | null }) {
  const [state, action, pending] = useActionState(createPublication, null)
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
      <input type="hidden" name="object_id" value={objectId} />
      <select name="platform" className={input} defaultValue="telegram">
        {PLATFORMS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
      <input name="target_url" defaultValue={pageUrl ?? ''} placeholder="Куда ведёт: страница сайта https://…" className={input} />
      <input name="url" placeholder="Ссылка на пост, если уже вышел" className={input} />
      <button disabled={pending} className={btn}>{pending ? '…' : 'Добавить'}</button>
      <div className="sm:col-span-4"><Result state={state} /></div>
    </form>
  )
}

export function MarkPublishedForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markPublished, null)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="url" placeholder="Ссылка на вышедший пост" className={`${input} max-w-xs`} />
      <button disabled={pending} className="rounded-lg border border-[#e4e4e0] px-2 py-1.5 text-xs">Вышло</button>
      <Result state={state} />
    </form>
  )
}

export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <code className="break-all text-xs text-[#111110]/80">{url}</code>
      <button
        type="button"
        className="shrink-0 rounded border border-[#e4e4e0] px-2 py-0.5 text-xs"
        onClick={() => navigator.clipboard.writeText(url).then(() => setDone('ok'), () => setDone('fail'))}
      >
        {done === 'ok' ? 'Скопировано' : done === 'fail' ? 'Не скопировалось — выделите вручную' : 'Копировать'}
      </button>
    </span>
  )
}
