import { describe, it, expect } from 'vitest'
import { packagedNotice, reworkNotice, escapeHtml, orderLink } from '@/lib/production/managerNotices'

describe('сообщения менеджеру о событиях цеха', () => {
  it('упакован — номер заказа и просьба согласовать отгрузку', () => {
    const t = packagedNotice({ id: 5321, custom_number: '05321', client_name: 'ООО «Стекло»' })
    expect(t).toContain('Заказ <b>05321</b> упакован — согласуйте отгрузку с клиентом')
    expect(t).toContain('ООО «Стекло»')
  })

  it('без номера — по id', () => {
    expect(packagedNotice({ id: 77, custom_number: '  ' })).toContain('<b>#77</b>')
  })

  it('переделка — этап, причина словами, комментарий и откуда заново', () => {
    const t = reworkNotice({ id: 1, custom_number: '00001' }, {
      foundAt: 'tempering', restartAt: 'cutting', reason: 'break', comment: 'скол <угла>', itemIndex: 2, by: 'Никита',
    })
    expect(t).toContain('Брак/переделка по заказу <b>00001</b>: Закалка, Бой / скол — скол &lt;угла&gt;')
    expect(t).toContain('Поз. 3 снова с этапа «Резка»')
    expect(t).toContain('Отметил: Никита')
  })

  it('рекламация после цеха — маршрут не менялся, «снова с этапа» не пишется', () => {
    const t = reworkNotice({ id: 9, custom_number: '00009' }, {
      foundAt: 'after_production', restartAt: 'after_production', reason: 'client_claim', comment: null, itemIndex: 0, by: 'Эльзат', reopened: 0,
    })
    expect(t).toContain('<b>00009</b>: после цеха, Рекламация клиента')
    expect(t).toContain('Поз. 1: маршрут в цеху не менялся — нужна ли переделка, решаете вы.')
    expect(t).not.toContain('снова с этапа')
  })

  it('HTML в тексте экранируется — Telegram иначе отвергает сообщение целиком', () => {
    expect(escapeHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c')
  })

  it('ссылка — на карточку сделки', () => {
    expect(orderLink(42)).toBe('/b2b-deal/42')
  })
})
