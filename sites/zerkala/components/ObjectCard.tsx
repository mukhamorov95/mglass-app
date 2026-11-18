import Image from "next/image";
import Link from "next/link";
import type { SiteObject } from "@/content/objects";

// Одна карточка объекта на «Работах» и посадочных: ЖК, что сделали, две главные цифры.
export function ObjectCard({ o }: { o: SiteObject }) {
  return (
    <Link href={`/raboty/${o.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition hover:border-ink">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={o.photos[0].img}
          alt={o.photos[0].alt}
          fill
          sizes="(max-width: 640px) 100vw, 50vw"
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
          placeholder="blur"
        />
        <span className="absolute left-3 top-3 rounded-full bg-paper/90 px-3 py-1 text-xs font-semibold backdrop-blur">{o.card.label}</span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold leading-snug">{o.card.line}</h3>
        <dl className="mt-3 flex flex-wrap gap-2 text-sm">
          {o.highlights.slice(2, 4).map(([v, label]) => (
            <div key={label} className="rounded-full border border-line px-3 py-1">
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="font-semibold tabular-nums">{v}</span> <span className="text-muted">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
        <span className="mt-auto pt-4 text-sm font-semibold group-hover:text-brass">Смотреть объект →</span>
      </div>
    </Link>
  );
}

// Две карточки — две колонки; третья колонка появляется, только когда объектов три и больше.
export function objectGridClass(n: number) {
  return `grid gap-4 sm:grid-cols-2 ${n >= 3 ? "lg:grid-cols-3" : ""}`;
}
