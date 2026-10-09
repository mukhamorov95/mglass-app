import { describe, it, expect } from 'vitest'
import { pickAv24Href } from '@/lib/supplier/enrichParse'

// Ссылки — как на странице поиска av24.su/search/FDP-10/ (09.10), плюс соседняя модель FDP-102.
const page = (hrefs: string[]) => hrefs.map(h => `<a href="${h}">x</a>`).join('\n')
const SEARCH = page([
  '/search/FDP-10/',
  '/fdp-10-def-sus304-tp-petlya-alfa-s-defektom-stena-steklo-s-bok-krepleniem-nerzhaveyka-zoloto/',
  '/petlya-fdp-102-sus304pss/',
  '/petlya-alfa-fdp-10-sus304bl/',
  '/petlya-alfa-fdp-10-sus304sss/',
  '/petlya-alfa-fdp-10-znbl/',
  '/petlya-alfa-fdp-10-zncr/',
  '/petlya-alfa-stena-steklo-s-bok-krepleniem-fdp-10-sus304-gg/',
])

describe('pickAv24Href — карточка из поиска АВ24', () => {
  it('тот же цвет и материал', () => {
    expect(pickAv24Href(SEARCH, 'FDP-10 SUS304/SSS')).toBe('/petlya-alfa-fdp-10-sus304sss/')
    expect(pickAv24Href(SEARCH, 'FDP-10 ZN/CR')).toBe('/petlya-alfa-fdp-10-zncr/')
    expect(pickAv24Href(SEARCH, 'FDP-10 SUS304/GG')).toBe('/petlya-alfa-stena-steklo-s-bok-krepleniem-fdp-10-sus304-gg/')
  })

  it('нет карточки своего цвета — та же модель того же материала, а не FDP-102 и не страница поиска', () => {
    expect(pickAv24Href(SEARCH, 'FDP-10 SUS304/PSS')).toBe('/petlya-alfa-fdp-10-sus304bl/')
  })

  it('только страница поиска и брак — карточки нет', () => {
    expect(pickAv24Href(page(['/search/FDP-10/', '/fdp-10-def-sus304-tp-petlya/']), 'FDP-10 SUS304/TP')).toBe('')
  })

  it('точку в коде слаг теряет или меняет на дефис; материал бывает вплотную к коду', () => {
    expect(pickAv24Href(page(['/uplotnitel-fdpp-40481-pvccl/', '/uplotnitel-fdpp-4048-pvccl/']), 'FDPP-404.8 PVC/CL')).toBe('/uplotnitel-fdpp-4048-pvccl/')
    expect(pickAv24Href(page(['/fdpa-57-3-al-tp-uglovoy-opornyy-profil/']), 'FDPA-57.3 AL/TP')).toBe('/fdpa-57-3-al-tp-uglovoy-opornyy-profil/')
    expect(pickAv24Href(page(['/petlya-afina-fdp-1301brtp/']), 'FDP-130.1 BR/TP')).toBe('/petlya-afina-fdp-1301brtp/')
    expect(pickAv24Href(page(['/ruchka-skoba-fdr-92-sus304btp/', '/ruchka-skoba-fdr-92-e-sus304btp/']), 'FDR-92E SUS304/BTP')).toBe('/ruchka-skoba-fdr-92-e-sus304btp/')
    expect(pickAv24Href(page(['/profil-fdpa-51-22-alpss/', '/profil-dlya-stekla-fdpa-51-3-alpss/']), 'FDPA-51.3 AL/PSS')).toBe('/profil-dlya-stekla-fdpa-51-3-alpss/')
  })
})
