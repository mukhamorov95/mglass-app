'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { renderDocCanvas } from '@/lib/pdfCapture'
import KpDocument, { type KpContent } from './KpDocument'

const CSS = `
.kp-scope{--red:#E1442E;--ink:#18181B;--text:#1D1D1F;--muted:#8C8C88;--line:#E4E4E0;--soft:#F5F5F3;--dot:#CFCFC9;
  background:#54545a;font-family:-apple-system,"Helvetica Neue","Segoe UI",Arial,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;min-height:100vh}
.kp-scope *{margin:0;padding:0;box-sizing:border-box}
.kp-page{width:210mm;min-height:297mm;background:#fff;margin:0 auto 8mm;position:relative;overflow:hidden;display:flex;flex-direction:column}
.kp-fit{width:210mm;flex:1;padding:0 15mm 10mm;display:flex;flex-direction:column;box-sizing:border-box}
.kp-topbar{position:absolute;top:0;left:0;right:0;height:14px;background:var(--ink)}
.kp-topbar::after{content:"";position:absolute;top:14px;left:0;right:0;height:4px;background:var(--red)}
.kp-head{display:flex;justify-content:space-between;align-items:flex-start;padding-top:32px;padding-bottom:13px;border-bottom:2.5px solid var(--ink)}
.kp-head img{height:80px}
.kp-contacts{text-align:right;font-size:13px;line-height:1.7;font-weight:700;color:#2a2a2a}
.kp-sec{display:flex;align-items:center;gap:14px;margin:19px 0 11px}
.kp-sec .num{background:var(--red);color:#fff;font-weight:800;font-size:13px;letter-spacing:.5px;padding:5px 9px;border-radius:3px}
.kp-sec .ttl{font-weight:800;font-size:17px;letter-spacing:1.5px;white-space:nowrap}
.kp-sec .lead{flex:1;border-bottom:1.5px dotted var(--dot);height:1px;margin:0 6px}
.kp-sec .meta{font-size:11px;letter-spacing:2px;color:var(--muted);font-weight:700;white-space:nowrap}
.kp-metabar{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:var(--soft);margin-top:15px}
.kp-metabar .cell{padding:11px 18px;border-right:1px solid var(--line)}
.kp-metabar .cell:last-child{border-right:0}
.kp-metabar .k{font-size:9.5px;letter-spacing:2px;color:var(--muted);font-weight:700;margin-bottom:5px}
.kp-metabar .v{font-size:17px;font-weight:800}
.kp-metabar .v.red{color:var(--red)}
.kp-titleblk{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-top:18px}
.kp-titleblk .over{font-size:11px;letter-spacing:4px;color:var(--red);font-weight:800;margin-bottom:10px}
.kp-titleblk h1{font-size:28px;font-weight:800;letter-spacing:-.3px;line-height:1.08}
.kp-titleblk .sub{font-size:15px;color:#4a4a4a;margin-top:10px;max-width:560px}
.kp-totalbox{background:var(--red);color:#fff;padding:14px 26px;text-align:right;flex-shrink:0}
.kp-totalbox .k{font-size:10px;letter-spacing:2px;font-weight:700;opacity:.9}
.kp-totalbox .v{font-size:30px;font-weight:800;margin-top:2px}
.kp-spec{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line)}
.kp-spec .row{display:flex;align-items:center;gap:8px;padding:8px 18px;border-bottom:1px solid var(--line)}
.kp-spec .row:nth-child(odd){border-right:1px solid var(--line)}
.kp-spec .lbl{font-size:10.5px;letter-spacing:1.5px;color:var(--muted);font-weight:700;white-space:nowrap}
.kp-spec .dl{flex:1;border-bottom:1.5px dotted var(--dot);height:1px}
.kp-spec .val{font-weight:800;font-size:14px;text-align:right}
.kp-spec .val.red{color:var(--red)}
.kp-note{font-size:12px;color:#6a6a66;margin-top:10px;line-height:1.55}
.kp-table{width:100%;border-collapse:collapse;margin-top:4px}
.kp-table thead th{background:var(--ink);color:#fff;font-size:10px;letter-spacing:1.5px;font-weight:700;padding:12px 14px;text-align:left}
.kp-table thead th.c{text-align:center}.kp-table thead th.r{text-align:right}
.kp-table tbody td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
.kp-table tbody tr:nth-child(even){background:var(--soft)}
.kp-table td.n{color:var(--red);font-weight:800;font-size:15px;width:44px}
.kp-table td .nm{font-weight:800;font-size:14px}
.kp-table td .ds{font-size:11.5px;color:#8a8a86;margin-top:4px;line-height:1.5}
.kp-table td.qty{text-align:center;font-size:15px;width:64px}
.kp-table td.price{text-align:right;font-size:15px;width:120px;color:#3a3a3a}
.kp-table td.sum{text-align:right;font-weight:800;font-size:16px;width:130px}
.kp-subtotal{display:flex;justify-content:flex-end;gap:40px;padding:11px 14px;font-weight:800}
.kp-subtotal .lbl{color:#4a4a4a}
.kp-discount{color:var(--red);padding-top:0}
.kp-discount .lbl{color:var(--red)}
.kp-paybar{display:flex;justify-content:space-between;align-items:center;background:var(--red);color:#fff;padding:14px 26px;margin-top:6px}
.kp-paybar .l{font-size:15px;letter-spacing:3px;color:#fff;font-weight:800}
.kp-paybar .r{font-size:28px;font-weight:800}
.kp-vat{text-align:right;font-size:12px;color:#8a8a86;margin-top:10px}
.kp-foot{margin-top:auto;padding-top:16px;border-top:2.5px solid var(--ink);display:flex;justify-content:space-between;align-items:center;font-size:10.5px;letter-spacing:1px}
.kp-foot .b{color:var(--red);font-weight:800;letter-spacing:2px}
.kp-foot .m{color:var(--muted);letter-spacing:1.5px}
.kp-darkcard{display:flex;background:var(--ink);color:#fff;position:relative;overflow:hidden;background-image:linear-gradient(#2a2a2e 1px,transparent 1px),linear-gradient(90deg,#2a2a2e 1px,transparent 1px);background-size:34px 34px}
.kp-darkcard .left{width:38%;border-right:1px solid var(--red);padding:34px 30px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
.kp-darkcard .big{font-size:78px;font-weight:800;line-height:1}
.kp-darkcard .big span{font-size:32px;color:var(--red);margin-left:2px}
.kp-darkcard .cap{font-size:11px;letter-spacing:3px;color:var(--red);font-weight:700;margin-top:16px}
.kp-darkcard .right{flex:1;padding:34px 30px;display:flex;flex-direction:column;justify-content:center}
.kp-darkcard .over{font-size:11px;letter-spacing:3px;color:var(--red);font-weight:700;margin-bottom:12px}
.kp-darkcard h2{font-size:26px;font-weight:800;line-height:1.15}
.kp-darkcard p{font-size:13px;color:#c7c7c7;margin-top:14px;line-height:1.6;max-width:460px}
.kp-cards4{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line)}
.kp-cards4 .card{padding:22px 18px;border-right:1px solid var(--line)}
.kp-cards4 .card:last-child{border-right:0}
.kp-cards4 .ic{width:40px;height:40px;border:1.5px solid var(--red);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--red);margin-bottom:18px}
.kp-cards4 .ic svg{width:20px;height:20px}
.kp-cards4 h3{font-size:14px;font-weight:800;margin-bottom:8px}
.kp-cards4 p{font-size:11.5px;color:#7a7a76;line-height:1.55}
.kp-why{display:grid;grid-template-columns:1fr 1fr;gap:22px 40px}
.kp-why .item{display:flex;gap:14px}
.kp-why .n{color:var(--red);font-weight:800;font-size:15px}
.kp-why h4{font-size:14px;font-weight:800;margin-bottom:7px}
.kp-why p{font-size:12px;color:#7a7a76;line-height:1.6}
.kp-stages{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line)}
.kp-stages .st{padding:20px 16px;border-right:1px solid var(--line)}
.kp-stages .st:last-child{border-right:0}
.kp-stages .e{font-size:10px;letter-spacing:2px;color:var(--red);font-weight:800;margin-bottom:9px}
.kp-stages h4{font-size:14px;font-weight:800;margin-bottom:9px}
.kp-stages p{font-size:11.5px;color:#7a7a76;line-height:1.55}
.kp-cond{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:var(--soft)}
.kp-cond .c{padding:16px 18px;border-right:1px solid var(--line)}
.kp-cond .c:last-child{border-right:0}
.kp-cond .k{font-size:9.5px;letter-spacing:2px;color:var(--muted);font-weight:700;margin-bottom:6px}
.kp-cond .v{font-size:16px;font-weight:800}
.kp-schema{display:grid;grid-template-columns:1.15fr 1fr;border:1px solid var(--line)}
.kp-schema .img{border-right:1px solid var(--line);padding:16px;display:flex;align-items:center;justify-content:center;min-height:300px}
.kp-schema .img img{max-width:100%;max-height:360px}
.kp-schema .noimg{color:#b4b4ae;font-size:13px}
.kp-schema .list{padding:24px 26px}
.kp-schema .list .over{font-size:11px;letter-spacing:3px;color:var(--muted);font-weight:700;margin-bottom:18px}
.kp-schema .li{display:flex;gap:14px;margin-bottom:18px}
.kp-schema .li .b{background:var(--red);color:#fff;font-weight:800;font-size:12px;width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kp-schema .li h4{font-size:14px;font-weight:800;margin-bottom:5px}
.kp-schema .li p{font-size:12px;color:#7a7a76;line-height:1.6}
.kp-cta{display:flex;justify-content:space-between;align-items:center;background:var(--ink);color:#fff;padding:32px 34px;background-image:linear-gradient(90deg,#242428 1px,transparent 1px);background-size:30px 100%}
.kp-cta .over{font-size:11px;letter-spacing:3px;color:var(--red);font-weight:700;margin-bottom:12px}
.kp-cta h2{font-size:28px;font-weight:800;line-height:1.1}
.kp-cta .r{text-align:right;font-size:16px;font-weight:700;line-height:1.9}
.kp-thanks{text-align:center;font-size:14px;letter-spacing:1px;color:#4a4a4a;margin-top:26px;font-weight:600}
.kp-toolbar{position:fixed;top:16px;right:16px;z-index:50;display:flex;gap:8px}
.kp-toolbar button{background:#111110;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
@media print{
  .kp-scope{background:#fff}
  .kp-toolbar{display:none}
  .kp-page{margin:0;box-shadow:none;min-height:297mm;page-break-after:always}
  .kp-page:last-child{page-break-after:auto}
  @page{size:A4;margin:0}
}
`

