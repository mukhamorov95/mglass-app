"use client";

import { useEffect, useRef, useState } from "react";

type Queue = { f?: unknown[]; params?: unknown[]; setMeta?: (p: unknown) => void };

// Родная форма amoCRM: скрипт вставляет форму рядом с тегом script#amoforms_script_<id>.
// При переходе между страницами блок монтируется заново — тег пересоздаём, иначе форма
// осталась бы только на первой открытой странице.
export function AmoForm({ id, hash, src, phone }: { id: string; hash: string; src: string; phone: { display: string; href: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.innerHTML = "";
    const w = window as unknown as Record<string, Queue & ((...a: unknown[]) => void)>;
    const params = "amo_forms_params";
    const load = "amo_forms_load";
    const loaded = "amo_forms_loaded";
    w[params] = w[params] || {
      setMeta(p: unknown) {
        this.params = (this.params || []).concat([p]);
      },
    };
    w[load] =
      w[load] ||
      Object.assign(
        function (f: unknown) {
          w[load].f = (w[load].f || []).concat([f]);
        },
        { f: [] as unknown[] },
      );
    w[load]({ id, hash, locale: "ru" });
    w[loaded] =
      w[loaded] ||
      Object.assign(
        function (f: unknown, k: unknown) {
          w[loaded].f = (w[loaded].f || []).concat([[f, k]]);
        },
        { f: [] as unknown[] },
      );

    const s = document.createElement("script");
    s.id = `amoforms_script_${id}`;
    s.async = true;
    s.charset = "utf-8";
    s.src = src;
    s.onerror = () => setFailed(true);
    box.appendChild(s);
    return () => {
      box.innerHTML = "";
    };
  }, [id, hash, src]);

  return (
    <div>
      <div ref={ref} className="amo-form min-h-[320px]" />
      {failed && (
        <p role="alert" className="text-sm">
          Форма не загрузилась. Позвоните нам:{" "}
          <a href={phone.href} className="font-semibold underline">
            {phone.display}
          </a>
        </p>
      )}
    </div>
  );
}
