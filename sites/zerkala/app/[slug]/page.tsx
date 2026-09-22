import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOCKS, Faq, Gallery, Highlights, LandingCard, LeadSection, SectionsView, TrustBar } from "@/components/blocks";
import { Breadcrumbs, ButtonLink, Container, JsonLd } from "@/components/ui";
import { LANDINGS, getLanding } from "@/content/landings";
import { PHOTOS } from "@/content/photos";
import { questionsForLanding } from "@/content/questions";
import { CLUSTERS } from "@/content/types";
import { breadcrumbSchema, faqSchema, pageMetadata, serviceSchema } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANDINGS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const l = getLanding(slug);
  if (!l) return {};
  return pageMetadata({ path: `/${l.slug}`, title: l.title, description: l.description, image: PHOTOS[l.photo].img });
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const l = getLanding(slug);
  if (!l) notFound();

  const path = `/${l.slug}`;
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: l.h1, path },
  ];
  const photo = PHOTOS[l.photo];
  const related = l.related.map(getLanding).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const siblings = LANDINGS.filter((x) => x.cluster === l.cluster && x.slug !== l.slug);
  const questions = questionsForLanding(l.slug);

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({ name: l.h1, serviceType: l.serviceType, description: l.description, path, image: photo.img.src }),
          breadcrumbSchema(crumbs),
          faqSchema(l.faq),
        ]}
      />
      <Container>
        <Breadcrumbs items={crumbs} />
      </Container>

      <section className="pb-10 pt-6 sm:pb-14">
        <Container className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brass">{CLUSTERS[l.cluster].title}</div>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{l.h1}</h1>
            <p className="mt-4 text-lg text-muted">{l.lead}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="#zayavka">Рассчитать стоимость</ButtonLink>
              <ButtonLink href={SITE.phone.href} variant="light">
                {SITE.phone.display}
              </ButtonLink>
            </div>
          </div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl sm:aspect-[4/3] lg:aspect-[4/5]">
            <Image src={photo.img} alt={photo.alt} fill priority sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" placeholder="blur" />
          </div>
        </Container>
      </section>

      <section className="pb-6">
        <Container className="grid gap-3">
          <TrustBar />
          <Highlights items={l.highlights} />
        </Container>
      </section>

      <section className="py-8 sm:py-10">
        <Container className="max-w-3xl">
          <div className="prose-site text-lg leading-relaxed text-ink/85">
            {l.intro.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Container>
      </section>

      <SectionsView sections={l.sections} />

      {l.blocks.map((b) => {
        const Block = BLOCKS[b];
        return <Block key={b} />;
      })}

      <Gallery keys={l.gallery} />
      <Faq items={l.faq} />

      {questions.length > 0 && (
        <section className="pb-4">
          <Container className="max-w-3xl">
            <h2 className="mb-4 text-xl font-semibold tracking-tight">Разбираем подробно</h2>
            <div className="divide-y divide-line rounded-2xl border border-line bg-card">
              {questions.map((q) => (
                <Link key={q.slug} href={`/vopros/${q.slug}`} className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-paper">
                  <span className="font-semibold">{q.h1}</span>
                  <span aria-hidden="true" className="mt-0.5 text-brass">→</span>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      {related.length > 0 && (
        <section className="py-12 sm:py-16">
          <Container>
            <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:mb-8 sm:text-3xl">Смотрите также</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.slice(0, 6).map((r) => (
                <LandingCard key={r.slug} l={r} />
              ))}
            </div>
          </Container>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="pb-4">
          <Container>
            <div className="text-sm font-semibold text-muted">{CLUSTERS[l.cluster].short}:</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {siblings.map((s) => (
                <Link key={s.slug} href={`/${s.slug}`} className="rounded-full border border-line bg-card px-4 py-2 text-sm hover:border-ink">
                  {s.h1}
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      <LeadSection product={l.h1} />
    </>
  );
}
