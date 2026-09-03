// Художественное задание для «Фотореалистичного вида»: скриншот нашей 3D-сцены →
// каталожный рендер. Отдельный файл, потому что правится чаще кода вокруг и читается
// глазами — как и промпт разбора чертежей (parts/extractPrompt.ts).
//
// Эталон задан владельцем: рендер уровня Radaway / HSK / Sprinz / Duka / Provex,
// сделанный в Corona Renderer или V-Ray, а не «нейросетевая картинка».
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ, которое нельзя ослаблять: изделие берётся из кадра сцены.
// Модель доводит РЕАЛИЗМ, а не придумывает душевую. Иначе клиент увидит на сайте
// одну кабину, а получит другую — и это уже не картинка, а обещание.

const HARD_CONSTRAINT = [
  'CRITICAL — the attached frame defines the PRODUCT. Keep its geometry EXACTLY:',
  'same number of glass panels, same panel proportions, same door position and opening angle,',
  'same hardware type and placement (hinges, handle, brackets, rail, profiles),',
  'same camera angle and framing. Do NOT add, remove, resize or move any panel, door,',
  'profile or piece of hardware. Do not invent extra fixtures, shelves or fittings.',
].join(' ')

const STYLE = [
  'Premium architectural product visualization for the official website of a high-end',
  'frameless shower enclosure manufacturer. The result must look like a professional',
  'Corona Renderer / V-Ray visualization, not an AI image.',
  'Style: minimalistic, premium, European, luxury, clean, modern, catalog quality, ultra realistic.',
].join(' ')

const SCENE = [
  'Bathroom: modern minimal, large format porcelain tiles, warm light beige,',
  'very subtle stone texture, thin grout lines, clean geometry.',
  'Absolutely no decorative elements: no towels, no shower accessories, no cosmetics,',
  'no shelves, no plants, no furniture, nothing that distracts from the product.',
].join(' ')

const GLASS = [
  'Glass: 8 mm ultra-clear tempered glass, extremely transparent, almost invisible,',
  'with a very subtle green tint only on the exposed polished edges.',
  'Realistic Fresnel reflections and correct refraction. No blue tint, no gray tint,',
  'no excessive reflections.',
].join(' ')

const TRAY_AND_LIGHT = [
  'Shower tray: white acrylic, smooth satin finish, soft reflections, realistic edges.',
  'Lighting: professional architectural lighting, soft daylight from the upper left,',
  'large area lights, global illumination, ambient occlusion, soft contact shadows,',
  'bright exposure, natural light, no hard shadows.',
].join(' ')

const RENDER = [
  'Physically accurate PBR materials, realistic reflections and roughness — every surface',
  'physically correct. Ultra photorealistic, 8K, sharp, noise free.',
  'No text, no watermark, no logo, no people, no reflection of a photographer.',
].join(' ')

// Цвет фурнитуры берётся из конфигурации клиента, а не из эталона: эталон чёрный,
// а в конфигураторе три отделки. Подставлять чёрный всегда — врать про заказ.
const FINISH_LOOK: Record<string, string> = {
  black: 'premium matte black powder-coated aluminium, high-end finish, crisp edges, realistic fine powder texture',
  chrome: 'premium polished chrome, mirror finish, crisp edges, realistic specular highlights without blown-out hotspots',
  white: 'premium matte white powder-coated aluminium, high-end finish, crisp edges, soft even sheen',
}

export function buildPhotorealPrompt(cfg: Record<string, unknown>): string {
  const finishId = String(cfg.finishId ?? cfg.finish ?? '').toLowerCase()
  const look = FINISH_LOOK[finishId]
    ?? (/чёрн|черн|black|графит/.test(String(cfg.finish ?? '')) ? FINISH_LOOK.black
      : /бел|white/.test(String(cfg.finish ?? '')) ? FINISH_LOOK.white
      : FINISH_LOOK.chrome)

  const meta: string[] = []
  if (cfg.model) meta.push(`model ${cfg.model}`)
  if (cfg.width) meta.push(`width ${cfg.width} mm`)
  if (cfg.height) meta.push(`height ${cfg.height} mm`)
  if (cfg.glass) meta.push(`glass type: ${cfg.glass}`)

  return [
    HARD_CONSTRAINT,
    STYLE,
    SCENE,
    GLASS,
    `Metal hardware: ${look}. Accurate geometry, premium European quality.`,
    TRAY_AND_LIGHT,
    RENDER,
    meta.length ? `Product spec, for material accuracy only — never a reason to change the geometry: ${meta.join(', ')}.` : '',
  ].filter(Boolean).join(' ')
}
