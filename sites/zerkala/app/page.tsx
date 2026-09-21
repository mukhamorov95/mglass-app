import Image from "next/image";
import Link from "next/link";
import { Faq, Gallery, LandingCard, LeadSection, LightModes, Materials, PriceFactors, Steps } from "@/components/blocks";
import { ButtonLink, Container, JsonLd, SectionTitle } from "@/components/ui";
import { getLanding, landingsByCluster } from "@/content/landings";
import { PHOTOS } from "@/content/photos";
import { breadcrumbSchema, faqSchema, pageMetadata, serviceSchema } from "@/lib/seo";
import { SITE } from "@/lib/site";

const TITLE = "Зеркала на заказ в Москве по индивидуальным размерам — с подсветкой | M-Glass";
const DESCRIPTION =
  "Изготовление зеркал на заказ по вашим размерам: с подсветкой-аурой и светом на лицо, в раме, круглые, овальные, в полный рост, в ванную. Резка, фацет, пескоструй, монтаж в Москве и МО.";

export const metadata = pageMetadata({ path: "/", title: TITLE, description: DESCRIPTION, image: PHOTOS.rectAura.img });

const FEATURED = ["zerkala-s-podsvetkoj", "zerkala-v-vannuyu", "zerkala-v-rame", "zerkala-v-polnyj-rost", "kruglye-zerkala", "zerkala-bez-podsvetki"];

const HUB_FAQ = [
  { q: "Сколько стоит зеркало на заказ?", a: "Цена зависит от площади и вида зеркала, формы, обработки кромки, подсветки, рамы и монтажа. Пришлите размеры и исполнение — посчитаем стоимость именно вашего зеркала." },
  { q: "Можно ли заказать зеркало нестандартного размера?", a: "Да, мы и делаем зеркала только по размерам: режем полотно под вашу тумбу, нишу или стену, а не подбираем ближайший стандарт." },
  { q: "Какие виды подсветки бывают?", a: "Аура — свечение за зеркалом на стену; фронтальная — свет на лицо через матовую пескоструйную полосу; и оба контура вместе. Управление кнопкой или сенсором." },
  { q: "Из какого зеркала вы делаете?", a: "Серебро 4, 5 и 6 мм, осветлённое 4 и 6 мм, бронза и графит 4 и 6 мм, состаренное 4 мм." },
  { q: "Вы устанавливаете зеркала?", a: `Да, делаем замер, доставку и монтаж. Работаем: ${SITE.serviceArea}.` },
  { q: "Работаете с дизайнерами и юрлицами?", a: "Да. Режем серии полотен по спецификации, делаем зеркальные стены для залов и серии зеркал для салонов, работаем по договору и счёту." },
];

export default function HomePage() {
  const clusters = landingsByCluster();
  const featured = FEATURED.map(getLanding).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const hero = PHOTOS.rectAura;

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({ name: "Зеркала на заказ", serviceType: "Изготовление зеркал на заказ", description: DESCRIPTION, path: "/", image: hero.img.src }),
          breadcrumbSchema([{ name: "Зеркала на заказ", path: "/" }]),
          faqSchema(HUB_FAQ),
        ]}
      />

      <section className="pb-12 pt-8 sm:pb-16 sm:pt-12">
        <Container className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brass">{SITE.serviceArea}</div>
            <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">Зеркала на заказ в Москве</h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              По вашим размерам — с подсветкой за зеркалом или светом на лицо, в раме, любой формы. Режем, обрабатываем, собираем
              подсветку и вешаем.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#zayavka">Рассчитать стоимость</ButtonLink>
              <ButtonLink href={SITE.phone.href} variant="light">
                {SITE.phone.display}
              </ButtonLink>
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-line pt-6">
              <div>
                <dt className="text-xs text-muted">Работаем</dt>
                <dd className="mt-1 text-xl font-bold">с {SITE.foundedYear}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Проектов из стекла и зеркал</dt>
                <dd className="mt-1 text-xl font-bold">{SITE.projects}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Видов зеркала</dt>
                <dd className="mt-1 text-xl font-bold">5</dd>
              </div>
            </dl>
          </div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl">
            <Image src={hero.img} alt={hero.alt} fill priority sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" placeholder="blur" />
          </div>
        </Container>
      </section>

      <section className="py-12 sm:py-16">
        <Container>
          <SectionTitle sub="Каждое зеркало делаем по размерам — выберите, с чего начать">Каталог зеркал на заказ</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((l) => (
              <LandingCard key={l.slug} l={l} />
            ))}
          </div>
          <div className="mt-8 grid gap-6 rounded-3xl border border-line bg-card p-6 sm:grid-cols-2 lg:grid-cols-5">
            {clusters.map((c) => (
              <div key={c.key}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c.title}</div>
                <ul className="space-y-1.5 text-sm">
                  {c.items.map((l) => (
                    <li key={l.slug}>
                      <Link href={`/${l.slug}`} className="hover:text-brass">
                        {l.h1}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <LightModes />
      <Gallery keys={["roundAura", "archAura", "capsulesBlack", "hallBlack", "frontLight", "ovalGold"]} />
      <Materials />
      <PriceFactors />
      <Steps />

      <section className="py-12 sm:py-16">
        <Container className="max-w-3xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">Изготовление зеркал по индивидуальным размерам</h2>
          <div className="prose-site leading-relaxed text-ink/85">
            <p>
              Готовое зеркало из магазина почти никогда не попадает в размер: оно или уже тумбы, или не влезает в нишу, или обрывается
              на полпути до пола. Мы работаем от обратного — сначала ваша стена, потом зеркало. Ширину и высоту берём по проёму,
              форму — по интерьеру, а подсветку — по тому, для чего вы будете смотреться в зеркало.
            </p>
            <p>
              У нас своя обработка стекла и зеркала: режем полотно, полируем кромку, делаем фацет 10, 15 или 20 мм, сверлим отверстия
              и вырезы под розетки, наносим пескоструйный рисунок. Подсветку собираем на плотной ленте 2835 и подбираем блок питания с
              запасом мощности, чтобы он не работал на пределе.
            </p>
            <p>
              Делаем зеркала в ванную, прихожую, спальню и гардеробную, зеркальные стены и панно для квартир, спортивных и
              танцевальных залов, серии зеркал для салонов красоты. Для дизайнеров и мебельщиков режем полотна по спецификации.
            </p>
          </div>
        </Container>
      </section>

      <Faq items={HUB_FAQ} />
      <LeadSection />
    </>
  );
}
