'use client'

import { EXECUTOR, vatIncluded } from '@/lib/companyRequisites'

// ── Типы ────────────────────────────────────────────────
export type Customer = {
  // физлицо
  fio?: string; passport_series?: string; passport_number?: string
  passport_issued_by?: string; passport_issued_date?: string; passport_code?: string
  address?: string; phone?: string
  // юрлицо
  name?: string; director?: string; inn?: string; kpp?: string; ogrn?: string
  legal_address?: string; actual_address?: string; account?: string
  bank?: string; bik?: string; corr_account?: string; email?: string
}
export type SpecItem = { name: string; desc?: string; dimensions?: string; qty?: number | string }
export type ContractContent = {
  number?: string; date?: string
  customer_type?: 'individual' | 'company'
  customer?: Customer
  spec?: SpecItem[]
  total?: number | string; make_sum?: number | string; install_sum?: number | string
  prepayment?: number | string
  make_days?: number; install_days?: number
}

const numOr = (v: number | string | undefined) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : 0
}
export const RUB = (v: number | string | undefined) =>
  numOr(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Заказчик одной строкой (для преамбулы и реквизитов).
export function customerLine(type: string | undefined, c: Customer = {}): string {
  if (type === 'company') {
    const p: string[] = []
    if (c.name) p.push(c.name)
    if (c.director) p.push(`в лице ${c.director}`)
    if (c.inn || c.kpp) p.push(`ИНН/КПП ${c.inn ?? ''}${c.kpp ? '/' + c.kpp : ''}`)
    if (c.ogrn) p.push(`ОГРН ${c.ogrn}`)
    if (c.legal_address) p.push(`юр. адрес: ${c.legal_address}`)
    if (c.actual_address) p.push(`факт. адрес: ${c.actual_address}`)
    if (c.account) p.push(`р/с ${c.account}`)
    if (c.bank) p.push(c.bank)
    if (c.bik) p.push(`БИК ${c.bik}`)
    if (c.corr_account) p.push(`к/с ${c.corr_account}`)
    if (c.phone) p.push(`тел. ${c.phone}`)
    if (c.email) p.push(c.email)
    return p.join(', ') || '—'
  }
  const p: string[] = []
  if (c.fio) p.push(c.fio)
  const pass = [c.passport_series, c.passport_number].filter(Boolean).join(' ')
  if (pass) p.push(`паспорт ${pass}`)
  if (c.passport_issued_by) p.push(`выдан ${c.passport_issued_by}`)
  if (c.passport_issued_date) p.push(`от ${c.passport_issued_date}`)
  if (c.passport_code) p.push(`код подразделения ${c.passport_code}`)
  if (c.address) p.push(`адрес регистрации: ${c.address}`)
  if (c.phone) p.push(`тел. ${c.phone}`)
  return p.join(', ') || '—'
}

const money = (v: number | string | undefined) => `${RUB(v)} руб. (в т.ч. НДС ${EXECUTOR.vatRate}%)`

// ── Счёт (1 страница) ───────────────────────────────────
export function InvoiceDocument({ c, qr }: { c: ContractContent; qr: string }) {
  const total = numOr(c.total)
  const prepay = (c.prepayment == null || c.prepayment === '') ? total : numOr(c.prepayment)
  const pct = total > 0 ? Math.round(prepay / total * 100) : 100
  const vat = vatIncluded(prepay)
  const payLabel = pct >= 100 ? 'Авансовый платёж в размере 100%' : `Предоплата (${pct}%)`
  return (
    <div className="doc-page invoice">
      <div className="inv-hdr">
        <b>{EXECUTOR.name.toUpperCase()}</b><br />{EXECUTOR.legalAddress}
      </div>
      <table className="inv-bank">
        <tbody>
          <tr><td>Банк получателя<br /><b>{EXECUTOR.bankName}</b></td><td className="k">БИК</td><td>{EXECUTOR.bik}</td></tr>
          <tr><td rowSpan={2} /><td className="k">Корр. сч. №</td><td>{EXECUTOR.corrAccount}</td></tr>
          <tr><td className="k">Сч. №</td><td>{EXECUTOR.account}</td></tr>
          <tr><td>Получатель<br />ИНН {EXECUTOR.inn}</td><td className="k">Сч. №</td><td>{EXECUTOR.account}</td></tr>
        </tbody>
      </table>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="inv-qr" src={qr} alt="QR оплаты" />
      )}
      <h2 className="inv-title">СЧЁТ № {c.number ?? '—'} от {c.date ?? ''}</h2>
      <p className="inv-party"><span>Исполнитель:</span> {EXECUTOR.name}, ОГРНИП {EXECUTOR.ogrnip}, ИНН {EXECUTOR.inn}. Юридический адрес: {EXECUTOR.legalAddress}. Номер счёта: {EXECUTOR.account}. Банк: {EXECUTOR.bankName}, БИК {EXECUTOR.bik}, К/С {EXECUTOR.corrAccount}.</p>
      <p className="inv-party"><span>Заказчик:</span> {customerLine(c.customer_type, c.customer)}</p>
      <table className="inv-items">
        <thead><tr><th>№</th><th>Наименование товара или услуги</th><th>Ед.</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>{payLabel} по договору № {c.number ?? ''} от {c.date ?? ''}</td><td>шт.</td><td>1</td><td className="r">{RUB(prepay)}</td><td className="r">{RUB(prepay)}</td></tr>
        </tbody>
      </table>
      <table className="inv-tot"><tbody>
        <tr><td>Итого:</td><td className="r">{RUB(prepay)}</td></tr>
        <tr><td>В т. ч. НДС ({EXECUTOR.vatRate}%):</td><td className="r">{RUB(vat)}</td></tr>
        <tr><td><b>Всего к оплате:</b></td><td className="r"><b>{RUB(prepay)}</b></td></tr>
      </tbody></table>
      <div className="inv-sign">
        Руководитель предприятия ______________________ / {EXECUTOR.fio} /
        <div className="stamp-slot">М.П.</div>
      </div>
    </div>
  )
}

