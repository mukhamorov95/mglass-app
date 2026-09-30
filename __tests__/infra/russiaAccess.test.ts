import { describe, it, expect, afterEach, vi } from 'vitest'
import { viaSupabaseProxy } from '@/lib/supabaseProxy'
import { swUrl } from '@/lib/swUrl'
import { appUrl, internalAppUrl } from '@/lib/appUrl'
import { execSync } from 'node:child_process'

const SB = 'https://qbypyrzkguwlelyjehbj.supabase.co'

describe('viaSupabaseProxy — ссылки хранилища через /supabase', () => {
  it('подписанная ссылка на чертёж уходит на прокси вместе с токеном', () => {
    const signed = `${SB}/storage/v1/object/sign/b2b-attachments/5402/drawing.pdf?token=abc`
    expect(viaSupabaseProxy(signed, SB)).toBe('/supabase/storage/v1/object/sign/b2b-attachments/5402/drawing.pdf?token=abc')
  })

  it('чужие адреса и другой проект Supabase не трогает', () => {
    expect(viaSupabaseProxy('https://fohycmghypcfjkuznnmu.supabase.co/storage/v1/x', SB)).toBe('https://fohycmghypcfjkuznnmu.supabase.co/storage/v1/x')
    expect(viaSupabaseProxy('https://example.com/a.png', SB)).toBe('https://example.com/a.png')
  })

  it('похожий хост с тем же началом — не наш', () => {
    expect(viaSupabaseProxy(`${SB}.evil.com/storage/v1/x`, SB)).toBe(`${SB}.evil.com/storage/v1/x`)
  })

  it('без адреса Supabase ничего не меняет', () => {
    expect(viaSupabaseProxy(`${SB}/storage/v1/x`, '')).toBe(`${SB}/storage/v1/x`)
  })
})

describe('swUrl — один адрес service worker на всё приложение', () => {
  it('передаёт хост проекта параметром', () => {
    expect(swUrl(SB)).toBe('/sw.js?sb=qbypyrzkguwlelyjehbj.supabase.co')
  })
  it('без адреса — просто /sw.js', () => {
    expect(swUrl('')).toBe('/sw.js')
  })
})

describe('appUrl / internalAppUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('для людей — публичный адрес, без двойного слэша', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.mglass.pro/')
    expect(appUrl('/crm/7')).toBe('https://app.mglass.pro/crm/7')
  })

  it('старый адрес vercel.app в настройке или пусто — ссылка для людей всё равно на российский вход', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mglass-app.vercel.app')
    expect(appUrl('/set-password?token=x')).toBe('https://app.mglass.pro/set-password?token=x')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(appUrl()).toBe('https://app.mglass.pro')
  })

  it('свой адрес в настройке главнее (превью, другой домен)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    expect(appUrl('/x')).toBe('http://localhost:3000/x')
  })

  it('ссылки для людей строятся только через appUrl — не из настройки напрямую', () => {
    const offenders = execSync(
      "git grep -n 'process.env.NEXT_PUBLIC_APP_URL' -- app lib components || true",
      { encoding: 'utf8' },
    ).split('\n').filter(l => l && !l.startsWith('lib/appUrl.ts'))
    expect(offenders, 'используйте appUrl() из lib/appUrl.ts').toEqual([])
  })

  it('самовызовы после переезда остаются на прямом адресе Vercel', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.mglass.pro')
    vi.stubEnv('INTERNAL_APP_URL', 'https://mglass-app.vercel.app')
    expect(internalAppUrl()).toBe('https://mglass-app.vercel.app')
  })

  it('до переезда самовызовы идут туда же, куда и раньше', () => {
    vi.stubEnv('INTERNAL_APP_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mglass-app.vercel.app')
    expect(internalAppUrl()).toBe('https://mglass-app.vercel.app')
  })
})
