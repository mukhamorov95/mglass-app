// Отрисовка слайда обучающего ролика на canvas.
//
// Почему canvas, а не вёрстка: браузер умеет писать видео только с потока
// (canvas.captureStream), а ffmpeg на машине нет и поставить нечем — brew
// отсутствует. Так ролик собирается целиком в браузере и получается настоящим
// файлом, который можно отправить в мессенджер.

export type Slide = {
  id:       string
  title:    string
  sub?:     string
  bullets?: string[]
  text:     string
  /** Скриншот экрана: путь в /public. Со снимком слайд превращается в показ экрана,
   *  а подпись уезжает вниз узкой полосой — чтобы не закрывать то, о чём говорим. */
  shot?:    string
  /** Куда смотреть на снимке: доля от ширины и высоты, 0..1. Медленный наезд на эту
   *  точку заменяет запись экрана — глаз сам идёт туда, куда ведёт голос. */
  focus?:   [number, number]
}

export const W = 1280
export const H = 720

const INK   = '#111110'
const MUTED = '#7c8288'
const LINE  = '#e2e4e1'
const PAPER = '#f6f6f4'
const CARD  = '#ffffff'
const ACC   = '#c2410c'

// Перенос по словам — длинные русские заголовки иначе уезжают за кадр.
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w
    if (ctx.measureText(probe).width > maxW && cur) { lines.push(cur); cur = w }
    else cur = probe
  }
  if (cur) lines.push(cur)
  return lines
}

// Слайд со снимком экрана: медленный наезд на нужное место плюс подпись снизу.
// Так из статичного скриншота получается то же, что даёт запись экрана, — взгляд
// ведёт голос, — но без записи: снимать боевые экраны с чужими данными нельзя.
export function drawShotSlide(
  ctx: CanvasRenderingContext2D, s: Slide, img: HTMLImageElement,
  index: number, total: number, progress: number,
) {
  ctx.fillStyle = '#0e1012'
  ctx.fillRect(0, 0, W, H)

  const BAR = 108                       // полоса подписи снизу
  const viewH = H - BAR
  const [fx, fy] = s.focus ?? [0.5, 0.4]

  // Наезд с 1.0 до 1.12 за слайд: заметно глазу, не укачивает.
  const zoom = 1 + 0.12 * progress
  const base = Math.max(W / img.width, viewH / img.height)
  const scale = base * zoom
  const dw = img.width * scale
  const dh = img.height * scale
  const dx = (W - dw) * fx
  const dy = (viewH - dh) * fy

  ctx.save()
  ctx.beginPath(); ctx.rect(0, 0, W, viewH); ctx.clip()
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()

  ctx.fillStyle = '#15181b'
  ctx.fillRect(0, viewH, W, BAR)
  ctx.fillStyle = '#c2410c'
  ctx.fillRect(0, viewH, W * ((index + progress) / total), 4)

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 30px -apple-system, Manrope, sans-serif'
  const line = wrap(ctx, s.title, W - 200)[0] ?? s.title
  ctx.fillText(line, 48, viewH + 50)

  if (s.sub) {
    ctx.fillStyle = '#9aa3ab'
    ctx.font = '400 22px -apple-system, sans-serif'
    ctx.fillText(wrap(ctx, s.sub, W - 200)[0] ?? s.sub, 48, viewH + 84)
  }

  ctx.fillStyle = '#6b7480'
  ctx.font = '500 20px -apple-system, sans-serif'
  const num = `${index + 1} / ${total}`
  ctx.fillText(num, W - 48 - ctx.measureText(num).width, viewH + 50)
}

export function drawSlide(ctx: CanvasRenderingContext2D, s: Slide, index: number, total: number, progress: number) {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)

  // Карточка — то же ощущение, что у экранов приложения
  ctx.fillStyle = CARD
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  roundRect(ctx, 64, 64, W - 128, H - 168, 20)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = ACC
  roundRect(ctx, 104, 116, 56, 6, 3)
  ctx.fill()

  ctx.fillStyle = MUTED
  ctx.font = '600 20px -apple-system, Manrope, sans-serif'
  ctx.fillText('M-GLASS · ОБУЧЕНИЕ', 104, 106)

  ctx.fillStyle = INK
  ctx.font = '800 54px -apple-system, Manrope, sans-serif'
  const titleLines = wrap(ctx, s.title, W - 260)
  let y = 200
  for (const l of titleLines) { ctx.fillText(l, 104, y); y += 64 }

  if (s.sub) {
    ctx.fillStyle = MUTED
    ctx.font = '400 30px -apple-system, sans-serif'
    y += 6
    for (const l of wrap(ctx, s.sub, W - 260)) { ctx.fillText(l, 104, y); y += 40 }
  }

  if (s.bullets?.length) {
    y += 28
    ctx.font = '500 30px -apple-system, sans-serif'
    for (const b of s.bullets) {
      ctx.fillStyle = ACC
      ctx.beginPath(); ctx.arc(118, y - 10, 7, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = INK
      for (const l of wrap(ctx, b, W - 320)) { ctx.fillText(l, 146, y); y += 40 }
      y += 14
    }
  }

  // Полоса хода: зритель видит, сколько осталось
  ctx.fillStyle = LINE
  roundRect(ctx, 64, H - 72, W - 128, 8, 4); ctx.fill()
  ctx.fillStyle = ACC
  const done = (index + progress) / total
  roundRect(ctx, 64, H - 72, Math.max(8, (W - 128) * done), 8, 4); ctx.fill()

  ctx.fillStyle = MUTED
  ctx.font = '500 20px -apple-system, sans-serif'
  ctx.fillText(`${index + 1} / ${total}`, 64, H - 96)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
