import type { StepImport } from '@/lib/calc/stepImport'

// Готовые модели конструктора «Из деталей» (CONSTRUCTOR_ROUTE.md, К8): чертёж SolidWorks, разобранный
// один раз и сохранённый как есть — стёкла, места и высоты деталей. Загружается тем же путём, что
// импорт файла: что есть в каталоге — строкой с ценой, остальное ждёт подбора и в цену не идёт.
// Тест сверяет сохранённое с разбором самого файла (__tests__/fixtures/step).

export type ReadyModel = {
  id: string
  code: string           // модель из «Прайса душевых» по схеме стёкол
  label: string
  note: string           // подпись на карточке
  imp: StepImport
}

export const READY_MODELS: ReadyModel[] = [
  {
    // Владелец 10.10: «Сохрани 0828-2 как готовую модель М7». Схема М7 (неподвижное у стены, дверь
    // на нём, бок под 90°), но стёкла 2 709 мм — выше типовой М7 (1 800–2 200).
    id: 'm7-0828-2', code: 'М7', label: 'М7 · 0828-2', note: 'угловая распашная по чертежу, высота 2 709',
    imp: {
      name: '0828-2', shape: 'corner', thickness: 8, finish: 'chrome', notes: [],
      panels: [
        { key: 'g1', label: 'Неподвижное', w: 536, h: 2709, run: 'front', kind: 'fixed' },
        { key: 'g2', label: 'Дверь', w: 650, h: 2686, run: 'front', kind: 'door', hinge: 'left' },
        { key: 'g3', label: 'Боковое', w: 935, h: 2709, run: 'side', kind: 'fixed' },
      ],
      hardware: [
        { name: 'Держатель штанга A-B-ST-4201 - хром', role: 'stabilizer', qty: 1, at: [{ panel: 'g3', edge: 'top', pos: [49] }] },
        { name: 'Держатель штанга A-B-ST-4207', role: 'stabilizer', qty: 1, at: [{ panel: 'g1', edge: 'top', pos: [464] }] },
        { name: 'магнит 90 град большой', role: 'seal-magnet', qty: 1, pieces: [2686], at: [{ panel: 'g2', edge: 'right' }] },
        { name: 'Dessau-103 Петля хром', role: 'hinge', qty: 3, at: [{ panel: 'g2', edge: 'left', pos: [227, 1986, 2436] }] },
        { name: 'Ручка DP-70', role: 'handle', qty: 1, at: [{ panel: 'g2', edge: 'right', pos: [972] }] },
        { name: 'Труба (штанга) 30×10', role: 'profile', qty: 1, pieces: [1185], at: [{ panel: 'g1', edge: 'top' }, { panel: 'g2', edge: 'top' }] },
      ],
    },
  },
]
