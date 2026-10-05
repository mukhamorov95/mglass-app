import Image from "next/image";
import Link from "next/link";
import { LeadSection } from "@/components/blocks";
import { Breadcrumbs, Container, JsonLd } from "@/components/ui";
import { PHOTOS, WORK_SECTIONS, type Photo } from "@/content/photos";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";

const TITLE = "Наши работы — фото зеркал с объектов в Москве и МО | M-Glass";
const DESCRIPTION =
  "Фото зеркал, которые мы изготовили и установили: с подсветкой-аурой и фронтальным светом, круглые, арочные, в металлической раме, зеркальные стены и панно с фацетом, зеркала для салонов красоты.";

export const metadata = pageMetadata({ path: "/raboty", title: TITLE, description: DESCRIPTION, image: PHOTOS.archesAuraDouble.img });

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function monthLabel(month?: string): string | null {
  if (!month) return null;
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export default function WorksPage() {
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: "Наши работы", path: "/raboty" },
  ];
  return (
    <>
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <Container>
        <Breadcrumbs items={crumbs} />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">Наши работы</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Зеркала, которые мы сделали по размерам клиентов и установили на объектах: подсветка за зеркалом и на лицо,
          металлические рамы, фигурные формы, зеркальные стены и панно. Фото — с объектов после монтажа.
        </p>
        <nav aria-label="Разделы" className="mt-6 flex flex-wrap gap-2">
          {WORK_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink">
              {s.title} · {s.photos.length}
            </a>
          ))}
        </nav>
        {WORK_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24 pt-12">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{s.title}</h2>
            <p className="mt-2 max-w-3xl text-muted">{s.text}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
              {s.links.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-brass">
                  {l.label} →
                </Link>
              ))}
            </p>
            <div className="mt-6 columns-1 gap-4 sm:columns-2 lg:columns-3">
              {s.photos.map((k) => {
                const p: Photo = PHOTOS[k];
                const when = monthLabel(p.month);
                return (
                  <figure key={k} className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-card">
                    <Image src={p.img} alt={p.alt} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="h-auto w-full" placeholder="blur" />
                    <figcaption className="px-4 py-3 text-sm text-muted">
                      {p.caption}
                      {when && <span className="block text-xs">Фото с объекта, {when}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        ))}
      </Container>
      <LeadSection title="Хотите такое же зеркало?" />
    </>
  );
}
