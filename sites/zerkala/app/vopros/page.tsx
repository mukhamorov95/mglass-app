import Image from "next/image";
import Link from "next/link";
import { LeadSection, TrustBar } from "@/components/blocks";
import { Breadcrumbs, Container, JsonLd } from "@/components/ui";
import { PHOTOS } from "@/content/photos";
import { QUESTIONS } from "@/content/questions";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";
import { abs } from "@/lib/site";

const TITLE = "Вопросы о зеркалах на заказ — ответы мастерской | M-Glass";
const DESCRIPTION =
  "Отвечаем на вопросы о зеркалах на заказ: как выбрать размер и подсветку, какая нужна толщина, как крепится зеркало, как проходит замер, из чего складывается цена.";

export const metadata = pageMetadata({ path: "/vopros", title: TITLE, description: DESCRIPTION });

const crumbs = [
  { name: "Зеркала на заказ", path: "/" },
  { name: "Вопросы", path: "/vopros" },
];

export default function QuestionsHub() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema(crumbs),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Вопросы о зеркалах на заказ",
            itemListElement: QUESTIONS.map((q, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: q.h1,
              url: abs(`/vopros/${q.slug}`),
            })),
          },
        ]}
      />
      <Container>
        <Breadcrumbs items={crumbs} />
      </Container>

      <section className="pb-8 pt-6">
        <Container className="max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">Вопросы о зеркалах на заказ</h1>
          <p className="mt-4 text-lg text-muted">
            То, что чаще всего спрашивают до заказа: размер и подсветка, толщина полотна, крепление, замер, сроки и цена.
            Отвечаем по-честному — так, как объясняем на замере.
          </p>
        </Container>
      </section>

      <section className="pb-6">
        <Container>
          <TrustBar />
        </Container>
      </section>

      <section className="py-8 sm:py-10">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUESTIONS.map((q) => {
              const photo = PHOTOS[q.photo];
              return (
                <Link
                  key={q.slug}
                  href={`/vopros/${q.slug}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg"
                >
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <Image
                      src={photo.img}
                      alt={photo.alt}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="text-lg font-semibold group-hover:text-brass">{q.h1}</h2>
                    <p className="mt-1.5 flex-1 text-sm text-muted">{q.answer.slice(0, 130)}…</p>
                    <span className="mt-4 text-sm font-semibold">Читать ответ →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      <LeadSection />
    </>
  );
}
