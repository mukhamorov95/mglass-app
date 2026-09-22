import { LeadSection, TrustBar, YandexReviews } from "@/components/blocks";
import { Breadcrumbs, ButtonLink, Container, JsonLd } from "@/components/ui";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

const TITLE = "Отзывы о M-Glass — зеркала на заказ в Москве | M-Glass";
const DESCRIPTION =
  "Отзывы клиентов M-Glass с карточки компании на Яндекс Картах: изготовление и установка зеркал на заказ в Москве и Московской области.";

export const metadata = pageMetadata({ path: "/otzyvy", title: TITLE, description: DESCRIPTION });

const crumbs = [
  { name: "Зеркала на заказ", path: "/" },
  { name: "Отзывы", path: "/otzyvy" },
];

export default function ReviewsPage() {
  return (
    <>
      <JsonLd data={[breadcrumbSchema(crumbs)]} />
      <Container>
        <Breadcrumbs items={crumbs} />
      </Container>

      <section className="pb-8 pt-6">
        <Container className="max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">Отзывы о нашей работе</h1>
          <p className="mt-4 text-lg text-muted">
            Отзывы приходят с карточки компании на Яндекс Картах: их пишут клиенты после замера и установки, а мы не можем их
            редактировать или удалять. Поэтому показываем как есть — прямо из Яндекса.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="#zayavka">Рассчитать стоимость</ButtonLink>
            <ButtonLink href={SITE.phone.href} variant="light">
              {SITE.phone.display}
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section className="pb-6">
        <Container>
          <TrustBar />
        </Container>
      </section>

      <section className="py-8 sm:py-10">
        <Container>
          <YandexReviews />
        </Container>
      </section>

      <LeadSection />
    </>
  );
}
