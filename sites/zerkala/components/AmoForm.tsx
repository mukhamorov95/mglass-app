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
    // Скрипт может загрузиться, но формы не нарисовать (медленная сеть, VPN, блокировщик) —
    // onerror тогда молчит, а посетитель видит пустую карточку. Проверяем, что окно формы появилось.
    const watchdog = window.setTimeout(() => {
      const frame = box.querySelector("iframe");
      if (!frame || frame.offsetHeight < 100) setFailed(true);
    }, 6000);
    return () => {
      window.clearTimeout(watchdog);
      box.innerHTML = "";
    };
  }, [id, hash, src]);

  return (
    <div>
      <div ref={ref} className={failed ? "amo-form" : "amo-form min-h-[320px]"} />
      {failed && (
        <div role="alert" className="flex min-h-[240px] flex-col items-start justify-center gap-4 py-6">
          <p className="text-base">Форма заявки не загрузилась. Позвоните — посчитаем по телефону:</p>
          <a href={phone.href} className="rounded-full bg-[#111] px-6 py-3 text-lg font-semibold text-white">
            {phone.display}
          </a>
          <button type="button" onClick={() => window.location.reload()} className="text-sm underline">
            Попробовать загрузить форму ещё раз
          </button>
        </div>
      )}
    </div>
  );
}
