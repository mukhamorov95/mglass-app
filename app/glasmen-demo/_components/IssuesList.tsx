'use client'

import type { DfmIssue } from '@/lib/glasmen'

// Короткое имя и «как исправить» по коду — как экраны ошибок SendCutSend: код → объяснение → что делать.
export const ISSUE_INFO: Record<string, { title: string; fix: string }> = {
  empty_drawing: { title: 'В файле нет детали', fix: 'Сохраните чертёж как ASCII DXF с контуром детали (линии, дуги, полилинии).' },
  open_entities: { title: 'Контур не замкнут', fix: 'Соедините концы линий в CAD-программе (JOIN / PEDIT), чтобы контур стал замкнутым.' },
  multiple_parts: { title: 'Несколько деталей в одном файле', fix: 'Сохраните каждую деталь отдельным файлом.' },
  contours_intersect: { title: 'Контуры пересекаются', fix: 'Внутренний контур (отверстие, вырез) должен целиком лежать внутри детали.' },
  nested_contours: { title: 'Контур внутри выреза', fix: 'Удалите контур, лежащий внутри отверстия или выреза: там нет стекла.' },
  blocks_ignored: { title: 'Блоки пропущены', fix: 'Разбейте блоки (EXPLODE) и загрузите снова, если в них часть детали.' },
  unsupported_entities: { title: 'Объекты пропущены', fix: 'Нужен плоский 2D-чертёж контура из линий, дуг, полилиний и обычных сплайнов.' },
  units_suspect: { title: 'Похоже, не те единицы', fix: 'Проверьте габарит и выберите единицы в окне единиц.' },
  units_unsupported: { title: 'Необычные единицы в файле', fix: 'Выберите мм, см, м или дюймы в окне единиц.' },
  too_complex: { title: 'Чертёж слишком сложный', fix: 'Оставьте в файле только контур детали, отверстия и вырезы — без штриховки, текста, рамки и лишних блоков.' },
  bad_numbers: { title: 'Битые числа в чертеже', fix: 'Пересохраните DXF из CAD-программы: в файле есть координаты, которые не являются числами.' },
  too_small: { title: 'Деталь меньше допустимой', fix: 'Увеличьте деталь или откажитесь от закалки.' },
  too_large: { title: 'Деталь больше листа', fix: 'Разделите деталь на части.' },
  too_large_for_tempering: { title: 'Не входит в печь закалки', fix: 'Уменьшите деталь, разделите её или закажите без закалки.' },
  heavy_part: { title: 'Тяжёлая деталь', fix: 'Учтите доставку и монтаж бригадой, фурнитуру под вес.' },
  hole_too_small: { title: 'Отверстие слишком маленькое', fix: 'Увеличьте диаметр до минимума для этой толщины.' },
  hole_too_close_edge: { title: 'Отверстие близко к кромке', fix: 'Сдвиньте отверстие от кромки.' },
  hole_too_close_corner: { title: 'Отверстие близко к углу', fix: 'Сдвиньте отверстие от угла.' },
  holes_too_close: { title: 'Отверстия близко друг к другу', fix: 'Разнесите отверстия.' },
  narrow_bridge: { title: 'Узкая перемычка', fix: 'Отодвиньте вырез или отверстие от кромки и друг от друга.' },
  cutout_sharp_corner: { title: 'Острый внутренний угол', fix: 'Скруглите внутренние углы выреза до минимального радиуса.' },
  param_clamped: { title: 'Значение вне диапазона', fix: 'Взято ближайшее допустимое — проверьте параметр шаблона.' },
}

export const issueTitle = (i: DfmIssue) => ISSUE_INFO[i.code]?.title ?? i.code

// Жёсткие сначала, затем предупреждения; внутри — порядок проверки.
export function sortIssues(list: DfmIssue[]): { issue: DfmIssue; idx: number }[] {
  return list.map((issue, idx) => ({ issue, idx })).sort((a, b) => (a.issue.level === b.issue.level ? a.idx - b.idx : a.issue.level === 'hard' ? -1 : 1))
}

export default function IssuesList({ issues, selected, onSelect }: { issues: DfmIssue[]; selected: number | null; onSelect: (idx: number | null) => void }) {
  if (!issues.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
        Проверка по правилам стекла: нарушений нет. <span className="text-emerald-700">Правила — черновик, ждут технолога.</span>
      </div>
    )
  }
  const hard = issues.filter(i => i.level === 'hard').length
  const soft = issues.length - hard
  return (
    <div className="space-y-2">
      <div className="text-[12px] text-[#9a9a95]">
        Проверка по правилам стекла: {hard ? <span className="font-medium text-red-700">нельзя изготовить — {hard}</span> : 'изготовить можно'}
        {soft ? <> · предупреждений — {soft}</> : null}. Правила — черновик, ждут технолога. Нажмите на пункт — подсвечу место на детали.
      </div>
      <ul className="space-y-1.5">
        {sortIssues(issues).map(({ issue, idx }) => {
          const info = ISSUE_INFO[issue.code]
          const isHard = issue.level === 'hard'
          const active = selected === idx
          const locatable = !!(issue.region || issue.at)
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : idx)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-[13px] leading-snug transition ${
                  isHard ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950'
                } ${active ? (isHard ? 'ring-2 ring-red-400' : 'ring-2 ring-amber-400') : ''}`}
              >
                <div className="font-medium">
                  {isHard ? 'Нельзя изготовить: ' : 'Предупреждение: '}
                  {info?.title ?? issue.code}
                  {!locatable && <span className="ml-1 font-normal opacity-60">(без отметки на детали)</span>}
                </div>
                <div className="mt-0.5 opacity-90">{issue.message}</div>
                {info?.fix && <div className="mt-0.5 opacity-70">Как исправить: {info.fix}</div>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
