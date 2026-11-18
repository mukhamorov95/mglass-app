import Image from "next/image";
import Link from "next/link";
import { WorksStrip } from "@/components/WorksStrip";
import { Faq, Gallery, LandingCard, LeadSection, LightModes, Materials, PriceFactors, Proof, Steps, YandexReviews } from "@/components/blocks";
import { ButtonLink, Container, JsonLd, SectionTitle } from "@/components/ui";
import { getLanding } from "@/content/landings";
import { OBJECTS } from "@/content/objects";
import { PHOTOS } from "@/content/photos";
import { breadcrumbSchema, faqSchema, pageMetadata, serviceSchema } from "@/lib/seo";
import { SITE } from "@/lib/site";

const TITLE = "Зеркала на заказ в Москве по индивидуальным размерам — с подсветкой | M-Glass";
const DESCRIPTION =
  "Изготовление зеркал на заказ по вашим размерам: с подсветкой-аурой и светом на лицо, в раме, круглые, овальные, в полный рост, в ванную. Резка, фацет, пескоструй, монтаж в Москве и МО.";

export const metadata = pageMetadata({ path: "/", title: TITLE, description: DESCRIPTION, image: PHOTOS.rectAura.img });

const FEATURED = ["zerkala-s-podsvetkoj", "zerkala-v-vannuyu", "zerkala-v-rame", "zerkala-v-polnyj-rost", "kruglye-zerkala", "zerkala-bez-podsvetki"];

const HUB_FAQ = [
  { q: "Сколько стоит зеркало на заказ?", a: "Зависит от площади, вида зеркала, формы, кромки, подсветки, рамы и монтажа. Пришлите размеры — посчитаем." },
  { q: "Можно нестандартный размер?", a: "Да, мы делаем только по размерам: под тумбу, нишу или стену." },
  { q: "Из какого зеркала делаете?", a: "Серебро 4, 5 и 6 мм, осветлённое 4 и 6 мм, бронза и графит 4 и 6 мм, состаренное 4 мм." },
  { q: "Сколько делается зеркало?", a: `${SITE.leadTime.regular}. Срочно — ${SITE.leadTime.urgent}, с LED-подсветкой — ${SITE.leadTime.urgentLed}.` },
  { q: "Какая гарантия?", a: `${SITE.warrantyMonths} месяцев по договору.` },
  { q: "Устанавливаете?", a: `Да: замер, доставка и монтаж. ${SITE.serviceArea}.` },
  { q: "Доставляете в другие города?", a: `Да. ${SITE.shipping} — упакуем для перевозки.` },
  { q: "Работаете с дизайнерами и юрлицами?", a: "Да: серии полотен по спецификации, зеркальные стены, договор и счёт." },
];

// Пример цены — из последнего объекта с ценой из его КП, а не оценка.
function priceExample() {
  const o = [...OBJECTS].sort((x, y) => y.published.localeCompare(x.published)).find((x) => x.example);
  return o?.example ? { o, ...o.example } : null;
}

export default function HomePage() {
  const featured = FEATURED.map(getLanding).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const hero = PHOTOS.rectAura;
  const example = priceExample();

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({ name: "Зеркала на заказ", serviceType: "Изготовление зеркал на заказ", description: DESCRIPTION, path: "/", image: hero.img.src }),
          breadcrumbSchema([{ name: "Зеркала на заказ", path: "/" }]),
          faqSchema(HUB_FAQ),
        ]}
      />

      <section className="pb-12 pt-6 sm:pb-16 sm:pt-10">
        <Container className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-brass">{SITE.serviceArea}</div>
            <h1 className="mt-3 text-4xl font-bold leading-[1.04] tracking-tight [text-wrap:balance] sm:text-6xl">
              Зеркала на&nbsp;заказ <span className="whitespace-nowrap">в&nbsp;Москве</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/75 sm:mt-5 sm:text-lg">
              Режем зеркало по размерам вашей стены, собираем подсветку и вешаем. Свет за зеркалом или на лицо, в раме, любой
              формы.
            </p>
            <Proof className="mt-6" />
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#zayavka">Рассчитать стоимость</ButtonLink>
              {/* На телефоне номер уже в нижней панели «Позвонить» */}
              <div className="hidden sm:block">
                <ButtonLink href={SITE.phone.href} variant="light">
                  {SITE.phone.display}
                </ButtonLink>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">Пришлите размеры — посчитаем цену вашего зеркала.</p>
            <WorksStrip />
          </div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl lg:aspect-auto lg:h-[min(640px,calc(100svh-9rem))]">
            <Image src={hero.img} alt={hero.alt} fill priority sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" placeholder="blur" />
            <span className="absolute left-4 top-4 rounded-full bg-paper/90 px-3 py-1 text-xs font-semibold backdrop-blur">
              Наша работа<span className="hidden sm:inline"> · {hero.caption.toLowerCase()}</span>
            </span>
            {example && (
              <Link
                href={`/raboty/${example.o.slug}`}
                className="group absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-paper/95 p-3 pr-4 shadow-lg backdrop-blur sm:inset-x-auto sm:left-4 sm:max-w-sm"
              >
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                  <Image src={example.photo.img} alt={example.photo.alt} fill sizes="56px" className="object-cover" />
                </span>
                <span className="min-w-0 text-sm leading-snug">
                  <span className="block text-muted">{example.o.card.label} · {example.label}</span>
                  <span className="block font-bold tabular-nums">
                    {example.price} <span className="font-semibold text-brass group-hover:underline">смотреть объект →</span>
                  </span>
                </span>
              </Link>
            )}
          </div>
        </Container>
      </section>

      <section className="py-12 sm:py-16">
        <Container>
          <SectionTitle sub="Все — по вашим размерам">Каталог зеркал на заказ</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((l) => (
              <LandingCard key={l.slug} l={l} />
            ))}
          </div>
        </Container>
      </section>

      <LightModes />
      <Gallery keys={["roundAura", "archAura", "capsulesBlack", "hallBlack", "frontLight", "ovalGold"]} />
      <PriceFactors />
      <Steps />
      <Materials />


      <section className="py-10 sm:py-14">
        <Container className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Что о нас пишут</h2>
            <p className="mt-3 leading-relaxed text-muted">
              Отзывы клиентов с нашей карточки на Яндекс Картах — без правок.
            </p>
            <div className="mt-5">
              <ButtonLink href="/otzyvy" variant="light">
                Все отзывы
              </ButtonLink>
            </div>
          </div>
          <YandexReviews compact />
        </Container>
      </section>

      <Faq items={HUB_FAQ} />
      <section className="py-12 sm:py-16">
        <Container className="max-w-3xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">Изготовление зеркал по индивидуальным размерам</h2>
          <div className="prose-site leading-relaxed text-ink/85">
            <p>
              Готовое зеркало редко попадает в размер. Мы идём от стены: ширина и высота — по проёму, форма — по интерьеру, подсветка —
              по тому, зачем вы смотритесь в зеркало.
            </p>
            <p>
              Своя обработка: резка, полировка кромки, фацет 10, 15 или 20 мм, отверстия и вырезы под розетки, пескоструйный рисунок.
              Делаем зеркала в ванную, прихожую, спальню и гардеробную, зеркальные стены для квартир и залов, серии для салонов.
            </p>
          </div>
        </Container>
      </section>
      <LeadSection />
    </>
  );
}
