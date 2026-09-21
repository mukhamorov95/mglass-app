// Обход карты сайта на запущенном сервере: у каждой страницы 200, один h1,
// свои title/description, canonical, валидный JSON-LD, alt у картинок, живые
// внутренние ссылки. Запуск: npm run build && npm start, затем
//   node scripts/check-seo.mjs [http://localhost:3100]
// Код выхода 1, если нашлась хоть одна ошибка.

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const errors = [];
const warn = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

async function get(url) {
  const res = await fetch(url, { redirect: "manual" });
  return { status: res.status, body: await res.text() };
}

const sitemap = await get(`${base}/sitemap.xml`);
if (sitemap.status !== 200) {
  console.error(`sitemap.xml: ${sitemap.status}`);
  process.exit(1);
}
const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const paths = locs.map((u) => new URL(u).pathname);
const robots = await get(`${base}/robots.txt`);

const seen = { title: new Map(), description: new Map(), h1: new Map() };
const internalLinks = new Set();
const report = [];

for (const path of paths) {
  const { status, body } = await get(base + path);
  if (status !== 200) {
    err(path, `статус ${status}`);
    continue;
  }
  const title = decode(body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const description = decode(body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");
  const canonical = body.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? "";
  const robotsMeta = body.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "";
  const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]));
  const imgs = [...body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt="[^"]+"/.test(i));
  const ld = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const main = body.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
  const words = (text(main).match(/[А-Яа-яЁёA-Za-z]{2,}/g) || []).length;

  if (!title) err(path, "нет title");
  if (title.length > 90) warn.push(`${path}: title ${title.length} символов`);
  if (description.length < 70 || description.length > 220) err(path, `description ${description.length} символов`);
  if (h1s.length !== 1) err(path, `h1: ${h1s.length}`);
  if (!canonical) err(path, "нет canonical");
  else if (new URL(canonical).pathname !== path) err(path, `canonical ведёт на ${canonical}`);
  if (!robotsMeta) err(path, "нет meta robots");
  if (noAlt.length) err(path, `картинок без alt: ${noAlt.length}`);
  const types = [];
  for (const block of ld) {
    try {
      const obj = JSON.parse(block);
      types.push(obj["@type"]);
    } catch (e) {
      err(path, `JSON-LD не парсится: ${e.message}`);
    }
  }
  if (!types.includes("BreadcrumbList") && path !== "/politika-konfidencialnosti") err(path, "нет BreadcrumbList");

  for (const [k, v] of [["title", title], ["description", description], ["h1", h1s[0] ?? ""]]) {
    if (!v) continue;
    if (seen[k].has(v)) err(path, `${k} совпадает со страницей ${seen[k].get(v)}`);
    else seen[k].set(v, path);
  }
  for (const m of body.matchAll(/<a\b[^>]*href="(\/[^"#?]*)/g)) internalLinks.add(m[1] || "/");
  report.push({ path, words, h1: h1s[0], types: types.join(","), robots: robotsMeta });
}

for (const link of internalLinks) {
  const { status } = await get(base + link);
  if (status !== 200) err(link, `внутренняя ссылка отдаёт ${status}`);
}
const orphans = paths.filter((p) => p !== "/" && !internalLinks.has(p));
if (orphans.length) err("перелинковка", `на страницы не ведёт ни одна ссылка: ${orphans.join(", ")}`);

console.table(report);
console.log(`\nrobots.txt:\n${robots.body}`);
console.log(`Страниц в карте: ${paths.length}, внутренних ссылок проверено: ${internalLinks.size}`);
if (warn.length) console.log(`\nПредупреждения:\n- ${warn.join("\n- ")}`);
if (errors.length) {
  console.log(`\nОшибки (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("\nОшибок нет");
