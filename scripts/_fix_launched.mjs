import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
// исторические импорты 2024/2025 без launched_at → проставить launched_at = дата создания
let fixed=0
for (const src of ['sheet_import_2024','sheet_import_2025']) {
  for(;;){
    const { data } = await sb.from('b2b_orders').select('id,created_at').ilike('notes',`%"source":"${src}"%`).is('launched_at',null).limit(500)
    if(!data?.length) break
    for (const r of data) {
      const d = r.created_at.slice(0,10)  // YYYY-MM-DD
      await sb.from('b2b_orders').update({ launched_at: d }).eq('id', r.id)
      fixed++
    }
    if(data.length<500) break
  }
}
console.log('Проставлено launched_at:', fixed)
// проверка
const { count } = await sb.from('b2b_orders').select('*',{count:'exact',head:true}).not('notes','ilike','%"status":"quote"%').is('archived_at',null).is('launched_at',null)
console.log('Осталось без launched_at:', count)
