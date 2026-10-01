// Ч1: чертежи и эскизы, которые партнёр прикладывает к просчёту.
// Тип файла определяем по первым байтам, а не по имени: расширение и
// Content-Type присылает браузер, им нельзя верить на сервере.

export type DrawingKind = 'drawing' | 'sketch'
export const DRAWING_KINDS: Record<DrawingKind, string> = { drawing: 'Чертёж конструктора', sketch: 'Фото эскиза' }

// У Vercel лимит тела запроса 4,5 МБ; фото браузер сжимает заранее.
export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_FILES_PER_ORDER = 10
// ≈ 2 Мпикс: цифры на эскизе читаются, файл укладывается в лимит.
export const PHOTO_MAX_PIXELS = 2_000_000
export const PHOTO_JPEG_QUALITY = 0.85

export type FileMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
const EXT: Record<FileMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function sniffMime(head: Uint8Array): FileMime | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => head[i + k] === x)
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

export function isDrawingKind(v: unknown): v is DrawingKind {
  return v === 'drawing' || v === 'sketch'
}

export type FileCheck = { ok: true; mime: FileMime } | { ok: false; error: string }

export function checkDrawingFile(head: Uint8Array, size: number, filesAlready: number): FileCheck {
  if (filesAlready >= MAX_FILES_PER_ORDER) return { ok: false, error: `К просчёту можно приложить не больше ${MAX_FILES_PER_ORDER} файлов. Удалите лишний и попробуйте снова.` }
  if (size <= 0) return { ok: false, error: 'Файл пустой.' }
  if (size > MAX_FILE_BYTES) return { ok: false, error: 'Файл больше 4 МБ. Сохраните PDF с меньшим качеством или сфотографируйте лист заново.' }
  const mime = sniffMime(head)
  if (!mime) return { ok: false, error: 'Подходят PDF, JPEG, PNG и WebP. Фото с iPhone в формате HEIC сохраните как JPEG.' }
  return { ok: true, mime }
}

// Имя для хранилища: латиница, без пути, с расширением по настоящему типу.
export function storagePath(clientId: number, orderId: number, originalName: string, mime: FileMime, now = Date.now()): string {
  const base = originalName.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'file'
  return `partner/${clientId}/${orderId}/${now}_${base}.${EXT[mime]}`
}

// Во сколько раз уменьшить стороны фото, чтобы уложиться в PHOTO_MAX_PIXELS.
export function photoScale(width: number, height: number, maxPixels = PHOTO_MAX_PIXELS): number {
  const px = width * height
  return px <= maxPixels ? 1 : Math.sqrt(maxPixels / px)
}
