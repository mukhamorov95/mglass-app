import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { OBJECTS } from "@/content/objects";
import { PHOTOS, WORK_SECTIONS } from "@/content/photos";

function Ring({ img, alt }: { img: StaticImageData; alt: string }) {
  return (
    <span className="block rounded-full bg-gradient-to-tr from-brass via-brass-soft to-ink p-[3px] transition group-hover:rotate-6">
      <span className="block rounded-full bg-paper p-[2px]">
        <span className="relative block h-[68px] w-[68px] overflow-hidden rounded-full sm:h-[76px] sm:w-[76px]">
          <Image src={img} alt={alt} fill sizes="80px" className="object-cover transition duration-500 group-hover:scale-110" />
        </span>
      </span>
    </span>
  );
}

// Первый экран главной: свежие объекты кружками, как истории, и вход во все работы.
export function WorksStrip() {
  const objects = [...OBJECTS].sort((a, b) => b.published.localeCompare(a.published));
  const total = WORK_SECTIONS.reduce((n, s) => n + s.photos.length, 0);
  return (
    <div className="mt-9">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">Наши работы — с размерами и ценами</div>
      <div className="mt-3 flex gap-4 overflow-x-auto pb-1">
        {objects.map((o, k) => (
          <Link key={o.slug} href={`/raboty/${o.slug}`} className="group relative w-[84px] shrink-0 text-center sm:w-[92px]" title={o.card.line}>
            <Ring img={o.photos[0].img} alt={o.photos[0].alt} />
            {k === 0 && (
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-brass px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                новое
              </span>
            )}
            <span className="mt-1.5 block text-xs font-semibold leading-tight">{o.card.label}</span>
          </Link>
        ))}
        <Link href="/raboty" className="group w-[84px] shrink-0 text-center sm:w-[92px]">
          <Ring img={PHOTOS.archesAuraDouble.img} alt={PHOTOS.archesAuraDouble.alt} />
          <span className="mt-1.5 block text-xs font-semibold leading-tight">
            Все работы <span className="text-muted">· {total} фото</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
