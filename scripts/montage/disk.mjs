import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Яндекс.Диск через REST API. Токен лежит в каталоге с правами 700 и в код не попадает:
// ни в аргументы, ни в лог, ни в сообщение об ошибке.
const API = 'https://cloud-api.yandex.net/v1/disk'
const TOKEN_FILE = path.join(os.homedir(), '.mglass-secrets', 'yandex-disk.token')

export function readToken() {
  const fromEnv = process.env.YANDEX_DISK_TOKEN
  if (fromEnv) return fromEnv.trim()
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`нет токена: ожидается ${TOKEN_FILE} или переменная YANDEX_DISK_TOKEN`)
  }
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  if (!t) throw new Error(`файл ${TOKEN_FILE} пуст`)
  // В файл легко попадает не токен, а команда из буфера обмена. Без этой проверки
  // ошибка выглядит как «Cannot convert argument to a ByteString» и ни о чём не говорит.
  if (!/^y0_[A-Za-z0-9_-]+$/.test(t)) {
    throw new Error(
      `в ${TOKEN_FILE} лежит не токен (${t.length} символов, начинается с «${t.slice(0, 6)}»). ` +
      'Токен Яндекса начинается с «y0_» и состоит только из латиницы, цифр, дефиса и подчёркивания. ' +
      'Скопируйте именно токен со страницы Полигона и повторите запись.',
    )
  }
  return t
}

// Диск отвечает 429 при частых запросах и 5xx под нагрузкой — оба случая лечатся ожиданием,
// а не падением на середине архива.
async function call(url, { token, method = 'GET', body, headers = {}, raw = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `OAuth ${token}`, ...headers },
      body,
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    if (raw) return res
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* Диск иногда отвечает пустым телом */ }
    return { status: res.status, json }
  }
  throw new Error('Яндекс.Диск не отвечает после пяти попыток')
}

export async function diskInfo(token) {
  const { status, json } = await call(`${API}/`, { token })
  if (status === 401) throw new Error('токен не принят Диском (401) — выпустите новый на yandex.ru/dev/disk/poligon')
  if (status !== 200) throw new Error(`Диск ответил ${status}${json?.message ? `: ${json.message}` : ''}`)
  return json
}

const enc = p => encodeURIComponent(p)
const seen = new Set()

// Диск создаёт по одному уровню за запрос: «disk:/A/B» без существующей A даёт 409.
export async function ensureFolder(token, remotePath) {
  const parts = remotePath.replace(/^disk:\/?/, '').split('/').filter(Boolean)
  let acc = 'disk:'
  for (const part of parts) {
    acc += '/' + part
    if (seen.has(acc)) continue
    const { status, json } = await call(`${API}/resources?path=${enc(acc)}`, { token, method: 'PUT' })
    // 409 — папка уже есть, это нормальный ход событий, а не ошибка
    if (status !== 201 && status !== 409) {
      throw new Error(`не создалась папка ${acc}: ${status}${json?.message ? ` ${json.message}` : ''}`)
    }
    seen.add(acc)
  }
}

export async function uploadFile(token, localPath, remotePath) {
  await ensureFolder(token, path.posix.dirname(remotePath))

  const { status, json } = await call(
    `${API}/resources/upload?path=${enc(remotePath)}&overwrite=true`, { token },
  )
  if (status !== 200 || !json?.href) {
    throw new Error(`не выдана ссылка на загрузку ${remotePath}: ${status}${json?.message ? ` ${json.message}` : ''}`)
  }

  const body = fs.readFileSync(localPath)
  const put = await call(json.href, {
    token, method: 'PUT', body, raw: true,
    headers: { 'Content-Length': String(body.length) },
  })
  if (put.status !== 201 && put.status !== 202) {
    throw new Error(`не загрузился ${remotePath}: ${put.status}`)
  }
}

export function humanSize(bytes) {
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let i = 0, n = Number(bytes)
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
