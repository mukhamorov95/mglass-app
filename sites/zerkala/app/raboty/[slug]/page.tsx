import Image from "next/image";
import { notFound } from "next/navigation";
import { Faq, LandingCard, LeadSection, Table } from "@/components/blocks";
import ObjectGallery from "@/components/ObjectGallery";
import { Breadcrumbs, ButtonLink, Container, JsonLd } from "@/components/ui";
import { getLanding } from "@/content/landings";
import { OBJECTS, getObject, type ObjPhoto } from "@/content/objects";
import { breadcrumbSchema, faqSchema, pageMetadata } from "@/lib/seo";
import { SITE, abs } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return OBJECTS.map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = getObject(slug);
  if (!o) return {};
  return pageMetadata({ path: `/raboty/${o.slug}`, title: o.title, description: o.description, image: o.photos[0].img });
}

function Figure({ p, sizes }: { p: ObjPhoto; sizes: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl bg-card">
      <Image src={p.img} alt={p.alt} sizes={sizes} className="h-auto w-full" placeholder="blur" />
      <figcaption className="px-4 py-3 text-sm text-muted">{p.caption}</figcaption>
    </figure>
  );
}

export default async function ObjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = getObject(slug);
  if (!o) notFound();

  const path = `/raboty/${o.slug}`;
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: "Наши работы", path: "/raboty" },
    { name: o.h1, path },
  ];
  const related = o.related.map(getLanding).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: o.h1,
    description: o.description,
    datePublished: o.published,
    inLanguage: "ru-RU",
    mainEntityOfPage: abs(path),
    image: o.photos.map((p) => abs(p.img.src)),
    author: { "@id": `${SITE.url}/#organization` },
    publisher: { "@id": `${SITE.url}/#organization` },
  };

  return (
    <>
      <JsonLd data={[breadcrumbSchema(crumbs), article, faqSchema(o.faq)]} />
      <Container>
        <Breadcrumbs items={crumbs} />
      </Container>

      <section className="pb-8 pt-4 sm:pb-12">
        <Container className="grid items-start gap-x-12 gap-y-5 lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:pt-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-brass">Наша работа · {o.place}</div>
            <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{o.h1}</h1>
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <ObjectGallery photos={o.photos} />
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-start-2">
            <dl className="grid grid-cols-2 gap-3">
              {o.highlights.map(([v, label]) => (
                <div key={label} className="rounded-2xl border border-line bg-card p-4">
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{v}</dd>
                  <dd className="mt-1 text-sm text-muted">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 leading-relaxed text-ink/85">{o.answer}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="#zayavka">Рассчитать своё зеркало</ButtonLink>
              <ButtonLink href={SITE.phone.href} variant="light">
                {SITE.phone.display}
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-6">
        <Container className="max-w-3xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Карточка объекта</h2>
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {o.facts.map(([k, v]) => (
              <div key={k} className="bg-paper p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
                <dd className="mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {o.drawing && (
        <section className="py-8 sm:py-10">
          <Container className="max-w-3xl">
            <h2 className="mb-4 text-2xl font-semibold tracking-tight">Чертежи объекта</h2>
            <p className="leading-relaxed text-ink/85">{o.drawing.text}</p>
            <a href={o.drawing.img.src} target="_blank" rel="noopener" className="mt-5 block overflow-hidden rounded-2xl border border-line bg-white">
              <Image src={o.drawing.img} alt={o.drawing.alt} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" />
            </a>
            <p className="mt-2 text-sm text-muted">Нажмите на чертёж, чтобы открыть его в полном размере.</p>
          </Container>
        </section>
      )}

      {o.sections.map((s) => (
        <section key={s.h2} className="py-8 sm:py-10">
          <Container className="max-w-3xl">
            <h2 className="mb-4 text-2xl font-semibold tracking-tight">{s.h2}</h2>
            {s.paras && (
              <div className="prose-site leading-relaxed text-ink/85">
                {s.paras.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            )}
            {s.table && (
              <div className="mt-5">
                <Table head={s.table.head} rows={s.table.rows} />
              </div>
            )}
            {s.list && (
              <ul className="mt-5 space-y-2.5">
                {s.list.map((li) => (
                  <li key={li} className="flex gap-3 leading-relaxed">
                    <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />
                    {li}
                  </li>
                ))}
              </ul>
            )}
            {s.photos && (
              <div className={`mt-6 grid gap-4 ${s.photos.length > 1 ? "sm:grid-cols-2" : "max-w-md"}`}>
                {s.photos.map((p) => (
                  <Figure key={p.alt} p={p} sizes="(max-width: 640px) 100vw, 384px" />
                ))}
              </div>
            )}
            {s.note && (
              <p className="mt-5 font-semibold">
                {s.note.text}{" "}
                <a href={s.note.href} className="underline hover:text-brass">
                  {s.note.label}
                </a>
              </p>
            )}
          </Container>
        </section>
      ))}

      <Faq items={o.faq} />

      {related.length > 0 && (
        <section className="py-10 sm:py-14">
          <Container>
            <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">Что мы делаем по этой теме</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <LandingCard key={r.slug} l={r} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <LeadSection title="Хотите такие же зеркала?" product={o.h1} />
    </>
  );
}
