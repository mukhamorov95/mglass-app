import type { OperationCode } from '../types'

// Природа операции. Сторонние — подтверждено владельцем 26.11.2026: закалка, фацет, триплекс,
// раскрой металла и покраска металлических рам; остальные операции — свои. Металл, комплектующие и упаковка —
// прямые материалы. «Подложка» и «сложная форма» не определены (вопрос В4).
export type OperationNature = 'material' | 'external' | 'own_operation' | 'commission' | 'allowance' | 'unknown'

export const OPERATIONS: Record<OperationCode, { label: string; nature: OperationNature }> = {
  material:           { label: 'Стекло и зеркало', nature: 'material' },
  components:         { label: 'Комплектующие', nature: 'material' },
  frame_metal:        { label: 'Металл рамы', nature: 'material' },
  consumables:        { label: 'Расходные материалы изделия', nature: 'material' },
  packaging:          { label: 'Упаковка', nature: 'material' },
  tempering:          { label: 'Закалка', nature: 'external' },
  facet:              { label: 'Фацет', nature: 'external' },
  triplex:            { label: 'Триплекс', nature: 'external' },
  frame_paint:        { label: 'Покраска рамы', nature: 'external' },
  cutting:            { label: 'Резка', nature: 'own_operation' },
  curved:             { label: 'Криволинейная обработка', nature: 'own_operation' },
  edge:               { label: 'Кромка', nature: 'own_operation' },
  drilling:           { label: 'Сверление', nature: 'own_operation' },
  cutout:             { label: 'Вырезы', nature: 'own_operation' },
  sandblast:          { label: 'Пескоструй', nature: 'own_operation' },
  film:               { label: 'Плёнка', nature: 'own_operation' },
  design:             { label: 'Макет и чертёж', nature: 'own_operation' },
  frame_cutting:      { label: 'Раскрой металла', nature: 'external' },
  frame_welding:      { label: 'Сварка каркаса', nature: 'own_operation' },
  assembly:           { label: 'Сборка', nature: 'own_operation' },
  transport:          { label: 'Перевозка на закалку', nature: 'own_operation' },
  underlay:           { label: 'Подложка', nature: 'unknown' },
  complex_shape:      { label: 'Надбавка «сложная форма»', nature: 'unknown' },
  commission:         { label: 'Комиссия менеджера', nature: 'commission' },
  overhead_allowance: { label: 'Накладные в модели изделия', nature: 'allowance' },
  scrap_allowance:    { label: 'Резерв брака в модели изделия', nature: 'allowance' },
  rounding:           { label: 'Округление изделия', nature: 'allowance' },
  unclassified:       { label: 'Не разнесено', nature: 'unknown' },
}

type Rule = [RegExp, OperationCode]

const SERVICE_RULES: Rule[] = [
  [/пескостру|матирован|матовк/i, 'sandblast'],
  [/пл[её]нк/i, 'film'],
  [/макет|оцифровк|черт[её]ж/i, 'design'],
  [/вырез/i, 'cutout'],
  [/отверст/i, 'drilling'],
  [/фигурн|непрямоугольн|т и г образн/i, 'curved'],
  [/подогрев/i, 'components'],
  [/триплекс/i, 'triplex'],
]

// Порядок значим: «Сборка зеркала…» и «Комплектующие зеркала» не должны стать материалом.
const BOM_RULES: Rule[] = [
  [/накладные производства/i, 'overhead_allowance'],
  [/резерв брака/i, 'scrap_allowance'],
  [/упаковк/i, 'packaging'],
  [/покраск/i, 'frame_paint'],
  [/свар/i, 'frame_welding'],
  [/резка|раскрой/i, 'frame_cutting'],
  [/сборк|остеклени/i, 'assembly'],
  [/пескостру/i, 'sandblast'],
  [/^закалка/i, 'tempering'],
  [/фацет/i, 'facet'],
  [/подложк/i, 'underlay'],
  [/сложная форма/i, 'complex_shape'],
  [/металл на раму/i, 'frame_metal'],
  [/расходники \(диски/i, 'consumables'],
  [/комплектующ|расходники подсветки|\blux\b|\bled\b|лента|профиль|блок питания|труба|раздвижн|трек|доводчик|уплотнител|штапик|бонки|кнопк|датчик|ручк|петл|подогрев/i, 'components'],
  [/серебро|осветл|стекло|зеркал|бронз|графит|прозрачн|мателюкс|сатин/i, 'material'],
]

const match = (rules: Rule[], name: string): OperationCode =>
  rules.find(([re]) => re.test(name))?.[1] ?? 'unclassified'

export const serviceOperation = (name: string) => match(SERVICE_RULES, name)
export const bomOperation = (name: string) => match(BOM_RULES, name)
