import type { PhotoKey } from "./photos";

export type ClusterKey = "ispolnenie" | "pomeshchenie" | "forma" | "biznes" | "uslugi";

export const CLUSTERS: Record<ClusterKey, { title: string; short: string }> = {
  ispolnenie: { title: "Исполнение", short: "По исполнению" },
  pomeshchenie: { title: "Для помещения", short: "По помещению" },
  forma: { title: "Форма", short: "По форме" },
  biznes: { title: "Для бизнеса", short: "Для бизнеса" },
  uslugi: { title: "Услуги", short: "Услуги" },
};

export type Section = {
  h2: string;
  paras?: string[];
  list?: string[];
  table?: { head: string[]; rows: string[][] };
};

// Общие блоки знаний — одинаковы на всех страницах, где уместны.
export type BlockKey = "lightModes" | "materials" | "frames" | "steps" | "priceFactors";

export type Landing = {
  slug: string;
  cluster: ClusterKey;
  navLabel: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  photo: PhotoKey;
  intro: string[];
  highlights: { title: string; text: string }[];
  sections: Section[];
  blocks: BlockKey[];
  gallery: PhotoKey[];
  faq: { q: string; a: string }[];
  related: string[];
  serviceType: string;
};