// ── Договор (юридический текст) ─────────────────────────
export function ContractDocument({ c }: { c: ContractContent }) {
  const make = c.make_days ?? 15
  const install = c.install_days ?? 5
  const totalDays = make + install
  const spec = c.spec && c.spec.length ? c.spec : []
  const cust = customerLine(c.customer_type, c.customer)
  const totalN = numOr(c.total), makeN = numOr(c.make_sum), installN = numOr(c.install_sum)
  const prepay = (c.prepayment == null || c.prepayment === '') ? totalN : numOr(c.prepayment)
  const isFull = prepay >= totalN
  const remMake = Math.max(0, makeN - prepay)
  const remInstall = Math.max(0, installN - Math.max(0, prepay - makeN))
  return (
    <div className="doc-page contract">
      <div className="c-hdr">
        <div><b>{EXECUTOR.nameShort}</b><br />ИНН {EXECUTOR.inn}<br />Тел.: {EXECUTOR.phone}</div>
        <div className="c-hdr-r"><b>ДОГОВОР № {c.number ?? '—'}</b><br />{c.date ?? ''}</div>
      </div>

      <p>{EXECUTOR.name} (ОГРНИП {EXECUTOR.ogrnip}), действующий на основании законодательства Российской Федерации о государственной регистрации индивидуальных предпринимателей, именуемый в дальнейшем «Исполнитель», с одной стороны, и {cust}, именуемый в дальнейшем «Заказчик», с другой стороны, вместе именуемые «Стороны», заключили настоящий Договор возмездного оказания услуг о нижеследующем:</p>

      <h3>1. ПРЕДМЕТ ДОГОВОРА</h3>
      <p>1.1. По настоящему Договору Исполнитель обязуется осуществить поставку и монтаж зеркал и иных стеклоизделий (далее — «Изделия»), а Заказчик обязуется принять и оплатить указанные Изделия и работы по их монтажу на условиях настоящего Договора.</p>
      <p>1.2. Наименование, количество, ассортимент, технические характеристики и стоимость Изделий определяются в соответствии со Спецификацией (Раздел № 2).</p>
      <p>1.3. Исполнитель применяет НДС по ставке {EXECUTOR.vatRate}% в соответствии с законодательством РФ на все поставки и работы по монтажу в рамках настоящего Договора.</p>

      <h3>2. СПЕЦИФИКАЦИЯ</h3>
      {spec.length ? spec.map((s, i) => (
        <p key={i}>2.{i + 1}. {s.name}{s.desc ? `. ${s.desc}` : ''}{s.dimensions ? `. Размеры: ${s.dimensions}` : ''}{s.qty ? ` — ${s.qty} шт.` : ''}</p>
      )) : <p>2.1. Согласно приложению.</p>}

      <h3>3. ОСОБЫЕ УСЛОВИЯ</h3>
      <p>3.1. Любые работы, не предусмотренные настоящим Договором и Спецификацией, признаются дополнительными и подлежат отдельной оплате на условиях, согласованных Сторонами в дополнительном соглашении.</p>
      <p>3.2. Заказчик подтверждает, что после внесения авансового платежа и утверждения Спецификации любые односторонние требования об изменении перечня, характеристик или стоимости Изделий не принимаются. Все последующие изменения допускаются исключительно по инициативе Заказчика и только при условии полной компенсации дополнительных расходов Исполнителя, а также продления срока исполнения Договора.</p>

      <h3>4. СРОКИ ВЫПОЛНЕНИЯ</h3>
      <p>4.1. Общий срок исполнения обязательств по Договору составляет {totalDays} рабочих дней и включает: {make} рабочих дней — на изготовление Изделий; {install} рабочих дней — на их доставку и монтаж.</p>
      <p>4.2. Указанный срок начинает течь с даты поступления 100% авансового платежа на расчётный счёт Исполнителя и при наличии свободного доступа к объекту для замеров и предоставлении Заказчиком всех необходимых данных и согласованных чертежей.</p>
      <p>4.3. Все изменения и дополнения к Договору имеют силу только при оформлении письменным соглашением, подписанным обеими Сторонами.</p>

      <h3>5. ОБЯЗАННОСТИ СТОРОН</h3>
      <p>5.1. Исполнитель обязуется изготовить, поставить и смонтировать Изделия в соответствии с Договором и Спецификацией, обеспечивая надлежащее качество материалов и работ, а также консультационную поддержку Заказчика.</p>
      <p>5.2. Заказчик обязуется своевременно и в полном объёме оплатить работы, обеспечить беспрепятственный доступ на объект для замеров, поставки материалов и монтажных работ.</p>

      <h3>6. РАЗМЕР И ПОРЯДОК ОПЛАТЫ</h3>
      <p>6.1. Общая стоимость Изделий и работ по настоящему Договору составляет {money(c.total)} и складывается из: стоимости изготовления и поставки Изделий — {money(c.make_sum)}; стоимости монтажных работ — {money(c.install_sum)}.</p>
      <p>6.2. Детальная стоимость определяется Сторонами в Спецификации (Раздел № 2).</p>
      {isFull ? (
        <p>6.3. Заказчик осуществляет авансовый платёж в размере 100% от общей стоимости Договора в срок не позднее 3 (трёх) рабочих дней с даты подписания Договора. После поступления аванса Исполнитель приступает к изготовлению Изделий.</p>
      ) : (
        <>
          <p>6.3. Заказчик вносит предоплату в размере {RUB(prepay)} руб. (в т.ч. НДС {EXECUTOR.vatRate}%) в срок не позднее 3 (трёх) рабочих дней с даты подписания Договора. После поступления предоплаты Исполнитель приступает к изготовлению Изделий.</p>
          <p>6.4. Остаток за изготовление в размере {RUB(remMake)} руб. Заказчик оплачивает по готовности Изделий, до выезда на монтаж, в течение 3 (трёх) рабочих дней с даты уведомления Исполнителя о готовности. После оплаты Стороны согласовывают дату монтажа.</p>
          <p>6.5. Остаток за монтаж в размере {RUB(remInstall)} руб. Заказчик оплачивает после выполнения монтажных работ, в течение 1 (одного) рабочего дня с даты подписания Акта сдачи-приёмки.</p>
        </>
      )}
      <p>6.6. Приёмка результата работ осуществляется путём подписания Сторонами Акта сдачи-приёмки выполненных работ. Акт должен быть подписан либо мотивированно отклонён в течение 3 (трёх) рабочих дней.</p>

      <h3>7. ОТВЕТСТВЕННОСТЬ СТОРОН</h3>
      <p>7.2. Гарантийный срок на Изделия и работы составляет {EXECUTOR.warrantyMonths} месяцев с даты подписания Акта сдачи-приёмки работ.</p>
      <p>7.4. При нарушении сроков по вине Исполнителя он уплачивает Заказчику неустойку 0,1% от общей стоимости Договора за каждый день просрочки, но не более 1% от общей стоимости.</p>

      <h3>8. ДЕЙСТВИЕ ДОГОВОРА</h3>
      <p>8.2. Договор считается заключённым с момента совершения Заказчиком акцепта оферты, которым признаётся 100% предоплата услуг по Договору. Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу.</p>

      <h3>9. ГАРАНТИЙНЫЕ ОБЯЗАТЕЛЬСТВА</h3>
      <p>9.2. На поставленные Изделия и выполненные монтажные работы устанавливается гарантийный срок {EXECUTOR.warrantyMonths} месяцев с даты подписания Акта. Гарантия не распространяется на недостатки вследствие нормального износа, неправильной эксплуатации, механических повреждений и форс-мажора.</p>

      <h3>10. ФОРС-МАЖОР</h3>
      <p>10.1. Стороны освобождаются от ответственности за неисполнение обязательств, если оно явилось следствием обстоятельств непреодолимой силы, возникших после заключения Договора и вне разумного контроля Сторон.</p>

      <h3>11. ЮРИДИЧЕСКИЕ АДРЕСА И РЕКВИЗИТЫ СТОРОН</h3>
      <div className="c-req">
        <div><b>Исполнитель:</b><br />{EXECUTOR.name}<br />ИНН {EXECUTOR.inn}, ОГРНИП {EXECUTOR.ogrnip}<br />{EXECUTOR.legalAddress}<br />Счёт: {EXECUTOR.account}<br />{EXECUTOR.bankName}, БИК {EXECUTOR.bik}, К/С {EXECUTOR.corrAccount}<br /><br />__________________ / {EXECUTOR.fioShort} /</div>
        <div><b>Заказчик:</b><br />{cust}<br /><br />__________________ /                          /</div>
      </div>
    </div>
  )
}