// Дождаться реальной загрузки всех картинок листов. Иначе html2canvas снимет
// пустой слот фото на листе 3 — удалённое фото со стораджа медленнее логотипа.
async function waitImages(root: ParentNode) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(img => (img.complete && img.naturalWidth > 0)
    ? Promise.resolve()
    : new Promise<void>(res => {
        const done = () => res()
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
        setTimeout(done, 8000)
      })))
}

// Детерминированная генерация PDF из экранных листов (WYSIWYG, всегда 3 листа A4).
// Что на экране — то и в файле; не зависит от браузерного движка печати.
async function generatePdf(number: string, setBusy?: (v: boolean) => void) {
  try {
    setBusy?.(true)
    const jspdfMod = await import('jspdf')
    const jsPDF = jspdfMod.jsPDF
    await waitImages(document.querySelector('.kp-scope') ?? document)
    await new Promise(r => setTimeout(r, 120))
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.kp-page'))
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const A4W = 210, A4H = 297
    for (let i = 0; i < pages.length; i++) {
      const canvas = await renderDocCanvas(pages[i])
      const img = canvas.toDataURL('image/jpeg', 0.94)
      // Вписываем снимок листа в A4: по ширине; если выше — ужимаем по высоте (без обрезки).
      let w = A4W, h = A4W * canvas.height / canvas.width
      if (h > A4H) { h = A4H; w = A4H * canvas.width / canvas.height }
      if (i > 0) pdf.addPage()
      pdf.addImage(img, 'JPEG', (A4W - w) / 2, 0, w, h)
    }
    pdf.save(`КП-${number || 'proposal'}.pdf`)
  } catch (e) {
    alert('Не удалось сформировать PDF: ' + (e instanceof Error ? e.message : 'ошибка'))
  } finally {
    setBusy?.(false)
  }
}

