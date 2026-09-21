"use client";

import Link from "next/link";
import { useState } from "react";

const UTM_KEY = "mz_utm";
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "yclid"] as const;

// Первое касание: метки запоминаются при входе и доходят до заявки, даже если
// человек полистал сайт перед тем, как её оставить.
export function captureUtm() {
  try {
    if (sessionStorage.getItem(UTM_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const k of UTM_FIELDS) {
      const v = params.get(k);
      if (v) found[k] = v.slice(0, 200);
    }
    if (Object.keys(found).length) sessionStorage.setItem(UTM_KEY, JSON.stringify(found));
  } catch {}
}

function readUtm(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_KEY) || "{}");
  } catch {
    return {};
  }
}

type State = "idle" | "sending" | "sent" | "error";

export function LeadForm({
  endpoint,
  phone,
  metrikaId,
  product,
}: {
  endpoint: string;
  phone: { display: string; href: string };
  metrikaId: string;
  product?: string;
}) {
  const [state, setState] = useState<State>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!endpoint) {
      setState("error");
      return;
    }
    setState("sending");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          phone: form.get("phone"),
          sizes: form.get("sizes"),
          comment: form.get("comment"),
          website: form.get("website"),
          consent: form.get("consent") === "on",
          product: product || "Зеркало",
          source: "site-zerkala",
          page: window.location.origin + window.location.pathname,
          title: document.title,
          referrer: document.referrer,
          utm: readUtm(),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      const ym = (window as unknown as { ym?: (...a: unknown[]) => void }).ym;
      if (metrikaId && ym) ym(Number(metrikaId), "reachGoal", "lead");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-line bg-card p-6">
        <div className="text-lg font-semibold">Заявка отправлена</div>
        <p className="mt-2 text-muted">Перезвоним, уточним детали и посчитаем зеркало по вашим размерам.</p>
      </div>
    );
  }

  const input = "w-full rounded-xl border border-line bg-card px-4 py-3 text-base outline-none transition-colors focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate={false}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span>Имя</span>
          <input name="name" autoComplete="name" maxLength={100} className={input} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span>
            Телефон <span className="text-brass">*</span>
          </span>
          <input name="phone" type="tel" autoComplete="tel" required minLength={10} maxLength={30} inputMode="tel" placeholder="+7" className={input} />
        </label>
      </div>
      <label className="grid gap-1.5 text-sm">
        <span>Размеры зеркала, если знаете</span>
        <input name="sizes" maxLength={200} placeholder="например, 800 × 600 мм" className={input} />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span>Что нужно</span>
        <textarea name="comment" rows={3} maxLength={1000} placeholder="Подсветка, форма, рама, куда вешать" className={input} />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input name="consent" type="checkbox" required className="mt-1 h-4 w-4 accent-[#141413]" />
        <span>
          Согласен на обработку персональных данных по{" "}
          <Link href="/politika-konfidencialnosti" className="underline hover:text-ink">
            политике конфиденциальности
          </Link>
        </span>
      </label>
      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-1 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-8 font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
      >
        {state === "sending" ? "Отправляем…" : "Получить расчёт"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-sm">
          Не получилось отправить заявку. Позвоните нам:{" "}
          <a href={phone.href} className="font-semibold underline">
            {phone.display}
          </a>
        </p>
      )}
    </form>
  );
}
