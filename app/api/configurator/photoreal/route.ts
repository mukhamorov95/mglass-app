import { NextResponse, type NextRequest } from 'next/server'

// Фотореалистичный кадр конфигурации (NanoBanana = Gemini 2.5 Flash Image, img2img).
// Скриншот нашей 3D-сцены идёт КАРКАСОМ: модель не придумывает изделие, а только
// доводит реализм (плитка, свет, отражения). Геометрия/фурнитура/ракурс — наши.
// Публичный маршрут (embed на сайте): себестоимости здесь нет, но генерация платная —
// поэтому мягкий лимит по IP и потолок на размер входного кадра.

export const maxDuration = 60

const MODEL = 'gemini-2.5-flash-image'
const MAX_INPUT_BYTES = 3_500_000        // ~3.5 МБ base64 кадра
const LIMIT_PER_HOUR = 8

const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now(), hourAgo = now - 3_600_000
  const list = (hits.get(ip) ?? []).filter(t => t > hourAgo)
  if (list.length >= LIMIT_PER_HOUR) { hits.set(ip, list); return true }
  list.push(now); hits.set(ip, list)
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => t > hourAgo)) hits.delete(k)
  return false
}

function buildPrompt(cfg: Record<string, unknown>): string {
  const parts = [
    'Photorealistic interior photograph of this exact shower enclosure, professional architectural visualization.',
    'CRITICAL: keep the geometry EXACTLY as in the reference image — same number of glass panels, same door position and opening, same hardware placement (hinges, handle, brackets, rail), same proportions and the same camera angle.',
    'Do NOT add, remove or move any panel, door, profile or hardware. Do not invent extra fixtures.',
    'Improve only realism: real ceramic tiles with natural grout, realistic tempered glass with subtle reflections and refraction, polished metal hardware with accurate specular highlights, soft natural bathroom lighting, contact shadows, clean modern bathroom interior.',
    'No text, no watermark, no people.',
  ]
  const meta: string[] = []
  if (cfg.model) meta.push(`model ${cfg.model}`)
  if (cfg.width) meta.push(`width ${cfg.width} mm`)
  if (cfg.height) meta.push(`height ${cfg.height} mm`)
  if (cfg.glass) meta.push(`glass: ${cfg.glass}`)
  if (cfg.finish) meta.push(`hardware finish: ${cfg.finish}`)
  if (meta.length) parts.push(`Product spec (for material accuracy only): ${meta.join(', ')}.`)
  return parts.join(' ')
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'Фотореалистичный вид не настроен (нет GEMINI_API_KEY)' }, { status: 501 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { image?: string; config?: Record<string, unknown> } | null
  const dataUrl = body?.image
  if (!dataUrl || !/^data:image\/(png|jpeg);base64,/.test(dataUrl)) {
    return NextResponse.json({ error: 'Нужен кадр сцены (image: data:image/...;base64,...)' }, { status: 400 })
  }
  const [, mime = 'image/jpeg'] = dataUrl.match(/^data:(image\/[a-z]+);base64,/) ?? []
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (b64.length > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: 'Кадр слишком большой' }, { status: 413 })
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: buildPrompt(body?.config ?? {}) },
          { inline_data: { mime_type: mime, data: b64 } },
        ],
      }],
    }),
  }).catch(() => null)

  if (!res) return NextResponse.json({ error: 'Сервис изображений недоступен' }, { status: 502 })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Ключ наружу не отдаём — только код и краткая причина.
    return NextResponse.json({ error: `Ошибка генерации (${res.status})`, detail: detail.slice(0, 300) }, { status: 502 })
  }

  const json = await res.json().catch(() => null) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
  } | null
  const part = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)
  if (!part?.inlineData?.data) {
    return NextResponse.json({ error: 'Модель не вернула изображение' }, { status: 502 })
  }
  return NextResponse.json({
    image: `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`,
  })
}
