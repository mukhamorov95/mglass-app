import { describe, it, expect } from 'vitest'
import { parseStatement, dedupe, toIsoDate, toAmount } from '@/lib/bank/parseStatement'

const ONEC = `1CClientBankExchange
ВерсияФормата=1.02
Отправитель=Банк
СекцияРасчСчет
РасчСчет=40802810300000012345
КонецРасчСчет
СекцияДокумент=Платежное поручение
Номер=115
Дата=14.08.2026
Сумма=53245.50
ПлательщикСчет=40702810900000098765
Плательщик1=ООО "Вандер"
ПлательщикИНН=7701234567
ПолучательСчет=40802810300000012345
Получатель1=ИП Мухаморов
ДатаПоступило=14.08.2026
НазначениеПлатежа=Оплата по счету 431 за стекло
КонецДокумента
СекцияДокумент=Платежное поручение
Номер=116
Дата=15.08.2026
Сумма=12000
ПлательщикСчет=40802810300000012345
Плательщик1=ИП Мухаморов
ПолучательСчет=40702810900000011111
Получатель1=ООО "Ветро"
ПолучательИНН=7809876543
ДатаСписано=15.08.2026
НазначениеПлатежа=Фурнитура
КонецДокумента`

describe('выписка 1С', () => {
  const res = parseStatement(ONEC)

  it('узнаёт формат и находит оба документа', () => {
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.format).toBe('1c')
    expect(res.rows).toHaveLength(2)
    expect(res.accounts).toEqual(['40802810300000012345'])
  })

  it('направление берёт по нашему счёту, а не по знаку суммы', () => {
    if (!res.ok) return
    const [income, expense] = res.rows
    expect(income.direction).toBe('in')
    expect(income.amount).toBe(53245.5)
    expect(income.counterparty).toBe('ООО "Вандер"')
    expect(income.inn).toBe('7701234567')
    expect(expense.direction).toBe('out')
    expect(expense.counterparty).toBe('ООО "Ветро"')
  })

  it('даёт стабильный ключ для повторной загрузки', () => {
    const again = parseStatement(ONEC)
    if (!res.ok || !again.ok) return
    expect(again.rows.map(r => r.externalKey)).toEqual(res.rows.map(r => r.externalKey))
  })

  it('два платежа одного дня на одну сумму различаются номером документа', () => {
    const third = `
СекцияДокумент=Платежное поручение
Номер=117
Дата=15.08.2026
Сумма=12000
ПлательщикСчет=40802810300000012345
Плательщик1=ИП Мухаморов
ПолучательСчет=40702810900000011111
Получатель1=ООО "Ветро"
ДатаСписано=15.08.2026
КонецДокумента`
    const r = parseStatement(ONEC + third)
    if (!r.ok) return
    expect(r.rows).toHaveLength(3)
    expect(dedupe(r.rows)).toHaveLength(3)
    // а вот полный дубль строки схлопнётся
    expect(dedupe([...r.rows, r.rows[0]])).toHaveLength(3)
  })
})

describe('выписка CSV', () => {
  const CSV = `Дата операции;Номер документа;Контрагент;ИНН;Приход;Расход;Назначение платежа
14.08.2026;115;ООО "Вандер";7701234567;53 245,50;;Оплата по счету 431
15.08.2026;116;ООО "Ветро";7809876543;;12 000,00;Фурнитура`

  it('находит колонки по заголовку и делит приход/расход', () => {
    const r = parseStatement(CSV)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.format).toBe('csv')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ direction: 'in', amount: 53245.5, counterparty: 'ООО "Вандер"' })
    expect(r.rows[1]).toMatchObject({ direction: 'out', amount: 12000 })
  })

  it('одна колонка суммы со знаком тоже читается', () => {
    const r = parseStatement('Дата;Сумма;Контрагент\n14.08.2026;-5000;Аренда')
    if (!r.ok) return
    expect(r.rows[0]).toMatchObject({ direction: 'out', amount: 5000 })
  })

  it('файл не выписка — говорит об этом, а не молчит', () => {
    const r = parseStatement('привет\nкак дела')
    expect(r.ok).toBe(false)
  })
})

describe('остатки и пустой день (формат Альфа/Т-Банк)', () => {
  const WITH_BALANCE = `1CClientBankExchange
ВерсияФормата=1.03
Кодировка=Windows
Отправитель=Т-Банк
РасчСчет=40702810210001853042
СекцияРасчСчет
ДатаНачала=25.08.2026
ДатаКонца=25.08.2026
РасчСчет=40702810210001853042
НачальныйОстаток=248
ВсегоПоступило=8000
ВсегоСписано=7179
КонечныйОстаток=1069
КонецРасчСчет
СекцияДокумент=Платежное поручение
Номер=1294
Дата=25.08.2026
Сумма=8000
ПлательщикСчет=40702810999999999999
Плательщик=ООО "Клиент"
ПлательщикИНН=7700000001
ПолучательСчет=40702810210001853042
ДатаПоступило=25.08.2026
НазначениеПлатежа=Оплата по счету 5
КонецДокумента
КонецФайла`

  it('извлекает остатки по счёту из СекцияРасчСчет', () => {
    const r = parseStatement(WITH_BALANCE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.balances).toHaveLength(1)
    expect(r.balances[0]).toMatchObject({
      account: '40702810210001853042', opening: 248, credit: 8000, debit: 7179, closing: 1069,
    })
  })

  it('сумма прихода сходится с ВсегоПоступило банка', () => {
    const r = parseStatement(WITH_BALANCE)
    if (!r.ok) return
    const inSum = r.rows.filter(x => x.direction === 'in').reduce((s, x) => s + x.amount, 0)
    expect(inSum).toBe(r.balances[0].credit)
  })

  const EMPTY = `1CClientBankExchange
ВерсияФормата=1.03
Отправитель=Т-Банк
РасчСчет=40802810300001303700
СекцияРасчСчет
РасчСчет=40802810300001303700
НачальныйОстаток=0
ВсегоПоступило=0
ВсегоСписано=0
КонечныйОстаток=0
КонецРасчСчет
КонецФайла`

  it('пустой день — не ошибка, а выписка с остатками без движений', () => {
    const r = parseStatement(EMPTY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rows).toHaveLength(0)
    expect(r.balances[0].account).toBe('40802810300001303700')
  })
})

describe('мелочи разбора', () => {
  it('даты в трёх видах', () => {
    expect(toIsoDate('14.08.2026')).toBe('2026-08-14')
    expect(toIsoDate('2026-08-14')).toBe('2026-08-14')
    expect(toIsoDate('4.8.26')).toBe('2026-08-04')
    expect(toIsoDate('чепуха')).toBeNull()
  })

  it('суммы с пробелами, запятой и валютой', () => {
    expect(toAmount('53 245,50')).toBe(53245.5)
    expect(toAmount('12 000.00 ₽')).toBe(12000)
  })
})
