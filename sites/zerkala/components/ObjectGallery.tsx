"use client";

import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type Shot = { img: StaticImageData; alt: string; caption: string };

function Arrow({ dir, onClick, dark = false }: { dir: -1 | 1; onClick: () => void; dark?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "Предыдущее фото" : "Следующее фото"}
      className={`absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full shadow-md transition hover:scale-105 ${
        dir < 0 ? "left-3" : "right-3"
      } ${dark ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/90 text-ink"}`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d={dir < 0 ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// Галерея первого экрана страницы объекта: листается стрелками, миниатюрами, свайпом и
// клавишами; по нажатию на фото — просмотр во весь экран. Все кадры остаются в HTML,
// поэтому поисковик видит каждый с его alt.
export default function ObjectGallery({ photos, priority = true }: { photos: Shot[]; priority?: boolean }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const touch = useRef<number | null>(null);
  const n = photos.length;
  const go = useCallback((d: number) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [full, go]);

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => (touch.current = e.touches[0].clientX),
    onTouchEnd: (e: React.TouchEvent) => {
      if (touch.current === null) return;
      const dx = e.changedTouches[0].clientX - touch.current;
      touch.current = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    },
  };

  const p = photos[i];
  return (
    <div className="min-w-0">
      <div className="relative overflow-hidden rounded-3xl bg-card" {...swipe}>
        <button type="button" onClick={() => setFull(true)} className="block w-full cursor-zoom-in" aria-label="Открыть фото во весь экран">
          <div className="relative aspect-square sm:aspect-[4/5] lg:aspect-square">
            {photos.map((ph, k) => (
              <Image
                key={ph.img.src}
                src={ph.img}
                alt={ph.alt}
                fill
                priority={priority && k === 0}
                sizes="(max-width: 1024px) 100vw, 50vw"
                placeholder="blur"
                className={`object-cover transition-opacity duration-300 ${k === i ? "opacity-100" : "opacity-0"}`}
              />
            ))}
          </div>
        </button>
        {n > 1 && (
          <>
            <Arrow dir={-1} onClick={() => go(-1)} />
            <Arrow dir={1} onClick={() => go(1)} />
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink/70 px-3 py-1 text-sm font-semibold tabular-nums text-white">
              {i + 1} / {n}
            </div>
          </>
        )}
      </div>
      <p className="mt-3 min-h-[2.5rem] text-sm text-muted">{p.caption}</p>
      {n > 1 && (
        <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
          {photos.map((ph, k) => (
            <button
              key={ph.img.src}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Фото ${k + 1}: ${ph.caption}`}
              aria-current={k === i}
              className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                k === i ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <Image src={ph.img} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {full && (
        <div role="dialog" aria-modal="true" aria-label="Фото объекта" className="fixed inset-0 z-50 flex flex-col bg-black/95" {...swipe}>
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <span className="text-sm tabular-nums">
              {i + 1} / {n}
            </span>
            <button type="button" onClick={() => setFull(false)} className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25">
              Закрыть
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <Image src={p.img} alt={p.alt} fill sizes="100vw" className="object-contain" />
            {n > 1 && (
              <>
                <Arrow dir={-1} onClick={() => go(-1)} dark />
                <Arrow dir={1} onClick={() => go(1)} dark />
              </>
            )}
          </div>
          <p className="px-4 py-4 text-center text-sm text-white/80" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            {p.caption}
          </p>
        </div>
      )}
    </div>
  );
}
