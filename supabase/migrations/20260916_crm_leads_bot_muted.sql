-- Жёсткий стоп бота по карточке (решение владельца 16.09.2026):
-- как только с карточкой начал работать менеджер — Иван замолкает.
--
-- Раньше это выводилось из crm_leads.manager, но поле перегружено (права доступа,
-- отчётность) и меняется прямо из браузера, мимо любого серверного кода. Поэтому
-- флаг явный, а взводится триггером на самой таблице — при любом пути записи.

alter table public.crm_leads
  add column if not exists bot_muted    boolean not null default false,
  add column if not exists bot_muted_at timestamptz,
  add column if not exists bot_muted_by text;

comment on column public.crm_leads.bot_muted is
  'true — Иван не пишет клиенту в этом чате. Взводится при назначении менеджера и при его ответе клиенту.';

create or replace function public.crm_leads_bot_mute()
returns trigger
language plpgsql
as $$
declare
  ai_names text[] := array['Иван (AI)', 'AI-менеджер'];
begin
  -- Менеджер (любой, кроме AI) стал ответственным — бот молчит.
  if new.manager is not null and not (new.manager = any(ai_names)) then
    if coalesce(new.bot_muted, false) = false then
      new.bot_muted := true;
      new.bot_muted_at := now();
      new.bot_muted_by := new.manager;
    end if;
  -- Ответственного вернули боту — это и есть «включить Ивана обратно».
  elsif new.manager = any(ai_names) and (tg_op = 'INSERT' or new.manager is distinct from old.manager) then
    new.bot_muted := false;
    new.bot_muted_at := null;
    new.bot_muted_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_bot_mute_trg on public.crm_leads;
create trigger crm_leads_bot_mute_trg
  before insert or update of manager on public.crm_leads
  for each row execute function public.crm_leads_bot_mute();

-- Текущее состояние: у кого ответственный — человек, бот уже не должен писать.
update public.crm_leads
   set bot_muted = true, bot_muted_at = coalesce(bot_muted_at, now()), bot_muted_by = coalesce(bot_muted_by, manager)
 where manager is not null
   and manager not in ('Иван (AI)', 'AI-менеджер')
   and bot_muted = false;
