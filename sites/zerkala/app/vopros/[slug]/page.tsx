import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Faq, LandingCard, LeadSection, SectionsView, TrustBar } from "@/components/blocks";
import { Breadcrumbs, ButtonLink, Container, JsonLd } from "@/components/ui";
import { getLanding } from "@/content/landings";
import { PHOTOS } from "@/content/photos";
import { QUESTIONS, getQuestion } from "@/content/questions";
import { breadcrumbSchema, faqSchema, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return QUESTIONS.map((q) => ({ slug: q.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const q = getQuestion(slug);
  if (!q) return {};
  return pageMetadata({ path: `/vopros/${q.slug}`, title: q.title, description: q.description, image: PHOTOS[q.photo].img });
}

export default async function QuestionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const q = getQuestion(slug);
  if (!q) notFound();

  const path = `/vopros/${q.slug}`;
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: "Вопросы", path: "/vopros" },
    { name: q.h1, path },
  ];
  const photo = PHOTOS[q.photo];
  const related = q.related.map(getLanding).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const others = QUESTIONS.filter((x) => x.slug !== q.slug).slice(0, 6);

  return (
    <>
      <JsonLd data={[breadcrumbSchema(crumbs), faqSchema([{ q: q.h1, a: q.answer }, ...q.faq])]} />
      <Container>
        <Breadcrumbs items={crumbs} />
      </Container>

      <section className="pb-8 pt-6 sm:pb-10">
        <Container className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brass">Вопрос — ответ</div>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{q.h1}</h1>
            <p className="mt-5 rounded-2xl border border-line bg-card p-5 text-lg leading-relaxed">{q.answer}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="#zayavka">Рассчитать стоимость</ButtonLink>
              <ButtonLink href={SITE.phone.href} variant="light">
                {SITE.phone.display}
              </ButtonLink>
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl lg:aspect-[4/5]">
            <Image src={photo.img} alt={photo.alt} fill priority sizes="(max-width: 1024px) 100vw, 42vw" className="object-cover" placeholder="blur" />
          </div>
        </Container>
      </section>

      <section className="pb-4">
        <Container>
          <TrustBar />
        </Container>
      </section>

      <SectionsView sections={q.sections} />

      <Faq items={q.faq} title="Ещё по этому вопросу" />

      {related.length > 0 && (
        <section className="py-10 sm:py-14">
          <Container>
            <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">Что мы делаем по этой теме</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.slice(0, 6).map((r) => (
                <LandingCard key={r.slug} l={r} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="pb-4">
        <Container>
          <div className="text-sm font-semibold text-muted">Другие вопросы:</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((o) => (
              <Link key={o.slug} href={`/vopros/${o.slug}`} className="rounded-full border border-line bg-card px-4 py-2 text-sm hover:border-ink">
                {o.navLabel}
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <LeadSection product={q.h1} />
    </>
  );
}
