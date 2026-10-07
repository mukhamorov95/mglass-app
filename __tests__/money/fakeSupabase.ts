// Подделка service-клиента Supabase для денежных тестов: таблицы в памяти, фильтры
// PostgREST, которые использует lib/money, и ПОТОЛОК 1000 строк на запрос — как на проде.
// Не тест (vitest берёт только *.test.ts).

type R = Record<string, unknown>
export const MAX_ROWS = 1000

export type FakeDb = {
  tables: Record<string, R[]>
  failTable: string | null
  writes: { table: string; op: string; row: R }[]
}

export function makeDb(tables: Record<string, R[]> = {}): FakeDb {
  return { tables, failTable: null, writes: [] }
}

const eqv = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b))

export function fakeClient(db: FakeDb) {
  return {
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      const preds: ((r: R) => boolean)[] = []
      let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select'
      let payload: R | R[] | null = null
      let conflict: string | null = null
      let orderKey: string | null = null
      let asc = true
      let limitN = Infinity
      let wantRows = false

      const rows = () => db.tables[table] ?? (db.tables[table] = [])
      const nextId = () => rows().reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1

      const exec = async (from = 0, to = MAX_ROWS - 1): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
        if (db.failTable === table) return { data: null, error: { message: `${table}: timeout` } }
        if (op === 'insert' || op === 'upsert') {
          const list = Array.isArray(payload) ? payload : [payload as R]
          const out: R[] = []
          for (const p of list) {
            const hit = op === 'upsert' && conflict ? rows().find(r => conflict!.split(',').every(k => eqv(r[k], p[k]))) : null
            if (hit) { Object.assign(hit, p); out.push(hit); db.writes.push({ table, op: 'update', row: { ...hit } }) }
            else { const row = { id: nextId(), ...p }; rows().push(row); out.push(row); db.writes.push({ table, op: 'insert', row: { ...row } }) }
          }
          return { data: wantRows ? out : null, error: null }
        }
        let hit = rows().filter(r => preds.every(p => p(r)))
        if (op === 'update') {
          for (const r of hit) { Object.assign(r, payload); db.writes.push({ table, op: 'update', row: { ...r } }) }
          return { data: wantRows ? hit : null, error: null }
        }
        if (op === 'delete') {
          db.tables[table] = rows().filter(r => !hit.includes(r))
          return { data: null, error: null }
        }
        if (orderKey) {
          const k = orderKey
          hit = [...hit].sort((a, b) => {
            const x = a[k], y = b[k]
            const c = typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x ?? '').localeCompare(String(y ?? ''))
            return asc ? c : -c
          })
        }
        return { data: hit.slice(from, Math.min(to + 1, from + MAX_ROWS, limitN === Infinity ? Infinity : limitN)), error: null }
      }

      const b = {
        select: () => { wantRows = true; return b },
        insert: (p: R | R[]) => { op = 'insert'; payload = p; return b },
        upsert: (p: R | R[], o?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflict = o?.onConflict ?? 'id'; return b },
        update: (p: R) => { op = 'update'; payload = p; return b },
        delete: () => { op = 'delete'; return b },
        eq: (c: string, v: unknown) => { preds.push(r => eqv(r[c], v)); return b },
        neq: (c: string, v: unknown) => { preds.push(r => !eqv(r[c], v)); return b },
        in: (c: string, vs: unknown[]) => { const s = new Set(vs.map(String)); preds.push(r => s.has(String(r[c]))); return b },
        is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
        not: (c: string, o: string, v: unknown) => { if (o === 'is') preds.push(r => (r[c] ?? null) !== v); return b },
        gte: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) >= String(v)); return b },
        gt: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) > String(v)); return b },
        lte: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) <= String(v)); return b },
        lt: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) < String(v)); return b },
        contains: (c: string, vs: unknown[]) => { preds.push(r => Array.isArray(r[c]) && vs.every(v => (r[c] as unknown[]).map(String).includes(String(v)))); return b },
        overlaps: (c: string, vs: unknown[]) => { const s = new Set(vs.map(String)); preds.push(r => Array.isArray(r[c]) && (r[c] as unknown[]).some(x => s.has(String(x)))); return b },
        order: (c: string, o?: { ascending?: boolean }) => { orderKey = c; asc = o?.ascending !== false; return b },
        limit: (n: number) => { limitN = n; return b },
        range: (from: number, to: number) => exec(from, to),
        single: async () => {
          const r = await exec()
          if (r.error) return r
          const list = (Array.isArray(r.data) ? r.data : []) as R[]
          return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: `ожидалась 1 строка, получено ${list.length}` } }
        },
        maybeSingle: async () => {
          const r = await exec()
          if (r.error) return r
          const list = (Array.isArray(r.data) ? r.data : []) as R[]
          return { data: list[0] ?? null, error: null }
        },
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => exec().then(ok, fail),
      }
      return b
    },
  }
}
