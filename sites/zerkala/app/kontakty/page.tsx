import Link from "next/link";
import { LeadSection } from "@/components/blocks";
import { Breadcrumbs, Container, JsonLd } from "@/components/ui";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

const TITLE = "Контакты — зеркала на заказ в Москве | M-Glass";
const DESCRIPTION = `Телефон для расчёта и заказа зеркал по вашим размерам: ${SITE.phone.display}. Замер, изготовление и монтаж — ${SITE.serviceArea}.`;

export const metadata = pageMetadata({ path: "/kontakty", title: TITLE, description: DESCRIPTION });

export default function ContactsPage() {
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: "Контакты", path: "/kontakty" },
  ];
  return (
    <>
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <Container>
        <Breadcrumbs items={crumbs} />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">Контакты</h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-line bg-card p-6">
            <div className="text-sm text-muted">Телефон</div>
            <a href={SITE.phone.href} className="mt-1 block text-2xl font-semibold">
              {SITE.phone.display}
            </a>
          </div>
          <div className="rounded-2xl border border-line bg-card p-6">
            <div className="text-sm text-muted">Где работаем</div>
            <div className="mt-1 text-lg font-semibold">{SITE.serviceArea}</div>
            <p className="mt-2 text-sm text-muted">Замер, изготовление, доставка и монтаж зеркал.</p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-6">
            <div className="text-sm text-muted">Компания</div>
            <div className="mt-1 text-lg font-semibold">{SITE.brand}</div>
            <p className="mt-2 text-sm text-muted">
              {SITE.legalName}
              <br />
              ИНН {SITE.inn}, ОГРНИП {SITE.ogrnip}
              <br />
              Работаем с {SITE.foundedYear} года, {SITE.projects} проектов.
            </p>
          </div>
        </div>
        <p className="mt-8 max-w-2xl text-muted">
          Чтобы посчитать зеркало быстрее, пришлите ширину и высоту, фото стены и то, какую подсветку хотите. Не знаете, что выбрать,
          — начните с разделов{" "}
          <Link href="/zerkala-s-podsvetkoj" className="underline hover:text-ink">зеркала с подсветкой</Link> и{" "}
          <Link href="/zerkala-v-vannuyu" className="underline hover:text-ink">зеркала в ванную</Link>.
        </p>
      </Container>
      <LeadSection />
    </>
  );
}
