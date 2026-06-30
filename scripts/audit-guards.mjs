#!/usr/bin/env node
// Страж покрытия авторизации: находит мутационные API-роуты без проверки прав.
// Чистая детекция, ничего не меняет. Запуск: node scripts/audit-guards.mjs
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { execSync } from 'node:child_process'

const files = execSync('find app/api -name route.ts', { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)

const MUT = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=/
const GUARD = /(requireOwner|requireAdmin|requireRole|requireAuth|isOwnerRole|isOwnerCurrentUser|getRole\s*\(|ALLOWED_WRITE|CRON_SECRET|TELEGRAM_WEBHOOK_SECRET|x-telegram-bot-api-secret-token|WAZZUP_WEBHOOK_SECRET|verifySignature)/
const SERVICE = /createServiceClient/
const AMO_WRITE = /(addAmoNote|createAmoTask|assignLeadToManager|method:\s*['"]POST['"][^]*amocrm|amocrm[^]*method:\s*['"]PATCH['"])/

const webhookOrCron = (f) => /\/(cron|wazzup|telegram|amo)\//.test(f)

const offenders = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (!MUT.test(src)) continue
  const hasGuard = GUARD.test(src)
  const usesService = SERVICE.test(src)
  const amoWrite = AMO_WRITE.test(src)
  if (!hasGuard || amoWrite) {
    offenders.push({
      file: f.replace(/^app\/api\//, ''),
      guard: hasGuard,
      service: usesService,
      amoWrite,
      kind: webhookOrCron(f) ? 'webhook/cron' : 'app',
    })
  }
}

const fmt = (o) => [
  o.guard ? '   ' : 'NO ',
  o.service ? 'SVC' : '   ',
  o.amoWrite ? 'AMO-WRITE' : '         ',
  o.file,
].join(' ')

const noGuard = offenders.filter((o) => !o.guard)
const amo = offenders.filter((o) => o.amoWrite)

console.log(`\nМутационных роутов всего: ${files.filter((f) => MUT.test(readFileSync(f, 'utf8'))).length}`)
console.log(`Без guard: ${noGuard.length}  |  С AmoCRM-записью: ${amo.length}\n`)
console.log('  ┌ guard  ┌ service-role  ┌ amo-write')
for (const o of offenders.sort((a, b) => (a.service === b.service ? 0 : a.service ? -1 : 1))) {
  console.log('  ' + fmt(o))
}
console.log('\nЛегенда: "NO " = нет проверки прав; SVC = service-role (обход RLS); AMO-WRITE = пишет в CRM.')

// Код выхода 0 — это отчёт, не блокирующий тест (пока).
