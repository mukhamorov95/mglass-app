-- Отчёт прогона доступов — это список дыр. Политика «Owner reads security audit»
-- была написана через (not is_partner()) и пускала весь штат: проверено от имени
-- менеджера 22.09 — 2 строки из 2. Читать отчёт должен только владелец.
drop policy if exists "Owner reads security audit" on security_audit_runs;
create policy "Owner reads security audit" on security_audit_runs
  for select to authenticated using (is_owner());
revoke all on security_audit_runs from anon;
