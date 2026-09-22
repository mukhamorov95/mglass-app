import { describe, it, expect } from 'vitest'
import { safeFileName, fileExt, sourcePath, isOwnSourcePath } from '@/lib/kp/sourceFile'

const USER = '12d6d14d-c4dc-414e-93e8-da2ef4b9173c'
const OTHER = '9d244bfa-2319-494c-942f-d1f8ed00a37e'

describe('safeFileName', () => {
  it('имя показывается человеку — переносы и угловые скобки убираем', () => {
    expect(safeFileName('КП Ирина\n<b>190</b>.pdf')).toBe('КП Ирина b 190 /b .pdf')
  })
  it('пустое имя не оставляем пустым', () => {
    expect(safeFileName('')).toBe('файл')
    expect(safeFileName('   ')).toBe('файл')
  })
  it('длинное имя подрезаем', () => {
    expect(safeFileName('я'.repeat(300))).toHaveLength(120)
  })
})

describe('fileExt', () => {
  it('берёт расширение и чистит его', () => {
    expect(fileExt('КП №118.PDF')).toBe('pdf')
    expect(fileExt('фото.jpeg')).toBe('jpeg')
  })
  it('без расширения и с мусором — запасной вариант', () => {
    expect(fileExt('файл без точки')).toBe('pdf')
    expect(fileExt('архив.tar.gz.verylongext')).toBe('pdf')
    expect(fileExt('скан', 'jpg')).toBe('jpg')
  })
})

describe('sourcePath', () => {
  it('путь начинается с id загрузившего', () => {
    expect(sourcePath(USER, 'кп.pdf', 'abc-123')).toBe(`${USER}/abc-123.pdf`)
  })
  it('имя файла в путь не попадает — только расширение', () => {
    const p = sourcePath(USER, '../../секрет.pdf', 'tok')
    expect(p).toBe(`${USER}/tok.pdf`)
    expect(p).not.toContain('..')
  })
})

describe('isOwnSourcePath', () => {
  it('свой путь — да, чужой — нет', () => {
    expect(isOwnSourcePath(`${USER}/tok.pdf`, USER)).toBe(true)
    expect(isOwnSourcePath(`${OTHER}/tok.pdf`, USER)).toBe(false)
  })
  it('префикс id не считается совпадением', () => {
    expect(isOwnSourcePath(`${USER}-чужой/tok.pdf`, USER)).toBe(false)
    expect(isOwnSourcePath(`${USER}x/tok.pdf`, USER)).toBe(false)
  })
  it('выход вверх по бакету запрещён', () => {
    expect(isOwnSourcePath(`${USER}/../${OTHER}/tok.pdf`, USER)).toBe(false)
  })
  it('пустые значения — нет', () => {
    expect(isOwnSourcePath('', USER)).toBe(false)
    expect(isOwnSourcePath(`${USER}/`, USER)).toBe(false)
    expect(isOwnSourcePath(`${USER}/tok.pdf`, '')).toBe(false)
  })
})
