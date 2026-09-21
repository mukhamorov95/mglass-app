import Link from "next/link";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-6 max-w-3xl sm:mb-8">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{children}</h2>
      {sub && <p className="mt-2 text-muted">{sub}</p>}
    </div>
  );
}

export function JsonLd({ data }: { data: object | object[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, "\\u003c") }} />
      ))}
    </>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Навигационная цепочка" className="pt-5 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.path} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {i < items.length - 1 ? (
              <Link href={item.path} className="hover:text-ink">
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ButtonLink({ href, children, variant = "dark" }: { href: string; children: React.ReactNode; variant?: "dark" | "light" }) {
  const cls =
    variant === "dark"
      ? "bg-ink text-white hover:bg-black"
      : "border border-line bg-card text-ink hover:border-ink";
  return (
    <a href={href} className={`inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm font-semibold transition-colors ${cls}`}>
      {children}
    </a>
  );
}
