import { ISPOLNENIE } from "./landings-ispolnenie";
import { BIZNES, FORMA, POMESHCHENIE, USLUGI } from "./landings-other";
import { CLUSTERS, type ClusterKey, type Landing } from "./types";

export const LANDINGS: Landing[] = [...ISPOLNENIE, ...POMESHCHENIE, ...FORMA, ...BIZNES, ...USLUGI];

const BY_SLUG = new Map(LANDINGS.map((l) => [l.slug, l]));

export function getLanding(slug: string): Landing | undefined {
  return BY_SLUG.get(slug);
}

export function landingsByCluster(): { key: ClusterKey; title: string; items: Landing[] }[] {
  return (Object.keys(CLUSTERS) as ClusterKey[]).map((key) => ({
    key,
    title: CLUSTERS[key].title,
    items: LANDINGS.filter((l) => l.cluster === key),
  }));
}
