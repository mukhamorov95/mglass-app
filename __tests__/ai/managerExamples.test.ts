import { describe, it, expect } from 'vitest'
import {
  rankExamples, clientContextFromHistory, exampleHash, isUsefulReply,
  type ManagerExample,
} from '@/lib/avito/managerExamples'

const ex = (client_context: string, manager_reply: string, won = false): ManagerExample =>
  ({ client_context, manager_reply, won })

describe('rankExamples', () => {
  it('ранжирует по пересечению слов с сообщением клиента', () => {
    const list = [
      ex('нужна раздвижная душевая перегородка в нишу', 'Пришлите размеры ниши — посчитаю'),
      ex('делаете зеркало с подсветкой в ванную', 'Да, делаем зеркала с LED-подсветкой'),
    ]
    const top = rankExamples(list, 'здравствуйте, интересует душевая перегородка в нишу', 3)
    expect(top).toHaveLength(1)
    expect(top[0].manager_reply).toContain('размеры ниши')
  })

  it('won даёт бонус при равном пересечении', () => {
    const list = [
      ex('сколько стоит зеркало', 'обычный ответ про зеркало'),
      ex('сколько стоит зеркало', 'ответ по зеркалу от закрытой сделки', true),
    ]
    const top = rankExamples(list, 'сколько стоит зеркало', 1)
    expect(top[0].won).toBe(true)
  })

  it('отсекает примеры без пересечения слов', () => {
    const list = [ex('автостекло на камри', 'мы этим не занимаемся')]
    expect(rankExamples(list, 'душевая перегородка из стекла', 3)).toHaveLength(0)
  })

  it('пустой ввод/список → пусто', () => {
    expect(rankExamples([], 'что угодно')).toHaveLength(0)
    expect(rankExamples([ex('размеры', 'ответ')], '')).toHaveLength(0)
  })

  it('соблюдает лимит', () => {
    const list = Array.from({ length: 10 }, (_, i) => ex(`душевая перегородка вариант ${i}`, `ответ ${i}`))
    expect(rankExamples(list, 'душевая перегородка', 3)).toHaveLength(3)
  })
})

describe('clientContextFromHistory', () => {
  it('берёт последнюю пачку реплик клиента', () => {
    const h = ['КЛИЕНТ: привет', 'БОТ: здравствуйте', 'КЛИЕНТ: нужна душевая', 'КЛИЕНТ: 90 на 190']
    expect(clientContextFromHistory(h)).toBe('нужна душевая 90 на 190')
  })
  it('пропускает ответ бота в хвосте и берёт клиента до него', () => {
    const h = ['КЛИЕНТ: сколько стоит зеркало', 'БОТ: примерно 5000']
    expect(clientContextFromHistory(h)).toBe('сколько стоит зеркало')
  })
  it('нет реплик клиента → пусто', () => {
    expect(clientContextFromHistory(['БОТ: привет', 'МЕНЕДЖЕР: здравствуйте'])).toBe('')
  })
})

describe('exampleHash / isUsefulReply', () => {
  it('хеш детерминирован и зависит от контента', () => {
    expect(exampleHash('a', 'b')).toBe(exampleHash('a', 'b'))
    expect(exampleHash('a', 'b')).not.toBe(exampleHash('a', 'c'))
  })
  it('отсекает дежурные/короткие ответы', () => {
    expect(isUsefulReply('ок')).toBe(false)
    expect(isUsefulReply('спасибо.')).toBe(false)
    expect(isUsefulReply('Пришлите размеры проёма — посчитаю сегодня')).toBe(true)
  })
})
