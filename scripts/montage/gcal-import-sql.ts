// Выгрузка Google Календаря офиса (ответ events.list, JSON) → SQL переноса в installations.
//   npx tsx scripts/montage/gcal-import-sql.ts <events.json> [YYYY-MM-DD сегодня по МСК] > import.sql
// В выгрузке телефоны и адреса клиентов: файл и SQL держать вне репозитория.
// Повтор безопасен: ключ — gcal:<id события>. Повтор обновляет поля из календаря, а статус,
// бригаду и отметку закрытия, поставленные в приложении, не трогает. Прошедший выезд
// приходит «закрыт» — в календаре статусов нет, дата прошла (docs/installations/MONTAGE_ROUTE.md).
import { readFileSync } from 'node:fs'
import { parseCalendarCard, type GcalEventLike } from '../../lib/installations/gcalCard'

const [file, todayArg] = process.argv.slice(2)
if (!file) { console.error('usage: gcal-import-sql.ts <events.json> [today]'); process.exit(2) }
const today = todayArg ?? new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)

const data = JSON.parse(readFileSync(file, 'utf8')) as { events?: GcalEventLike[]; nextPageToken?: string }
if (data.nextPageToken) { console.error('в выгрузке не все события (nextPageToken) — выгрузите остальное'); process.exit(1) }
const events = data.events ?? []

const q = (v: string | null) => v == null ? 'null' : `'${v.replace(/'/g, "''")}'`
const arr = (a: string[]) => a.length ? `array[${a.map(q).join(',')}]::text[]` : `'{}'::text[]`
const num = (n: number | null) => n == null ? 'null' : String(n)

const rows: string[] = []
const skipped: string[] = []
for (const ev of events) {
  const c = parseCalendarCard(ev)
  if (!c) { skipped.push(`${(ev.start?.dateTime ?? ev.start?.date ?? '').slice(0, 10)} ${ev.summary ?? ''}`); continue }
  const status = c.scheduled_date < today ? 'done' : 'planned'
  rows.push(`(${[q(c.external_key), q('gcal'), q(c.order_no), arr(c.order_nos), q(c.title), q(c.kind), q(c.client_name), q(c.phone),
    q(c.address), q(c.entry_note), q(c.scheduled_date) + '::date', q(c.time_from), q(c.time_to), q(c.contact_before), arr(c.crew_members),
    num(c.amount), q(c.amount_note), q(c.comment), q(status), q(c.source_updated_at) + '::timestamptz', q('Google Календарь')].join(', ')})`)
}

console.log(`insert into public.installations (external_key, source, order_no, order_nos, title, kind, client_name, phone,
  address, entry_note, scheduled_date, time_from, time_to, contact_before, crew_members,
  amount, amount_note, comment, status, source_updated_at, created_by)
values
${rows.join(',\n')}
on conflict (external_key) do update set
  order_no = excluded.order_no, order_nos = excluded.order_nos, title = excluded.title, kind = excluded.kind,
  client_name = excluded.client_name, phone = excluded.phone, address = excluded.address, entry_note = excluded.entry_note,
  scheduled_date = excluded.scheduled_date, time_from = excluded.time_from, time_to = excluded.time_to,
  contact_before = excluded.contact_before, crew_members = excluded.crew_members, amount = excluded.amount,
  amount_note = excluded.amount_note, comment = excluded.comment, source_updated_at = excluded.source_updated_at
where installations.source_updated_at is distinct from excluded.source_updated_at;

-- Бригада из справочника — только при точном совпадении состава («Женя, Арген» = Арген + Женя)
update public.installations i set crew_id = c.id
from public.installation_crews c
where i.source = 'gcal' and i.crew_id is null and cardinality(i.crew_members) > 0
  and (select array_agg(lower(btrim(x)) order by lower(btrim(x))) from unnest(string_to_array(c.name, ',')) x)
    = (select array_agg(lower(m) order by lower(m)) from unnest(i.crew_members) m);`)
console.error(`карточек: ${rows.length}, не карточки: ${skipped.length}${skipped.length ? '\n  ' + skipped.join('\n  ') : ''}`)
