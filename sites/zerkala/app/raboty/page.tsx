import Image from "next/image";
import { LeadSection } from "@/components/blocks";
import { Breadcrumbs, Container, JsonLd } from "@/components/ui";
import { GALLERY_ORDER, PHOTOS } from "@/content/photos";
import { breadcrumbSchema, pageMetadata } from "@/lib/seo";

const TITLE = "Наши работы — зеркала на заказ, фото объектов | M-Glass";
const DESCRIPTION =
  "Фото зеркал, которые мы изготовили и установили: с подсветкой-аурой и фронтальным светом, в металлической раме, круглые, овальные, арочные, в полный рост.";

export const metadata = pageMetadata({ path: "/raboty", title: TITLE, description: DESCRIPTION, image: PHOTOS.archAura.img });

export default function WorksPage() {
  const crumbs = [
    { name: "Зеркала на заказ", path: "/" },
    { name: "Наши работы", path: "/raboty" },
  ];
  return (
    <>
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <Container>
        <Breadcrumbs items={crumbs} />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">Наши работы</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Зеркала, которые мы сделали по размерам клиентов: подсветка за зеркалом и на лицо, металлические рамы, фигурные формы и
          зеркальные стены.
        </p>
        <div className="mt-10 columns-1 gap-4 sm:columns-2 lg:columns-3">
          {GALLERY_ORDER.map((k) => (
            <figure key={k} className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-card">
              <Image src={PHOTOS[k].img} alt={PHOTOS[k].alt} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="h-auto w-full" placeholder="blur" />
              <figcaption className="px-4 py-3 text-sm text-muted">{PHOTOS[k].caption}</figcaption>
            </figure>
          ))}
        </div>
      </Container>
      <LeadSection title="Хотите такое же зеркало?" />
    </>
  );
}
