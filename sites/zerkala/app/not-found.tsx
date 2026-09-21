import Link from "next/link";
import { Container } from "@/components/ui";
import { LANDINGS } from "@/content/landings";

export default function NotFound() {
  return (
    <Container className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">Такой страницы нет</h1>
      <p className="mt-3 text-muted">Возможно, она переехала. Начните с главной или выберите раздел:</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Все зеркала</Link>
        {LANDINGS.slice(0, 8).map((l) => (
          <Link key={l.slug} href={`/${l.slug}`} className="rounded-full border border-line bg-card px-4 py-2 text-sm">
            {l.navLabel}
          </Link>
        ))}
      </div>
    </Container>
  );
}
