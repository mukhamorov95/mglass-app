// Загрузчик картинок статической сборки: вместо оптимизатора Next ссылается на
// заранее нарезанные WebP. Ширины совпадают с deviceSizes/imageSizes в next.config.ts
// и со списком в scripts/export-images.mjs — меняются вместе.
export default function exportImageLoader({ src, width }: { src: string; width: number }): string {
  return src.replace(/\.(jpe?g|png)$/i, `.w${width}.webp`);
}
