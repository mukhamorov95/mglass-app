// Ссылки с сайта зеркал на mglass.pro несут метки: в Метрике mglass.pro видно,
// с какой страницы и из какого места пришёл человек.
export function outbound(href: string, campaign: string, place: string) {
  const u = new URL(href);
  if (!u.hostname.endsWith("mglass.pro")) return href;
  u.searchParams.set("utm_source", "mglass-zerkala");
  u.searchParams.set("utm_medium", "referral");
  u.searchParams.set("utm_campaign", campaign);
  u.searchParams.set("utm_content", place);
  return u.toString();
}
