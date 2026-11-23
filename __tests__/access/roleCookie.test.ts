import { describe, expect, it } from 'vitest'
import { readSignedScoped, signScoped } from '@/lib/roleCookie'

const S = 'секрет-для-теста'
const U = '3114f511-6613-4e68-b944-9cca1c16dc13'

describe('подписанный кэш роли', () => {
  it('своя подписанная кука читается', async () => {
    expect(await readSignedScoped('user-role', await signScoped('user-role', U, 'partner', S), U, S)).toBe('partner')
    expect(await readSignedScoped('user-b2b-scope', await signScoped('user-b2b-scope', U, '', S), U, S)).toBe('')
  })
  it('вписанная руками роль — промах кэша', async () => {
    const real = await signScoped('user-role', U, 'partner', S)
    const sig = real.slice(real.lastIndexOf('|') + 1)
    expect(await readSignedScoped('user-role', `${U}|admin|${sig}`, U, S)).toBeUndefined()
    expect(await readSignedScoped('user-role', `${U}|admin`, U, S)).toBeUndefined()
  })
  it('кука другого имени, другого человека или без секрета не подходит', async () => {
    const v = await signScoped('user-mgr-ws', U, '1', S)
    expect(await readSignedScoped('user-role', v, U, S)).toBeUndefined()
    expect(await readSignedScoped('user-mgr-ws', v, 'другой', S)).toBeUndefined()
    expect(await readSignedScoped('user-mgr-ws', v, U, '')).toBeUndefined()
  })
})