export default function KpPrintPage() {
  const params = useParams()
  const id = params?.id as string
  const [kp, setKp] = useState<KpContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await createClient()
          .from('commercial_proposals')
          .select('number, content, manager_name, valid_until, photos')
          .eq('id', id)
          .maybeSingle()
        if (error || !data) { setNotFound(true); return }
        const content = (data.content ?? {}) as KpContent
        const photos = (data.photos ?? []) as string[]
        setKp({
          ...content,
          number: content.number ?? String(data.number ?? ''),
          manager: content.manager ?? (data.manager_name as string | undefined),
          valid_until: content.valid_until ?? (data.valid_until as string | undefined),
          photo_url: content.photo_url ?? (photos[0] ?? null),
        })
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // Пришли по кнопке «Сохранить в PDF» (?print=1) → сразу открываем диалог сохранения.
  // Ждём загрузки ВСЕХ картинок (логотип + фото схемы на листе 3), иначе фото не попадёт.
  useEffect(() => {
    if (!kp || typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('print') !== '1') return
    let cancelled = false
    ;(async () => {
      await waitImages(document.querySelector('.kp-scope') ?? document)
      if (!cancelled) setTimeout(() => generatePdf(kp.number ?? '', setGenerating), 250)
    })()
    return () => { cancelled = true }
  }, [kp])

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#8a8a85' }}>Загрузка КП…</div>
  if (notFound || !kp) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#8a8a85' }}>КП не найдено.</div>

  return (
    <div className="kp-scope">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-toolbar">
        <button onClick={() => generatePdf(kp.number ?? '', setGenerating)} disabled={generating}>
          {generating ? 'Готовлю PDF…' : '💾 Скачать PDF'}
        </button>
        <button onClick={() => window.print()} style={{ background: '#6b6b66' }}>🖨 Печать</button>
      </div>
      <KpDocument kp={kp} />
    </div>
  )
}
