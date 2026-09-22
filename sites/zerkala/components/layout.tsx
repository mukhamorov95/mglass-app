import Link from "next/link";
import { landingsByCluster } from "@/content/landings";
import { SITE } from "@/lib/site";
import { MenuCloser } from "./MenuCloser";
import { Container } from "./ui";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${SITE.brand} — зеркала на заказ, на главную`}>
      <span aria-hidden="true" className="relative block h-8 w-6 rounded-full border-2 border-ink">
        <span className="absolute inset-1 rounded-full bg-gradient-to-br from-white via-brass-soft to-brass/40" />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-tight">{SITE.brand}</span>
        <span className="block text-[11px] text-muted">зеркала на заказ</span>
      </span>
    </Link>
  );
}

export function Header() {
  const clusters = landingsByCluster();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <MenuCloser />
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Основное меню" className="hidden items-center gap-6 text-sm font-medium md:flex">
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-brass">
              Каталог
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="transition-transform group-open:rotate-180">
                <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </summary>
            <div className="absolute left-1/2 top-9 grid w-[640px] -translate-x-1/2 grid-cols-3 gap-6 rounded-2xl border border-line bg-card p-6 shadow-xl">
              {clusters.map((c) => (
                <div key={c.key}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c.title}</div>
                  <ul className="space-y-1.5">
                    {c.items.map((l) => (
                      <li key={l.slug}>
                        <Link href={`/${l.slug}`} className="hover:text-brass">
                          {l.navLabel}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
          <Link href="/zerkala-s-podsvetkoj" className="hover:text-brass">С подсветкой</Link>
          <Link href="/zerkala-v-vannuyu" className="hover:text-brass">В ванную</Link>
          <Link href="/vopros" className="hover:text-brass">Вопросы</Link>
          <Link href="/raboty" className="hover:text-brass">Работы</Link>
          <Link href="/kontakty" className="hover:text-brass">Контакты</Link>
        </nav>
        <div className="flex items-center gap-3">
          <a href={SITE.phone.href} className="hidden text-sm font-semibold lg:block">
            {SITE.phone.display}
          </a>
          <a href="#zayavka" className="hidden min-h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white hover:bg-black sm:inline-flex">
            Рассчитать
          </a>
          <details className="group md:hidden">
            <summary aria-label="Открыть меню" className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-line">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
                <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </summary>
            <div className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-line bg-paper px-4 pb-8 pt-4 shadow-lg">
              {clusters.map((c) => (
                <div key={c.key} className="border-b border-line py-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {c.items.map((l) => (
                      <Link key={l.slug} href={`/${l.slug}`} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm">
                        {l.navLabel}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-3 pt-4 text-base font-medium">
                <Link href="/vopros">Вопросы</Link>
                <Link href="/raboty">Наши работы</Link>
                <Link href="/kontakty">Контакты</Link>
                <a href={SITE.phone.href} className="font-semibold">{SITE.phone.display}</a>
              </div>
            </div>
          </details>
        </div>
      </Container>
    </header>
  );
}

export function Footer() {
  const clusters = landingsByCluster();
  const year = new Date(SITE.contentUpdated).getFullYear();
  return (
    <footer className="mt-20 border-t border-line bg-card pb-20 md:pb-0">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-4 text-sm text-muted">
            Зеркала на заказ по вашим размерам. {SITE.serviceArea}; {SITE.shipping.toLowerCase()}.
          </p>
          <a href={SITE.phone.href} className="mt-4 block text-lg font-semibold">
            {SITE.phone.display}
          </a>
          <p className="mt-2 text-sm text-muted">{SITE.address.full}</p>
        </div>
        {clusters.slice(0, 3).map((c) => (
          <div key={c.key}>
            <div className="mb-3 text-sm font-semibold">{c.title}</div>
            <ul className="space-y-2 text-sm text-muted">
              {c.items.map((l) => (
                <li key={l.slug}>
                  <Link href={`/${l.slug}`} className="hover:text-ink">{l.h1}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="flex flex-col gap-3 border-t border-line py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <div>
          © {SITE.foundedYear}–{year} {SITE.brand}. {SITE.legalName}, ИНН {SITE.inn}, ОГРНИП {SITE.ogrnip}
        </div>
        <div className="flex flex-wrap gap-4">
          {clusters.slice(3).flatMap((c) => c.items).map((l) => (
            <Link key={l.slug} href={`/${l.slug}`} className="hover:text-ink">{l.navLabel}</Link>
          ))}
          <Link href="/vopros" className="hover:text-ink">Вопросы</Link>
          <Link href="/raboty" className="hover:text-ink">Работы</Link>
          <Link href="/kontakty" className="hover:text-ink">Контакты</Link>
          <Link href="/politika-konfidencialnosti" className="hover:text-ink">Политика конфиденциальности</Link>
        </div>
      </Container>
    </footer>
  );
}

export function MobileActionBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t border-line bg-paper/95 p-3 backdrop-blur md:hidden">
      <a href={SITE.phone.href} className="flex min-h-12 items-center justify-center rounded-full border border-line bg-card text-sm font-semibold">
        Позвонить
      </a>
      <a href="#zayavka" className="flex min-h-12 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
        Рассчитать
      </a>
    </div>
  );
}
