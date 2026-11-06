/** CSS do painel (isolado no Shadow DOM — não vaza para o portal e vice-versa). Tokens Orvia. */
export const CSS = `
:host, * { box-sizing: border-box; }
.fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: 52px; height: 52px; border-radius: 50%;
  border: 0; background: #3D8EFF; color: #fff; font: 800 22px/1 Inter, system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 8px 24px rgba(61,142,255,.45); }
.fab:hover { background: #2F6BFF; }
.fab:focus-visible { outline: 3px solid #6EA8FF; outline-offset: 3px; }
.fab .dot { position: absolute; top: 4px; right: 4px; width: 10px; height: 10px; border-radius: 50%; background: #34D399; border: 2px solid #0B1220; }
.panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 2147483647; display: flex; flex-direction: column;
  background: #0B1220; color: #E6ECFA; border-left: 1px solid #1C2A47; box-shadow: -12px 0 40px rgba(0,0,0,.55);
  font: 13px/1.45 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #1A2231; }
header .sub { display: block; font-size: 11px; color: #8FA0C4; }
.icon { background: none; border: 0; color: #8FA0C4; font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
.icon:hover { background: rgba(255,255,255,.06); color: #fff; }
nav { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid #1A2231; }
.tab { flex: 1; background: none; border: 0; border-bottom: 2px solid transparent; color: #8FA0C4; padding: 8px 4px; font-weight: 600; cursor: pointer; font-size: 13px; }
.tab.active { color: #fff; border-color: #3D8EFF; }
.body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: #8FA0C4; margin: 18px 0 8px; }
p { margin: 4px 0; }
.card { border: 1px solid #1E2738; background: #0D1320; border-radius: 12px; padding: 12px; margin: 10px 0; }
.card.ok { border-color: rgba(52,211,153,.35); }
.card.sev-alto { border-left: 3px solid #F87171; } .card.sev-medio { border-left: 3px solid #FBBF24; } .card.sev-baixo { border-left: 3px solid #3D8EFF; }
.row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.muted { color: #8FA0C4; font-size: 12px; } .hint { color: #7C8AA1; font-size: 11px; margin-top: 6px; }
.warn { color: #FBBF24; font-size: 12px; } .mono { font-family: ui-monospace, Consolas, monospace; }
.pill { white-space: nowrap; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #26314A; color: #B4BFD0; }
.pill.create { color: #C4B5FD; border-color: rgba(167,139,250,.4); } .pill.update { color: #FBBF24; border-color: rgba(251,191,36,.45); }
.field { display: block; margin: 8px 0; } .label { display: block; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #8FA0C4; margin-bottom: 4px; }
.input { width: 100%; height: 36px; border-radius: 8px; border: 1px solid #26314A; background: #080D18; color: #E8EDF7; padding: 0 10px; font: inherit; margin: 6px 0; }
.input:focus { outline: none; border-color: #3D8EFF; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn { width: 100%; height: 36px; border-radius: 8px; border: 1px solid #26314A; background: #0D1320; color: #D5DDEA; font: 600 13px Inter, system-ui, sans-serif; cursor: pointer; margin-top: 8px; }
.btn:hover:not(:disabled) { border-color: #3D8EFF; color: #fff; }
.btn.primary { background: #3D8EFF; border-color: #3D8EFF; color: #fff; } .btn.primary:hover:not(:disabled) { background: #2F6BFF; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.link { background: none; border: 0; color: #6EA8FF; cursor: pointer; font-size: 11px; padding: 0; }
.notice { margin: 10px 16px 0; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.notice.ok { background: rgba(52,211,153,.1); color: #6EE7B7; } .notice.erro { background: rgba(248,113,113,.12); color: #FCA5A5; } .notice.info { background: rgba(61,142,255,.12); color: #CFE0FF; }
table.diff { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
table.diff th { text-align: left; color: #8FA0C4; font-weight: 600; padding: 4px 6px 4px 0; vertical-align: top; width: 70px; }
table.diff td { padding: 4px 6px; vertical-align: top; } td.before { color: #7C8AA1; text-decoration: line-through; } td.after { color: #fff; }
.combo { margin-top: 8px; padding: 8px; border-radius: 8px; background: #080D18; }
`
