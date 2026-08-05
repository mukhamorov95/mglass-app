// Дизайн-система кабинета партнёра (перенос из прототипа-артефакта).
// Изолирована под .pcab, чтобы не течь во внутренний интерфейс сотрудников.
// Светлая + тёмная тема (по prefers-color-scheme). Партнёр видит только этот
// раздел, поэтому тёмная тема здесь консистентна для реального клиента.
// Без color-mix и CSS-nesting — ради совместимости с браузерами партнёров.

const CSS = `
.pcab{
  --bg:#f0f0ec; --surface:#ffffff; --surface-2:#f7f7f5;
  --ink:#111110; --ink-2:#3a3a38; --muted:#9a9a95; --border:#e4e4e0;
  --accent:#c0453a; --accent-ink:#ffffff; --brand-lt:#d0574a; --brand-dk:#9c3529;
  --quote:#6b6b66; --quote-bg:#f0f0ec;
  --amber:#b45309; --amber-bg:#fdf6ec; --amber-bd:#f0e0c8;
  --blue:#1d4ed8; --blue-bg:#eef3fd; --blue-bd:#d4e0f7;
  --green:#047857; --green-bg:#eaf6f0; --green-bd:#cbe9db;
  --shadow:0 1px 2px rgba(17,17,16,.04),0 8px 24px rgba(17,17,16,.05);
  --radius:16px;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-family:var(--font); background:var(--bg); color:var(--ink);
  -webkit-font-smoothing:antialiased; font-size:14px; line-height:1.45;
  display:grid; grid-template-columns:248px 1fr; min-height:100vh;
}
@media (prefers-color-scheme:dark){
  .pcab{
    --bg:#141413; --surface:#1f1f1e; --surface-2:#262625;
    --ink:#f4f4f1; --ink-2:#c8c8c3; --muted:#8a8a85; --border:#33332f;
    --accent:#d3564a; --accent-ink:#ffffff; --brand-lt:#d0574a; --brand-dk:#a1362a;
    --quote:#a3a39d; --quote-bg:#2a2a28;
    --amber:#e0a45c; --amber-bg:#2c2519; --amber-bd:#413621;
    --blue:#7aa5f0; --blue-bg:#1a2133; --blue-bd:#2a3757;
    --green:#5fc79a; --green-bg:#152a22; --green-bd:#234034;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
  }
}
.pcab *{box-sizing:border-box}
.pcab .tnum{font-variant-numeric:tabular-nums}
.pcab a{color:inherit}
.pcab button{font-family:inherit}

/* Sidebar */
.pcab .side{background:var(--surface);border-right:1px solid var(--border);
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.pcab .brand{display:flex;align-items:center;gap:10px;padding:20px 20px 16px}
.pcab .brand .logo{width:34px;height:30px;flex-shrink:0;display:flex}
.pcab .brand .logo svg{width:34px;height:30px;display:block}
.pcab .brand .co{font-weight:800;letter-spacing:.02em;font-size:15px}
.pcab .brand .sub{font-size:11px;color:var(--muted);margin-top:1px}
.pcab .nav{display:flex;flex-direction:column;gap:2px;padding:8px 12px;flex:1}
.pcab .nav .lbl{font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted);padding:14px 10px 6px}
.pcab .nav .it{display:flex;align-items:center;gap:11px;width:100%;text-align:left;
  background:none;border:0;padding:9px 10px;border-radius:10px;color:var(--ink-2);
  font-size:13.5px;font-weight:500;cursor:pointer;transition:.14s;text-decoration:none}
.pcab .nav .it:hover{background:var(--surface-2);color:var(--ink)}
.pcab .nav .it.on{background:var(--accent);color:var(--accent-ink)}
.pcab .nav .it.on .ic svg{stroke:var(--accent-ink)}
.pcab .nav .ic{width:18px;height:18px;flex-shrink:0;display:flex}
.pcab .nav .ic svg{width:18px;height:18px;stroke:var(--muted);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pcab .nav .it:hover .ic svg{stroke:var(--ink)}
.pcab .nav .badge{margin-left:auto;background:var(--blue-bg);color:var(--blue);
  border:1px solid var(--blue-bd);font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px}
.pcab .grp{display:flex;flex-direction:column}
.pcab .grp .chev{margin-left:auto;font-size:9px;color:var(--muted);transition:.16s;transform:rotate(-90deg)}
.pcab .grp.open .chev{transform:rotate(0deg)}
.pcab .sub{display:none;flex-direction:column;gap:2px;margin:2px 0 4px 26px;
  padding-left:10px;border-left:1px solid var(--border)}
.pcab .grp.open .sub{display:flex}
.pcab .sub .it{padding:8px 10px;border-radius:9px;font-size:13px}
.pcab .sub .it .badge{background:var(--surface-2);color:var(--muted);border:1px solid var(--border);font-size:10px}
.pcab .sub .it.on .badge{background:rgba(255,255,255,.2);color:#fff;border-color:transparent}
.pcab .who{border-top:1px solid var(--border);padding:12px;display:flex;align-items:center;gap:10px}
.pcab .who .av{width:32px;height:32px;border-radius:50%;background:var(--surface-2);
  border:1px solid var(--border);display:grid;place-items:center;font-weight:700;font-size:12px;color:var(--ink-2);flex-shrink:0}
.pcab .who .nm{font-size:12.5px;font-weight:600;line-height:1.2}
.pcab .who .rl{font-size:11px;color:var(--muted)}
.pcab .who .out{margin-left:auto;background:none;border:0;color:var(--muted);cursor:pointer;padding:6px;border-radius:8px;font-size:15px}
.pcab .who .out:hover{color:var(--ink);background:var(--surface-2)}

/* Main */
.pcab .main{padding:0 0 60px;overflow-x:hidden;min-width:0}
.pcab .top{position:sticky;top:0;z-index:5;background:var(--bg);
  border-bottom:1px solid var(--border);
  padding:18px 32px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.pcab .top h1{margin:0;font-size:21px;font-weight:700;letter-spacing:-.02em}
.pcab .top .cap{font-size:12.5px;color:var(--muted);margin-top:2px}
.pcab .wrap{max-width:940px;margin:0 auto;padding:24px 32px}
.pcab .primary{background:var(--accent);color:var(--accent-ink);border:0;border-radius:11px;
  padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:.14s;white-space:nowrap;text-decoration:none;display:inline-block}
.pcab .primary:hover{opacity:.88}
.pcab .ghost{background:var(--surface);color:var(--ink-2);border:1px solid var(--border);border-radius:11px;
  padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:.14s;white-space:nowrap;text-decoration:none;display:inline-block}
.pcab .ghost:hover{border-color:var(--ink);color:var(--ink)}

/* KPI */
.pcab .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.pcab .kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 18px;box-shadow:var(--shadow)}
.pcab .kpi .k{font-size:11.5px;color:var(--muted);font-weight:600}
.pcab .kpi .v{font-size:26px;font-weight:700;letter-spacing:-.02em;margin-top:8px}
.pcab .kpi .d{font-size:11.5px;margin-top:6px;color:var(--green);font-weight:600}
.pcab .kpi .d.flat{color:var(--muted)}

.pcab .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:var(--shadow)}
.pcab .card-h{padding:16px 18px;border-bottom:1px solid var(--border);display:flex;
  align-items:center;justify-content:space-between}
.pcab .card-h h3{margin:0;font-size:14px;font-weight:700}
.pcab .card-h .mut{font-size:12px;color:var(--muted)}

/* Chart */
.pcab .chart{padding:20px 18px 8px;display:grid;grid-template-columns:repeat(12,1fr);
  gap:8px;align-items:end;height:190px}
.pcab .bar{display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end}
.pcab .bar .fill{width:100%;max-width:26px;background:var(--accent);
  border-radius:6px 6px 3px 3px;transition:.2s;min-height:3px}
.pcab .bar:hover .fill{filter:brightness(1.12)}
.pcab .bar .m{font-size:10px;color:var(--muted);font-weight:600}
.pcab .bar.peak .fill{background:var(--blue)}

.pcab .split{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;margin-top:14px}

/* status bars list */
.pcab .srow{display:flex;align-items:center;gap:12px;padding:11px 18px;border-top:1px solid var(--border)}
.pcab .srow.first{border-top:0}
.pcab .srow .snm{font-size:13px;font-weight:500;width:150px;flex-shrink:0}
.pcab .srow .track{flex:1;height:8px;background:var(--surface-2);border-radius:20px;overflow:hidden}
.pcab .srow .tk{height:100%;border-radius:20px}
.pcab .srow .ct{font-size:12.5px;color:var(--muted);font-weight:600;width:26px;text-align:right;flex-shrink:0}

/* pills */
.pcab .pill{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid;white-space:nowrap;display:inline-flex;gap:5px;align-items:center}
.pcab .pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.pcab .p-quote{color:var(--quote);background:var(--quote-bg);border-color:var(--border)}
.pcab .p-sub{color:var(--amber);background:var(--amber-bg);border-color:var(--amber-bd)}
.pcab .p-work{color:var(--blue);background:var(--blue-bg);border-color:var(--blue-bd)}
.pcab .p-ready{color:var(--green);background:var(--green-bg);border-color:var(--green-bd)}
.pcab .p-ship{color:var(--quote);background:var(--quote-bg);border-color:var(--border)}

/* Orders */
.pcab .lane-lbl{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  color:var(--muted);margin:22px 2px 10px;display:flex;gap:8px;align-items:center}
.pcab .lane-lbl .n{background:var(--surface-2);border:1px solid var(--border);color:var(--ink-2);
  border-radius:20px;font-size:10.5px;padding:0 7px;font-weight:700}
.pcab .ord{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;
  margin-bottom:10px;box-shadow:var(--shadow);transition:.14s}
.pcab .ord.clk{cursor:pointer}
.pcab .ord.clk:hover{border-color:var(--ink);transform:translateY(-1px)}
.pcab .ord .r1{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.pcab .ord .num{font-size:14.5px;font-weight:700}
.pcab .ord .yr{color:var(--muted);font-weight:400}
.pcab .ord .meta{font-size:12px;color:var(--muted);margin-top:2px}
.pcab .ord .amt{font-size:14.5px;font-weight:700;white-space:nowrap}
.pcab .ord .prog{display:flex;align-items:center;gap:10px;margin-top:12px}
.pcab .ord .track{flex:1;height:6px;background:var(--surface-2);border-radius:20px;overflow:hidden}
.pcab .ord .tk{height:100%;border-radius:20px}
.pcab .ord .pc{font-size:11.5px;color:var(--muted);font-weight:600;white-space:nowrap}
.pcab .ord .recalc{margin-top:10px;font-size:11.5px;color:var(--amber);background:var(--amber-bg);
  border:1px solid var(--amber-bd);border-radius:9px;padding:7px 10px}
.pcab .ord .send{margin-top:11px;width:100%;background:var(--accent);color:var(--accent-ink);
  border:0;border-radius:10px;padding:9px;font-size:12.5px;font-weight:600;cursor:pointer}
.pcab .ord .send:disabled{opacity:.4;cursor:default}

/* Order detail */
.pcab .back{background:none;border:0;color:var(--muted);cursor:pointer;font-size:13px;font-weight:600;
  padding:0;margin-bottom:14px;display:inline-flex;gap:6px;align-items:center;text-decoration:none}
.pcab .back:hover{color:var(--ink)}
.pcab table{width:100%;border-collapse:collapse}
.pcab .tbl-wrap{overflow-x:auto}
.pcab th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;
  text-align:left;padding:12px 14px;border-bottom:1px solid var(--border)}
.pcab td{padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px}
.pcab tr:last-child td{border-bottom:0}
.pcab th.r,.pcab td.r{text-align:right}
.pcab .tot-row td{font-weight:700;font-size:14px;background:var(--surface-2)}
.pcab .timeline{padding:6px 18px 14px}
.pcab .tl{display:flex;gap:12px;padding:9px 0}
.pcab .tl .dot{width:11px;height:11px;border-radius:50%;margin-top:3px;flex-shrink:0;border:2px solid var(--surface)}
.pcab .tl .dot.done{background:var(--green)}
.pcab .tl .dot.now{background:var(--blue);box-shadow:0 0 0 4px var(--blue-bg)}
.pcab .tl .dot.wait{background:var(--border)}
.pcab .tl .ln{font-size:13px;font-weight:600}
.pcab .tl .dt{font-size:11.5px;color:var(--muted)}
.pcab .tl.pend .ln{color:var(--muted);font-weight:500}
.pcab .draw{border:1px dashed var(--border);border-radius:12px;min-height:150px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  color:var(--muted);background:var(--surface-2);cursor:pointer;text-decoration:none;text-align:center}
.pcab .draw:hover{border-color:var(--ink);color:var(--ink)}

/* Docs */
.pcab .doc{display:flex;align-items:center;gap:14px;padding:14px 18px;border-top:1px solid var(--border)}
.pcab .doc.first{border-top:0}
.pcab .doc .fi{width:38px;height:38px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);
  display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--ink-2);flex-shrink:0}
.pcab .doc .fn{font-size:13.5px;font-weight:600}
.pcab .doc .fm{font-size:11.5px;color:var(--muted)}
.pcab .doc .dl{margin-left:auto;background:none;border:1px solid var(--border);border-radius:9px;
  padding:7px 13px;font-size:12.5px;font-weight:600;color:var(--ink-2);cursor:pointer;text-decoration:none}
.pcab .doc .dl:hover{border-color:var(--ink);color:var(--ink)}

/* Guide */
.pcab .guide-hero{background:linear-gradient(135deg,var(--brand-lt),var(--brand-dk));
  color:#fff;border-radius:var(--radius);padding:26px;margin-bottom:18px}
.pcab .guide-hero h2{margin:0 0 6px;font-size:20px;letter-spacing:-.02em}
.pcab .guide-hero p{margin:0;opacity:.85;font-size:13.5px;max-width:60ch}
.pcab .step{display:flex;gap:16px;padding:18px;border-top:1px solid var(--border)}
.pcab .step.first{border-top:0}
.pcab .step .no{width:30px;height:30px;border-radius:9px;background:var(--accent);color:var(--accent-ink);
  display:grid;place-items:center;font-weight:700;font-size:14px;flex-shrink:0}
.pcab .step h4{margin:0 0 5px;font-size:14.5px;font-weight:700}
.pcab .step p{margin:0;font-size:13px;color:var(--ink-2);max-width:66ch}
.pcab .step .rule{margin-top:9px;font-size:12px;color:var(--muted);background:var(--surface-2);
  border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:0 8px 8px 0;padding:8px 12px}
.pcab .faq{padding:16px 18px;border-top:1px solid var(--border)}
.pcab .faq b{font-size:13px}
.pcab .faq p{margin:5px 0 0;font-size:12.5px;color:var(--ink-2)}

/* Empty / loading */
.pcab .note{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:32px;text-align:center;box-shadow:var(--shadow)}
.pcab .note .t{font-size:14px;color:var(--ink);font-weight:600}
.pcab .note .s{font-size:13px;color:var(--muted);margin-top:4px}
.pcab .cat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:860px){.pcab .cat-grid{grid-template-columns:1fr}}

@media (max-width:860px){
  .pcab{grid-template-columns:186px 1fr}
  .pcab .brand{padding:16px 14px 12px}
  .pcab .brand .co{font-size:14px}
  .pcab .top{padding:14px 16px}
  .pcab .wrap{padding:16px}
  .pcab .kpis{grid-template-columns:1fr 1fr}
  .pcab .split,.pcab .frm{grid-template-columns:1fr}
  .pcab .chart{gap:4px;height:150px}
}
@media (max-width:560px){
  .pcab{grid-template-columns:60px 1fr}
  .pcab .brand{justify-content:center;padding:16px 0 12px}
  .pcab .brand .co,.pcab .brand .sub{display:none}
  .pcab .nav{padding:8px 8px;align-items:center}
  .pcab .nav .lbl{display:none}
  .pcab .nav .it{justify-content:center;padding:12px 0;width:44px;position:relative}
  .pcab .nav .it .tx{display:none}
  .pcab .nav .badge{position:absolute;transform:translate(14px,-12px);margin:0;padding:0 5px}
  .pcab .grp.open .sub{display:none}
  .pcab .grp .chev{display:none}
  .pcab .sub .it{width:44px}
  .pcab .who{justify-content:center;padding:12px 0}
  .pcab .who .nm,.pcab .who .rl,.pcab .who .out{display:none}
  .pcab .top h1{font-size:18px}
}
`

export default function PartnerTheme() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}
