// После `STATIC_EXPORT=1 next build`: нарезает WebP под ширины загрузчика
// (lib/exportImageLoader.ts) и кладёт .htaccess для Apache российского хостинга.
import { readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("out");
const MEDIA = path.join(OUT, "_next/static/media");
const WIDTHS = [256, 384, 480, 768, 1080, 1200];

const files = (await readdir(MEDIA)).filter((f) => /\.(jpe?g|png)$/i.test(f));
let made = 0;
for (const f of files) {
  const src = path.join(MEDIA, f);
  for (const w of WIDTHS) {
    const dst = src.replace(/\.(jpe?g|png)$/i, `.w${w}.webp`);
    await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(dst);
    made++;
  }
}

// /kontakty → kontakty.html; голое имя → www. HTTPS включается в панели хостинга.
const htaccess = `Options -MultiViews -Indexes
DirectoryIndex index.html
ErrorDocument 404 /404.html
AddDefaultCharset utf-8
AddType image/webp .webp

RewriteEngine On
RewriteCond %{HTTP_HOST} ^mglass-zerkala\\.ru$ [NC]
RewriteRule ^ https://www.mglass-zerkala.ru%{REQUEST_URI} [R=301,L]

# Рядом с kontakty.html лежит папка kontakty/ (служебные файлы Next) — поэтому
# .html проверяем раньше папки и не даём Apache дописывать слэш.
DirectorySlash Off
RewriteCond %{DOCUMENT_ROOT}/$1.html -f
RewriteRule ^(.+?)/?$ $1.html [L]

<IfModule mod_headers.c>
  <FilesMatch "\\.(webp|jpe?g|png|svg|woff2?|js|css)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html|xml|txt)$">
    Header set Cache-Control "public, max-age=300"
  </FilesMatch>
</IfModule>
`;
await writeFile(path.join(OUT, ".htaccess"), htaccess);

const size = async (p) => (await stat(p)).size;
console.log(`webp: ${made} файлов из ${files.length} исходников; .htaccess записан; пример ${files[0]} → ${(await size(path.join(MEDIA, files[0]))) >> 10} КБ → w768 ${(await size(path.join(MEDIA, files[0].replace(/\.(jpe?g|png)$/i, ".w768.webp")))) >> 10} КБ`);
