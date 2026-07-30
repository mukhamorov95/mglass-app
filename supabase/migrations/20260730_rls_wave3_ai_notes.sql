-- RLS-3: закрыть от публичного анон-ключа таблицы с выключенным RLS —
-- AI-диалоги и заметки менеджеров. Серверные писатели идут сервис-ключом
-- (обходят RLS), клиентские экраны под входом. Применено через MCP.
do $$ declare t text; begin
  foreach t in array array['ai_conversations','ai_managed_chats','manager_notes','task_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_authed', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t||'_authed', t);
  end loop;
end $$;
