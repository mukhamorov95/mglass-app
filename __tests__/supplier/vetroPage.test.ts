import { describe, it, expect } from 'vitest'
import { pickVetroPage, vetroOfferId, vetroProductUrl } from '@/lib/supplier/enrichParse'

// Куски страницы vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/2087/ (09.10): шапка,
// блок цветов и конфиг JCCatalogElement с предложениями. Лишнее вырезано.
const URL = 'https://vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/2087/'
const HTML = `
<meta property="og:image" content="https://vetro-furniture.ru/upload/iblock/7e7/model.JPG" />
<div class="top_info-row material-catalog-element-row"> <div class="top_info-title">Материал:</div> <div class="top_info-value">Латунь (твердый сплав)</div> </div>
<div class="bx_catalog_item_scu wrapper_sku" id="bx_117848907_2087_skudiv">
  <span class="show_class bx_item_section_name">Цвет</span>
  <li data-treevalue="109_4" title="Цвет: Cp (хром полированный)"></li>
  <li data-treevalue="109_2" title="Цвет: Black (чёрный матовый)"></li>
  <li title=": Для душевой"></li><li title=": Для сауны"></li>
  <span class="bx_item_section_name">Угол установки</span><li title="Угол установки: 180°"></li>
  <span class="bx_item_section_name">Открывание</span><li title="Открывание: В обе стороны"></li>
  <li title="Регулировка 0 положения: Регулировка 0 положения"></li>
</div>
<span itemprop="offers"><li title="Угол установки: 90°"></li></span>
<script>new JCCatalogElement({'OFFERS':[
{'ID':'2090','NAME':'Dessau-103/CP. Петля стекло-стекло 180°','COLOR_VALUE':'Cp (хром полированный)','PRICE':{'ID':'6567'},'PREVIEW_PICTURE':{'ID':'3543463','SRC':'/upload/iblock/4f2/cp-480.JPG','ALT':'Dessau-103/CP.'},'DETAIL_PICTURE':{'ID':'3532600','SRC':'/upload/resize_cache/iblock/feb/1200_1200_1/cp.JPG','BIG':{'src':'/upload/iblock/feb/cp.JPG'}},'SLIDER':[{'ID':'3532600','SRC':'/upload/resize_cache/iblock/feb/1200_1200_1/cp.JPG'}]},
{'ID':'4146','NAME':'Dessau-103/Black. Петля стекло-стекло 180°','COLOR_VALUE':'Black (чёрный матовый)','PREVIEW_PICTURE':false,'DETAIL_PICTURE':{'ID':'1','SRC':'/upload/resize_cache/iblock/14c/black.jpg','BIG':{'src':'/upload/iblock/14c/black.jpg'}}},
{'ID':'3260','NAME':'Casa d\\'acqua-101/CP/Sa. Петля','PREVIEW_PICTURE':false,'DETAIL_PICTURE':false,'SLIDER':[{'ID':'9','SRC':'/upload/iblock/a41/sa.JPG'}]},
{'ID':'1932','NAME':'New York-331. Петля стена-стекло 90°','PREVIEW_PICTURE':false,'DETAIL_PICTURE':false,'SLIDER':[]}
],'OFFER_SELECTED':0,'TREE_PROPS':[{'ID':'109','SRC':'/upload/not-an-offer.png'}]})</script>`

describe('pickVetroPage — фото каждого цвета с одной страницы товара', () => {
  const p = pickVetroPage(HTML, URL)
  it('превью 480 px, иначе большое фото, иначе первое из слайдера; без фото — цвета нет в списке', () => {
    expect(Object.fromEntries(p.offers)).toEqual({
      2090: 'https://vetro-furniture.ru/upload/iblock/4f2/cp-480.JPG',
      4146: 'https://vetro-furniture.ru/upload/resize_cache/iblock/14c/black.jpg',
      3260: 'https://vetro-furniture.ru/upload/iblock/a41/sa.JPG',
    })
  })
  it('фото модели — og:image: им закрывается цвет без своего фото', () => {
    expect(p.image).toBe('https://vetro-furniture.ru/upload/iblock/7e7/model.JPG')
  })
  it('характеристики модели: материал и свойства с одним значением; цвет и чужой блок — нет', () => {
    expect(p.specs).toEqual({ 'Материал': 'Латунь (твердый сплав)', 'Угол установки': '180°', 'Открывание': 'В обе стороны', 'Регулировка 0 положения': 'да' })
  })
})

describe('ссылка строки прайса Ветро', () => {
  it('oid — цвет, страница товара — без запроса', () => {
    const u = 'https://vetro-furniture.ru/catalog/petli_dlya_dushevykh/premium_petli/2087/?oid=4146'
    expect(vetroOfferId(u)).toBe('4146')
    expect(vetroProductUrl(u)).toBe(URL)
    expect(vetroOfferId(URL)).toBe('')
  })
})
