import Image from "next/image";
import Link from "next/link";
import { FRAMES, LIGHT_MODES, LIGHT_TECH, MATERIALS, PRICE_FACTORS, STEPS } from "@/content/knowledge";
import { PHOTOS, type PhotoKey } from "@/content/photos";
import type { BlockKey, Landing, Section } from "@/content/types";
import { SITE } from "@/lib/site";
import { LeadForm } from "./LeadForm";
import { Container, SectionTitle } from "./ui";

export function LightModes() {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <SectionTitle sub="Тип света выбираем первым: он меняет состав зеркала, а не одну строку в расчёте">
          Три вида подсветки
        </SectionTitle>
        <div className="grid gap-5 md:grid-cols-3">
          {LIGHT_MODES.map((m) => (
            <article key={m.key} className="overflow-hidden rounded-2xl border border-line bg-card">
              <div className="relative aspect-[4/3]">
                <Image src={PHOTOS[m.photo].img} alt={PHOTOS[m.photo].alt} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{m.text}</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {m.parts.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden="true" className="text-brass">—</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
        <ul className="mt-6 grid gap-2 rounded-2xl bg-brass-soft p-5 text-sm sm:grid-cols-2">
          {LIGHT_TECH.map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden="true">✓</span>
              {t}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-paper text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-4 py-3 font-semibold">
                    {c}
                  </th>
                ) : (
                  <td key={j} className="px-4 py-3 text-muted">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Materials() {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <SectionTitle sub="Все виды режем по вашим размерам, обрабатываем кромку, ставим в раму и подсвечиваем">
          Какие зеркала делаем
        </SectionTitle>
        <Table head={["Зеркало", "Толщина", "Особенность"]} rows={MATERIALS.map((m) => [m.name, m.thickness, m.text])} />
      </Container>
    </section>
  );
}

export function Frames() {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <SectionTitle>Рама и кромка</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FRAMES.map((f) => (
            <div key={f.name} className="rounded-2xl border border-line bg-card p-5">
              <h3 className="font-semibold">{f.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function Steps() {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <SectionTitle>Как заказать зеркало</SectionTitle>
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-card p-5">
              <div className="text-sm font-semibold text-brass">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

export function PriceFactors() {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <SectionTitle sub="Пришлите размеры и исполнение — посчитаем стоимость по вашему зеркалу, а не по каталогу">
          Из чего складывается цена
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRICE_FACTORS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-line bg-card p-5">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

export const BLOCKS: Record<BlockKey, () => React.ReactElement> = {
  lightModes: LightModes,
  materials: Materials,
  frames: Frames,
  steps: Steps,
  priceFactors: PriceFactors,
};

export function Gallery({ keys, title = "Наши работы" }: { keys: PhotoKey[]; title?: string }) {
  return (
    <section className="py-12 sm:py-16">
      <Container>
        <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
          <Link href="/raboty" className="shrink-0 text-sm font-semibold hover:text-brass">
            Все работы →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {keys.map((k) => (
            <figure key={k} className="overflow-hidden rounded-2xl bg-card">
              <div className="relative aspect-[3/4]">
                <Image src={PHOTOS[k].img} alt={PHOTOS[k].alt} fill sizes="(max-width: 1024px) 50vw, 33vw" className="object-cover" placeholder="blur" />
              </div>
              <figcaption className="px-3 py-2.5 text-xs text-muted sm:text-sm">{PHOTOS[k].caption}</figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function Faq({ items, title = "Частые вопросы" }: { items: { q: string; a: string }[]; title?: string }) {
  return (
    <section className="py-12 sm:py-16">
      <Container className="max-w-3xl">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <div className="divide-y divide-line rounded-2xl border border-line bg-card">
          {items.map((i) => (
            <details key={i.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-semibold">
                <h3 className="text-base">{i.q}</h3>
                <span aria-hidden="true" className="mt-0.5 text-xl leading-none text-brass transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{i.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function SectionsView({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((s) => (
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
            {s.list && (
              <ul className="mt-2 space-y-2.5">
                {s.list.map((li) => (
                  <li key={li} className="flex gap-3 leading-relaxed">
                    <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />
                    {li}
                  </li>
                ))}
              </ul>
            )}
            {s.table && (
              <div className="mt-5">
                <Table head={s.table.head} rows={s.table.rows} />
              </div>
            )}
          </Container>
        </section>
      ))}
    </>
  );
}

export function Highlights({ items }: { items: Landing["highlights"] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((h) => (
        <li key={h.title} className="rounded-2xl border border-line bg-card p-4">
          <div className="font-semibold">{h.title}</div>
          <div className="mt-1 text-sm text-muted">{h.text}</div>
        </li>
      ))}
    </ul>
  );
}

export function LandingCard({ l }: { l: Landing }) {
  const photo = PHOTOS[l.photo];
  return (
    <Link href={`/${l.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image src={photo.img} alt={photo.alt} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold group-hover:text-brass">{l.h1}</h3>
        <p className="mt-1.5 flex-1 text-sm text-muted">{l.lead}</p>
        <span className="mt-4 text-sm font-semibold">Подробнее →</span>
      </div>
    </Link>
  );
}

export function LeadSection({ title = "Рассчитаем зеркало по вашим размерам", product }: { title?: string; product?: string }) {
  return (
    <section id="zayavka" className="scroll-mt-20 py-12 sm:py-16">
      <Container>
        <div className="grid gap-8 rounded-3xl bg-ink p-6 text-white sm:p-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
            <p className="mt-3 text-white/70">
              Оставьте телефон и, если знаете, размеры. Перезвоним, уточним исполнение и пришлём стоимость.
            </p>
            <p className="mt-6 text-sm text-white/70">Или позвоните:</p>
            <a href={SITE.phone.href} className="text-2xl font-semibold">
              {SITE.phone.display}
            </a>
          </div>
          <div className="rounded-2xl bg-paper p-5 text-ink sm:p-6">
            <LeadForm endpoint={SITE.leadEndpoint} phone={SITE.phone} metrikaId={SITE.metrikaId} product={product} />
          </div>
        </div>
      </Container>
    </section>
  );
}
