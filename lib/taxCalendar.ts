// Б12: типовые сроки налоговых платежей. Чистый модуль: даты считаются от
// переданного года, ничего не читает и не пишет. Правило переноса — если срок
// падает на выходной, он сдвигается на ближайший рабочий день вперёд (сб/вс;
// производственный календарь с праздниками сюда не тянем — бухгалтер поправит
// руками, зато не будет вранья от устаревшего справочника праздников).

export type TaxRegime = 'usn' | 'patent' | 'osno'
export type TaxKind = 'УСН' | 'патент' | 'взносы' | 'НДС' | 'НДФЛ' | 'прочее'

export type TaxDue = {
  kind: TaxKind
  title: string
  period: string
  dueDate: string      // YYYY-MM-DD
}

const QUARTER_LABEL = ['1 квартал', '2 квартал', '3 квартал', '4 квартал']

function shiftWeekend(iso: string): string {
  const t = Date.parse(iso + 'T00:00:00Z')
  const day = new Date(t).getUTCDay()
  const add = day === 6 ? 2 : day === 0 ? 1 : 0
  return new Date(t + add * 86_400_000).toISOString().slice(0, 10)
}

const at = (y: number, m: number, d: number) =>
  shiftWeekend(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

// Единый налоговый платёж: авансы УСН — 28-е число месяца, следующего за
// кварталом; годовой — 28 марта (ООО) и 28 апреля (ИП).
export function usnDues(year: number, isCompany: boolean): TaxDue[] {
  const dues: TaxDue[] = [
    { kind: 'УСН', title: 'Аванс УСН', period: `${QUARTER_LABEL[0]} ${year}`, dueDate: at(year, 4, 28) },
    { kind: 'УСН', title: 'Аванс УСН', period: `полугодие ${year}`, dueDate: at(year, 7, 28) },
    { kind: 'УСН', title: 'Аванс УСН', period: `9 месяцев ${year}`, dueDate: at(year, 10, 28) },
  ]
  dues.push(isCompany
    ? { kind: 'УСН', title: 'УСН за год', period: `${year} год`, dueDate: at(year + 1, 3, 28) }
    : { kind: 'УСН', title: 'УСН за год', period: `${year} год`, dueDate: at(year + 1, 4, 28) })
  return dues
}

// Взносы ИП: фиксированные — до 28 декабря, 1% с дохода свыше 300 000 ₽ — до 1 июля следующего года.
export function ipContributions(year: number): TaxDue[] {
  return [
    { kind: 'взносы', title: 'Фиксированные взносы ИП', period: `${year} год`, dueDate: at(year, 12, 28) },
    { kind: 'взносы', title: 'Взносы 1% с дохода свыше 300 000 ₽', period: `${year} год`, dueDate: at(year + 1, 7, 1) },
  ]
}

// Взносы за сотрудников и НДФЛ — ежемесячно 28-го за предыдущий месяц.
export function payrollDues(year: number): TaxDue[] {
  const months = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']
  return months.map((label, i) => ({
    kind: 'НДФЛ' as TaxKind,
    title: 'НДФЛ и страховые взносы за сотрудников',
    period: `${label} ${year}`,
    dueDate: i === 11 ? at(year + 1, 1, 28) : at(year, i + 2, 28),
  }))
}

// НДС на ОСНО: тремя равными частями 28-го числа каждого месяца следующего квартала.
export function vatDues(year: number): TaxDue[] {
  const out: TaxDue[] = []
  for (let q = 0; q < 4; q++) {
    for (let part = 1; part <= 3; part++) {
      const month = q * 3 + 3 + part          // 1 кв → апрель, май, июнь
      const y = month > 12 ? year + 1 : year
      out.push({
        kind: 'НДС', title: `НДС, платёж ${part} из 3`,
        period: `${QUARTER_LABEL[q]} ${year}`,
        dueDate: at(y, month > 12 ? month - 12 : month, 28),
      })
    }
  }
  return out
}

// Патент: если куплен на год — 1/3 в первые 90 дней, остальное до конца года.
export function patentDues(year: number): TaxDue[] {
  return [
    { kind: 'патент', title: 'Патент, 1/3 стоимости', period: `${year} год`, dueDate: at(year, 3, 31) },
    { kind: 'патент', title: 'Патент, остаток', period: `${year} год`, dueDate: at(year, 12, 31) },
  ]
}

export function buildYear(year: number, regime: TaxRegime, opts: { company: boolean; hasStaff: boolean }): TaxDue[] {
  const dues: TaxDue[] = []
  if (regime === 'usn') dues.push(...usnDues(year, opts.company))
  if (regime === 'patent') dues.push(...patentDues(year))
  if (regime === 'osno') dues.push(...vatDues(year))
  if (!opts.company) dues.push(...ipContributions(year))
  if (opts.hasStaff) dues.push(...payrollDues(year))
  return dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
