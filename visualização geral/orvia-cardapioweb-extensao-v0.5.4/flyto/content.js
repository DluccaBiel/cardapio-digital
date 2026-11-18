/* FlyTo - Fotos em massa (Cardápio Web) v1.1.0
 * Troca a foto de várias OPÇÕES (complementos) e PRODUTOS de uma vez.
 * Usa os mesmos endpoints que o portal usa:
 *   Opções:   GET /api/v1/company/subitems
 *             PUT /api/v1/company/subitem/image/{id}   (multipart, campo "image")
 *   Produtos: GET /api/v1/company/categories/menu?full_version=true
 *             PUT /api/v1/company/item/image/{id}      (multipart, campo "image")
 * Cada envio altera SOMENTE o item daquele ID.
 */
(() => {
  if (window.__flytoFotosEmMassa) return;
  window.__flytoFotosEmMassa = true;

  const API = 'https://api.cardapioweb.com';
  const HOST_ID = 'flyto-fotos-host';
  const OUT_SIZE = 700;        // mesmo tamanho que o portal gera (700x700)
  const JPEG_QUALITY = 0.92;
  const DELAY_MS = 500;        // pausa entre envios
  const HASH_TOLERANCE = 6;    // diferença máxima para considerar "mesma foto"
  const HISTORY_MAX = 10;
  const AUTO_MATCH_MIN = 0.6;  // semelhança mínima nome do arquivo x nome do item

  const KINDS = {
    sub: { label: 'Opções', one: 'opção', many: 'opções', sel1: 'selecionada', selN: 'selecionadas', path: 'subitem',
      ph: 'Buscar opção (ex.: bacon, pimenta defumada) ou ID' },
    item: { label: 'Produtos', one: 'produto', many: 'produtos', sel1: 'selecionado', selN: 'selecionados', path: 'item',
      ph: 'Buscar produto (ex.: polenta, balde kids) ou ID' },
  };

  const mkTab = () => ({
    items: [], byId: new Map(), selected: new Set(), loaded: false, companyId: null, lastClicked: null,
    f: { q: '', exact: false, noimg: false, onlysel: false, st: 'all' },
  });
  const state = {
    tab: 'sub',
    tabs: { sub: mkTab(), item: mkTab() },
    hashes: new Map(),      // "kind:id" -> hash
    newImage: null,         // { blob, previewUrl, filename }
    busy: false,
    visibleIds: [],
  };
  const T = () => state.tabs[state.tab];

  // ---------------------------------------------------------------- utilidades
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const cleanUrl = (u) => (u || '').split('?')[0];
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const slug = (s) => norm(s).replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'foto';
  const baseName = (fn) => (fn || '').replace(/\.jpg$/, '');
  const cmpItems = (a, b) => norm(a.name).localeCompare(norm(b.name), 'pt-BR', { numeric: true }) || a.id - b.id;
  const money = (v) => (v == null || v === '' ? '' : 'R$ ' + Number(v).toFixed(2).replace('.', ','));
  const plural = (n, kind) => `${n} ${n === 1 ? KINDS[kind].one : KINDS[kind].many}`;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- API
  function authHeaders() {
    const token = localStorage.getItem('access_token');
    const company = localStorage.getItem('active_company_id');
    if (!token || !company) throw new Error('Não encontrei o login do portal. Entre no Cardápio Web e atualize a página (F5).');
    return { Authorization: token, Companyid: company, Accept: 'application/json' };
  }

  async function getJson(path) {
    const r = await fetch(API + path, { headers: authHeaders(), cache: 'no-store' });
    if (r.status === 401) throw new Error('Sessão expirada. Atualize a página (F5) e abra de novo.');
    let j = null;
    try { j = await r.json(); } catch (_) {}
    if (!r.ok || !Array.isArray(j)) throw new Error('Resposta inesperada do Cardápio Web' + (j && j.message ? `: ${j.message}` : ` (HTTP ${r.status})`));
    return j;
  }

  const fetchSubitems = () => getJson('/api/v1/company/subitems');

  async function fetchProducts() {
    const cats = await getJson('/api/v1/company/categories/menu?full_version=true');
    const out = [];
    const seen = new Set();
    cats.forEach((c) => (Array.isArray(c.items) ? c.items : []).forEach((it) => {
      if (!it || seen.has(it.id)) return;
      seen.add(it.id);
      out.push(Object.assign({}, it, { _cat: c.name || '', _catStatus: c.status }));
    }));
    return out;
  }

  const fetchKind = (kind) => (kind === 'item' ? fetchProducts() : fetchSubitems());

  async function putImage(kind, id, blob, filename) {
    const fd = new FormData();
    fd.append('image', blob, filename);
    const r = await fetch(`${API}/api/v1/company/${KINDS[kind].path}/image/${id}`, { method: 'PUT', headers: authHeaders(), body: fd });
    let j = null;
    try { j = await r.json(); } catch (_) {}
    if (r.status === 401) throw new Error('Sessão expirada (F5)');
    if (r.status !== 200 || (j && j.status === 500)) throw new Error(`HTTP ${r.status}${j && j.message ? ' - ' + j.message : ''}`);
    return j;
  }

  async function removeImage(kind, id) {
    const fd = new FormData();
    fd.append('remove_image', 'true');
    const r = await fetch(`${API}/api/v1/company/${KINDS[kind].path}/image/${id}`, { method: 'PUT', headers: authHeaders(), body: fd });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  }

  // ---------------------------------------------------------------- dados dos itens
  function usedIn(kind, it) {
    if (kind === 'item') return it._cat ? [it._cat] : [];
    const a = Array.isArray(it.add_ons) ? it.add_ons : [];
    const short = (s) => (s.length > 38 ? s.slice(0, 36).trim() + '…' : s);
    return [...new Set(a.map((x) => (x && (x.add_on_name || x.name || x.title)) || '').filter(Boolean))].map(short);
  }

  function statusInfo(kind, it) {
    const s = it.status;
    const label = s === 'ACTIVE' ? 'Ativo' : s === 'INACTIVE' ? 'Inativo' : s === 'MISSING' ? 'Em falta' : (s || '?');
    const cls = s === 'ACTIVE' ? 'on' : s === 'MISSING' ? 'miss' : 'off';
    let note = '';
    if (kind === 'item' && it._catStatus && it._catStatus !== 'ACTIVE') note = 'categoria inativa';
    if (kind === 'sub') {
      const a = Array.isArray(it.add_ons) ? it.add_ons : [];
      if (!a.length) note = 'fora de complementos';
      else if (a.every((x) => x && x.add_on_status && x.add_on_status !== 'ACTIVE')) note = 'complemento inativo';
    }
    return { label, cls, note };
  }

  function setItems(kind, items) {
    const tab = state.tabs[kind];
    tab.items = items.slice().sort(cmpItems);
    tab.byId = new Map(tab.items.map((it) => [it.id, it]));
    [...tab.selected].forEach((id) => { if (!tab.byId.has(id)) tab.selected.delete(id); });
  }

  // ---------------------------------------------------------------- "mesma foto" (hash visual)
  async function hashOf(url) {
    const blob = await (await fetch(url)).blob();
    const bm = await createImageBitmap(blob);
    const c = new OffscreenCanvas(9, 8);
    const ctx = c.getContext('2d');
    ctx.drawImage(bm, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
    return bits;
  }
  const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

  async function ensureHashes(kind, items) {
    const key = (it) => `${kind}:${it.id}`;
    const todo = items.filter((it) => it.image_url && !state.hashes.has(key(it)));
    let done = 0;
    const queue = todo.slice();
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try { state.hashes.set(key(it), await hashOf(it.thumbnail_url || it.image_url)); }
        catch (_) { state.hashes.set(key(it), null); }
        done++;
        if (todo.length > 20 && done % 10 === 0) setStatus(`Comparando fotos… ${done}/${todo.length}`);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  // ---------------------------------------------------------------- imagens
  function loadImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Não consegui abrir essa imagem (formato não suportado?)')); };
      img.src = url;
    });
  }

  function centerSquare(img) {
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    return { x: (img.naturalWidth - size) / 2, y: (img.naturalHeight - size) / 2, size };
  }

  async function squareBlob(img, area) {
    const c = document.createElement('canvas');
    c.width = OUT_SIZE; c.height = OUT_SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, area.x, area.y, area.size, area.size, 0, 0, OUT_SIZE, OUT_SIZE);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Falha ao gerar a foto.');
    return blob;
  }

  // ---------------------------------------------------------------- UI
  const host = document.createElement('div');
  host.id = HOST_ID;
  // fixo e sem tamanho: não interfere no layout de onde estiver encaixado
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;display:block;';
  const HOME = document.documentElement;
  HOME.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .fab { position: fixed; right: 20px; bottom: 96px; z-index: 2147483000; background: #111616; color: #6BEA57; border: 2px solid #6BEA57;
      border-radius: 999px; padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
    .fab:hover { background: #6BEA57; color: #111616; }
    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: 600px; max-width: 100vw; z-index: 2147483001; background: #fff; color: #111616;
      box-shadow: -8px 0 30px rgba(0,0,0,.25); display: none; flex-direction: column; }
    .panel.open { display: flex; }
    header { background: #111616; color: #fff; padding: 14px 16px 6px; display: flex; align-items: center; justify-content: space-between; }
    header b { color: #6BEA57; }
    header button { background: none; border: 0; color: #fff; font-size: 22px; cursor: pointer; line-height: 1; }
    .tabs { display: flex; background: #111616; padding: 0 12px; }
    .tab { flex: 1; background: none; border: 0; color: #cfd6ce; padding: 10px 8px; font-size: 13px; font-weight: 700; cursor: pointer; border-bottom: 3px solid transparent; }
    .tab.on { color: #6BEA57; border-bottom-color: #6BEA57; }
    .tab .n { font-weight: 600; opacity: .7; font-size: 11px; margin-left: 4px; }
    .section { padding: 10px 16px; border-bottom: 1px solid #E0E4DF; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    input[type=text] { flex: 1; min-width: 160px; padding: 9px 10px; border: 1px solid #c9cfc8; border-radius: 8px; font-size: 14px; color: #111616; background: #fff; }
    input[type=text]:focus { outline: 2px solid #6BEA57; border-color: #4DAD3D; }
    select { padding: 5px 8px; border: 1px solid #c9cfc8; border-radius: 8px; font-size: 12px; background: #fff; color: #111616; }
    label.chk { font-size: 12px; display: flex; gap: 4px; align-items: center; cursor: pointer; user-select: none; }
    .btn { border: 1px solid #c9cfc8; background: #fff; color: #111616; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn:hover { border-color: #4DAD3D; }
    .btn.primary { background: #6BEA57; border-color: #4DAD3D; color: #111616; }
    .btn.primary:hover { background: #4DAD3D; color: #fff; }
    .btn.dark { background: #111616; border-color: #111616; color: #6BEA57; }
    .btn.dark:hover { background: #2a3232; }
    .btn.danger { color: #b42318; border-color: #f0b8b3; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .shown { font-size: 11px; color: #6b7280; margin-left: auto; }
    .status { font-size: 12px; color: #4b5563; padding: 6px 16px; min-height: 26px; background: #f6f8f6; border-bottom: 1px solid #E0E4DF; }
    .status.err { color: #b42318; background: #fff1f0; }
    .status.ok { color: #1f6f14; background: #effbec; }
    .listwrap { flex: 1; display: flex; min-height: 0; }
    .list { flex: 1; overflow: auto; position: relative; }
    .az { width: 24px; flex: none; display: flex; flex-direction: column; align-items: stretch; overflow: hidden; border-left: 1px solid #E0E4DF; background: #fafbfa; padding: 2px 0; }
    .az button { flex: 1 1 0; min-height: 0; max-height: 22px; border: 0; background: none; font-size: 10px; font-weight: 800; color: #111616; padding: 0; cursor: pointer; line-height: 1; }
    .az button:disabled { color: #c9cfc8; cursor: default; }
    .az button:not(:disabled):hover { background: #6BEA57; }
    .letter { position: sticky; top: 0; z-index: 1; background: #111616; color: #6BEA57; font-size: 11px; font-weight: 800; padding: 3px 16px; letter-spacing: .06em; }
    .item { display: grid; grid-template-columns: 22px 52px 1fr auto; gap: 10px; align-items: center; padding: 8px 16px; border-bottom: 1px solid #f0f2ef; cursor: pointer; user-select: none; }
    .item:hover { background: #f8faf8; }
    .item.sel { background: #effbec; }
    .item input { pointer-events: none; }
    .item.inactive > img, .item.inactive > .ph { opacity: .5; filter: grayscale(.7); }
    .item img, .ph { width: 52px; height: 52px; border-radius: 8px; object-fit: cover; background: #E0E4DF; display: block; }
    .ph { display: flex; align-items: center; justify-content: center; font-size: 10px; color: #6b7280; text-align: center; }
    .name { font-size: 13px; font-weight: 700; }
    .meta { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .note { color: #b54708; font-weight: 600; }
    .badge { display: inline-block; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-left: 6px; vertical-align: 1px; letter-spacing: .02em; }
    .badge.on { background: #e3f9df; color: #1f6f14; }
    .badge.off { background: #eceeec; color: #4b5563; }
    .badge.miss { background: #fff1e0; color: #b54708; }
    .same { font-size: 11px; padding: 5px 8px; }
    .empty { padding: 30px 16px; text-align: center; color: #6b7280; font-size: 13px; }
    footer { padding: 10px 16px; border-top: 1px solid #E0E4DF; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .count { font-size: 13px; font-weight: 700; }
    .newimg { display: flex; gap: 10px; align-items: center; }
    .newimg img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; border: 2px solid #6BEA57; }
    .modal-bg { position: fixed; inset: 0; background: rgba(17,22,22,.6); z-index: 2147483002; display: none; align-items: center; justify-content: center; }
    .modal-bg.open { display: flex; }
    #cropModal { z-index: 2147483005; }
    #confirmModal { z-index: 2147483004; }
    .modal { background: #fff; color: #111616; border-radius: 14px; width: 560px; max-width: 94vw; max-height: 92vh; overflow: auto; padding: 18px; }
    .modal h3 { margin: 0 0 10px; font-size: 16px; }
    .modal p { font-size: 13px; margin: 6px 0; }
    .crop-wrap { position: relative; width: 420px; height: 420px; max-width: 100%; margin: 8px auto; background: #222; user-select: none; touch-action: none; }
    .crop-wrap canvas { position: absolute; inset: 0; cursor: move; }
    input[type=range] { width: 100%; accent-color: #4DAD3D; }
    .plist { max-height: 320px; overflow: auto; border: 1px solid #E0E4DF; border-radius: 8px; margin: 8px 0; }
    .prow { display: flex; gap: 8px; align-items: center; padding: 6px 8px; font-size: 12px; border-bottom: 1px solid #f0f2ef; }
    .prow img, .prow .ph { width: 34px; height: 34px; flex: none; }
    .prow .to { color: #9aa39a; font-weight: 800; }
    .log { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; background: #f6f8f6; padding: 8px; border-radius: 8px; max-height: 260px; overflow: auto; }
    .hint { font-size: 11px; color: #6b7280; }
    .warn { font-size: 12px; color: #b54708; }

    /* distribuir */
    .modal.wide { width: 1000px; max-width: 96vw; height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
    .dhead { display: flex; justify-content: space-between; align-items: center; }
    .dhead h3 { margin: 0; }
    .x { background: none; border: 0; font-size: 24px; line-height: 1; cursor: pointer; color: #111616; }
    .dgrid { flex: 1; min-height: 0; display: grid; grid-template-columns: 270px 1fr; gap: 12px; margin-top: 10px; }
    .tray-col { display: flex; flex-direction: column; min-height: 0; gap: 8px; }
    .drop { border: 2px dashed #4DAD3D; border-radius: 10px; padding: 12px; text-align: center; font-size: 12px; color: #1f6f14; background: #f4fdf2; }
    .drop.over { background: #dcf8d5; }
    .drop .btn { margin-top: 6px; }
    .tray { flex: 1; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-content: start; padding: 2px; }
    .timg { border: 2px solid #E0E4DF; border-radius: 10px; padding: 5px; background: #fff; cursor: grab; position: relative; }
    .timg:hover { border-color: #4DAD3D; }
    .timg.armed { border-color: #6BEA57; box-shadow: 0 0 0 3px rgba(107,234,87,.4); }
    .timg img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; display: block; pointer-events: none; }
    .tname { font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
    .tuse { font-size: 10px; color: #6b7280; }
    .tuse.used { color: #1f6f14; font-weight: 700; }
    .tact { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
    .tact button { width: 24px; height: 24px; border-radius: 6px; border: 0; background: rgba(17,22,22,.8); color: #fff; cursor: pointer; font-size: 12px; padding: 0; }
    .tact button:hover { background: #4DAD3D; }
    .slots { overflow: auto; border: 1px solid #E0E4DF; border-radius: 10px; }
    .srow { display: grid; grid-template-columns: 44px 1fr 16px 76px; gap: 10px; align-items: center; padding: 10px 14px 12px 10px; border-bottom: 1px solid #f0f2ef; }
    .srow.over { background: #effbec; }
    .srow.armed-target { cursor: copy; }
    .srow.armed-target:hover { background: #f4fdf2; }
    .srow > img, .srow > .ph { width: 44px; height: 44px; }
    .arrow { color: #9aa39a; font-weight: 800; text-align: center; }
    .slot { width: 72px; height: 72px; border: 2px dashed #c9cfc8; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #6b7280;
      text-align: center; position: relative; background: #fafbfa; }
    .srow.over .slot { border-color: #4DAD3D; background: #dcf8d5; }
    .slot.filled { border-style: solid; border-color: #6BEA57; background: #fff; }
    .slot.filled img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; display: block; }
    .slot.auto { border-color: #f5b041; }
    .slot .clr { position: absolute; top: -9px; right: -9px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: #111616; color: #fff; font-size: 12px; cursor: pointer; line-height: 20px; padding: 0; }
    .chip { position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%); background: #f5b041; color: #111616; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
    .dfoot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .dmsg { font-size: 12px; font-weight: 600; }
  </style>

  <button class="fab" id="fab">Fotos em massa</button>

  <div class="panel" id="panel">
    <header>
      <div><b>FlyTo</b> · Fotos em massa</div>
      <button id="close" title="Fechar">×</button>
    </header>
    <div class="tabs">
      <button class="tab on" data-tab="sub">Opções<span class="n" id="n-sub"></span></button>
      <button class="tab" data-tab="item">Produtos<span class="n" id="n-item"></span></button>
    </div>

    <div class="section">
      <div class="row">
        <input type="text" id="q" autocomplete="off" spellcheck="false" placeholder="" />
        <button class="btn" id="reload" title="Recarregar lista do Cardápio Web">Recarregar</button>
      </div>
      <div class="row" style="margin-top:8px">
        <select id="stf" title="Filtrar por status">
          <option value="all">Todos os status</option>
          <option value="on">Só ativos</option>
          <option value="off">Só inativos / em falta</option>
        </select>
        <label class="chk"><input type="checkbox" id="exact" /> Nome exato</label>
        <label class="chk"><input type="checkbox" id="noimg" /> Só sem foto</label>
        <label class="chk"><input type="checkbox" id="onlysel" /> Só selecionados</label>
        <span class="shown" id="shown"></span>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn" id="selall">Selecionar todos da busca</button>
        <button class="btn" id="clear">Limpar seleção</button>
        <button class="btn danger" id="undo">Desfazer última troca</button>
      </div>
    </div>

    <div class="status" id="status">Carregando…</div>
    <div class="listwrap">
      <div class="list" id="list"></div>
      <div class="az" id="az"></div>
    </div>

    <footer>
      <div class="newimg" id="newimg"><span class="hint">Nenhuma foto escolhida</span></div>
      <span class="count" id="count">0 selecionadas</span>
      <div class="row">
        <input type="file" id="file" accept="image/*" style="display:none" />
        <button class="btn" id="pick" title="Uma foto para todos os selecionados">Escolher foto</button>
        <button class="btn primary" id="apply" disabled>Aplicar</button>
        <button class="btn dark" id="dist" disabled title="Várias fotos: você arrasta cada uma para o item certo">Distribuir fotos</button>
      </div>
    </footer>
  </div>

  <div class="modal-bg" id="distModal">
    <div class="modal wide">
      <div class="dhead">
        <h3 id="distTitle">Distribuir fotos</h3>
        <button class="x" id="distClose" title="Fechar (as fotos ficam guardadas)">×</button>
      </div>
      <p class="hint">Adicione as fotos e arraste cada uma para o item certo — ou clique numa foto e depois nos itens. Fotos com nome de arquivo igual ao do item já entram sugeridas (borda laranja). Ao colocar uma foto num item, os outros selecionados com o <b>mesmo nome</b> que estiverem vazios recebem a mesma foto.</p>
      <div class="dgrid">
        <div class="tray-col">
          <div class="drop" id="trayDrop">
            Solte as fotos aqui<br>
            <button class="btn" id="distPick">Escolher fotos</button>
            <input type="file" id="distFile" accept="image/*" multiple style="display:none" />
          </div>
          <div class="tray" id="tray"></div>
        </div>
        <div class="slots" id="slots"></div>
      </div>
      <div class="dfoot">
        <span class="dmsg" id="distCount"></span>
        <div class="row">
          <button class="btn" id="distAuto">Sugerir pelo nome do arquivo</button>
          <button class="btn" id="distClear">Limpar associações</button>
          <button class="btn primary" id="distApply" disabled>Aplicar</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-bg" id="confirmModal">
    <div class="modal" id="confirmBody"></div>
  </div>

  <div class="modal-bg" id="cropModal">
    <div class="modal">
      <h3>Cortar foto (quadrada, 700×700)</h3>
      <p class="hint">Arraste o quadrado para posicionar. Use a barra para aumentar ou diminuir.</p>
      <div class="crop-wrap" id="cropWrap"><canvas id="cropCanvas" width="420" height="420"></canvas></div>
      <input type="range" id="cropSize" min="20" max="100" value="100" />
      <p class="warn" id="cropWarn"></p>
      <div class="row" style="justify-content:flex-end; margin-top:8px">
        <button class="btn" id="cropCancel">Cancelar</button>
        <button class="btn primary" id="cropOk">Usar esta foto</button>
      </div>
    </div>
  </div>
  `;

  const $ = (id) => root.getElementById(id);
  const panel = $('panel');
  const isOpen = (id) => $(id).classList.contains('open');

  function setStatus(msg, kind) {
    const s = $('status');
    s.textContent = msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  function thumbEl(url, size) {
    if (url) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = url;
      if (size) { img.style.width = size + 'px'; img.style.height = size + 'px'; }
      return img;
    }
    const d = el('div', 'ph', 'sem foto');
    if (size) { d.style.width = size + 'px'; d.style.height = size + 'px'; }
    return d;
  }

  function badgeEl(kind, it) {
    const s = statusInfo(kind, it);
    return el('span', 'badge ' + s.cls, s.label);
  }

  // ---------------------------------------------------------------- encaixe na tela (corrige a busca)
  // Quando o portal está com uma janela (Dialog do Material-UI) aberta, ela "prende" o foco do teclado
  // e devolve o foco para si a cada 50 ms — por isso não dava para digitar na busca do painel.
  // Solução: enquanto o painel estiver aberto, o painel fica DENTRO da janela aberta do portal,
  // então o portal entende que o foco continua nela.
  function topModalTarget() {
    if (!document.body) return null;
    const roots = document.body.querySelectorAll(':scope > [role="presentation"]');
    for (let i = roots.length - 1; i >= 0; i--) {
      const r = roots[i];
      if (r.getAttribute('aria-hidden') === 'true') continue;
      const cs = getComputedStyle(r);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      return r.querySelector(':scope > [tabindex="-1"]') || r;
    }
    return null;
  }

  function placeHost() {
    const want = (panel.classList.contains('open') && topModalTarget()) || HOME;
    if (host.parentNode === want && host.isConnected) return;
    const f = root.activeElement;
    let sel = null;
    try { if (f && typeof f.selectionStart === 'number') sel = [f.selectionStart, f.selectionEnd]; } catch (_) {}
    want.appendChild(host);
    if (f && f.isConnected) {
      try { f.focus({ preventScroll: true }); if (sel) f.setSelectionRange(sel[0], sel[1]); } catch (_) {}
    }
  }
  new MutationObserver(() => placeHost()).observe(document.body || HOME, { childList: true });
  setInterval(() => { if (panel.classList.contains('open') || !host.isConnected) placeHost(); }, 400);

  // impede que atalhos/handlers do portal capturem o que acontece dentro do painel
  ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'mousedown', 'mouseup', 'click', 'dblclick',
    'pointerdown', 'pointerup', 'focusin', 'focusout', 'dragstart', 'dragenter', 'dragover', 'dragleave', 'drop']
    .forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));

  // ---------------------------------------------------------------- abas e filtros
  function saveFilters() {
    T().f = { q: $('q').value, exact: $('exact').checked, noimg: $('noimg').checked, onlysel: $('onlysel').checked, st: $('stf').value };
  }
  function restoreFilters() {
    const f = T().f;
    $('q').value = f.q; $('exact').checked = f.exact; $('noimg').checked = f.noimg; $('onlysel').checked = f.onlysel; $('stf').value = f.st;
    $('q').placeholder = KINDS[state.tab].ph;
  }

  function switchTab(kind) {
    if (kind === state.tab) return;
    saveFilters();
    state.tab = kind;
    root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === kind));
    restoreFilters();
    const tab = T();
    const company = localStorage.getItem('active_company_id');
    if (!tab.loaded || tab.companyId !== company) { $('list').textContent = ''; $('az').textContent = ''; load(kind); }
    else { renderList(); summary(); }
    updateFooter();
  }

  function updateTabCounts() {
    ['sub', 'item'].forEach((k) => { const t = state.tabs[k]; $('n-' + k).textContent = t.loaded ? `(${t.items.length})` : ''; });
  }

  function matches(it, q, exact) {
    const n = norm(it.name);
    if (exact) return n === q;
    if (/^\d+$/.test(q) && String(it.id) === q) return true;
    return q.split(' ').every((w) => n.includes(w));
  }

  function filtered() {
    const tab = T();
    const q = norm($('q').value);
    const exact = $('exact').checked;
    const noimg = $('noimg').checked;
    const onlysel = $('onlysel').checked;
    const st = $('stf').value;
    return tab.items.filter((it) => {
      if (q && !matches(it, q, exact)) return false;
      if (noimg && it.image_url) return false;
      if (onlysel && !tab.selected.has(it.id)) return false;
      if (st === 'on' && it.status !== 'ACTIVE') return false;
      if (st === 'off' && it.status === 'ACTIVE') return false;
      return true;
    });
  }

  const letterOf = (name) => { const c = norm(name).charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };

  // ---------------------------------------------------------------- lista (todos, sem limite)
  const rowEls = new Map();
  const firstRowOf = new Map();

  function buildRow(kind, it, sel) {
    const s = statusInfo(kind, it);
    const row = el('div', 'item' + (sel ? ' sel' : '') + (s.cls !== 'on' || s.note ? ' inactive' : ''));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel;
    cb.tabIndex = -1;
    const info = el('div');
    const nm = el('div', 'name', it.name);
    nm.appendChild(badgeEl(kind, it));
    const meta = el('div', 'meta');
    const used = usedIn(kind, it);
    const parts = [`ID ${it.id}`];
    if (kind === 'item') { if (used.length) parts.push(used[0]); }
    else if (used.length) parts.push('em: ' + used.slice(0, 3).join(', ') + (used.length > 3 ? ` (+${used.length - 3})` : ''));
    if (it.price != null) parts.push(money(it.price));
    meta.textContent = parts.join(' · ');
    if (s.note) { const n = el('span', 'note', ' · ' + s.note); meta.appendChild(n); }
    info.append(nm, meta);
    const same = el('button', 'btn same', 'Mesma foto');
    same.title = 'Seleciona, dentro da busca atual, todos com esta mesma foto';
    same.disabled = !it.image_url;
    same.addEventListener('click', (e) => { e.stopPropagation(); selectSamePhoto(kind, it); });
    row.append(cb, thumbEl(it.thumbnail_url || it.image_url), info, same);
    row.addEventListener('click', (e) => onRowClick(it.id, e));
    return row;
  }

  function renderList() {
    const kind = state.tab;
    const tab = T();
    const list = $('list');
    const keep = list.scrollTop;
    list.textContent = '';
    rowEls.clear();
    firstRowOf.clear();
    const items = filtered();
    state.visibleIds = items.map((it) => it.id);
    const frag = document.createDocumentFragment();
    let cur = null;
    items.forEach((it) => {
      const L = letterOf(it.name);
      if (L !== cur) {
        cur = L;
        frag.appendChild(el('div', 'letter', L));
      }
      const row = buildRow(kind, it, tab.selected.has(it.id));
      if (!firstRowOf.has(L)) firstRowOf.set(L, row);
      rowEls.set(it.id, row);
      frag.appendChild(row);
    });
    if (!items.length && tab.loaded) frag.appendChild(el('div', 'empty', 'Nada encontrado com esses filtros.'));
    list.appendChild(frag);
    list.scrollTop = keep;
    renderAZ();
    $('shown').textContent = tab.loaded ? `Mostrando ${items.length} de ${tab.items.length}` : '';
    updateFooter();
    return items.length;
  }

  function renderAZ() {
    const az = $('az');
    az.textContent = '';
    ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].forEach((L) => {
      const b = el('button', null, L);
      const row = firstRowOf.get(L);
      b.disabled = !row;
      b.title = row ? `Ir para ${L}` : '';
      b.addEventListener('click', () => {
        const r = firstRowOf.get(L);
        if (r) $('list').scrollTop = Math.max(0, r.offsetTop - 22);
      });
      az.appendChild(b);
    });
  }

  function refreshRow(id) {
    const r = rowEls.get(id);
    if (!r) return;
    const on = T().selected.has(id);
    r.classList.toggle('sel', on);
    r.querySelector('input').checked = on;
  }

  function onRowClick(id, e) {
    const tab = T();
    const changed = [];
    if (e.shiftKey && tab.lastClicked != null) {
      // Shift+clique seleciona o intervalo inteiro
      const ids = state.visibleIds;
      const a = ids.indexOf(tab.lastClicked), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [s, t] = a < b ? [a, b] : [b, a];
        for (let i = s; i <= t; i++) { tab.selected.add(ids[i]); changed.push(ids[i]); }
      }
    } else {
      if (tab.selected.has(id)) tab.selected.delete(id); else tab.selected.add(id);
      changed.push(id);
    }
    tab.lastClicked = id;
    if ($('onlysel').checked) renderList();
    else { changed.forEach(refreshRow); updateFooter(); }
  }

  function updateFooter() {
    const k = KINDS[state.tab];
    const n = T().selected.size;
    $('count').textContent = `${n} ${n === 1 ? k.one + ' ' + k.sel1 : k.many + ' ' + k.selN}`;
    $('apply').disabled = state.busy || !n || !state.newImage;
    $('dist').disabled = state.busy || !n;
  }

  function summary() {
    const kind = state.tab;
    const tab = T();
    const ativos = tab.items.filter((i) => i.status === 'ACTIVE').length;
    const semFoto = tab.items.filter((i) => !i.image_url).length;
    setStatus(`${plural(tab.items.length, kind)}: ${ativos} ativo(s), ${tab.items.length - ativos} inativo(s)/em falta, ${semFoto} sem foto.`);
  }

  async function selectSamePhoto(kind, ref) {
    const items = filtered();
    setStatus('Comparando fotos…');
    await ensureHashes(kind, items.concat([ref]));
    const h = state.hashes.get(`${kind}:${ref.id}`);
    if (!h) { setStatus('Não consegui ler a foto deste item.', 'err'); return; }
    const tab = state.tabs[kind];
    let n = 0;
    items.forEach((it) => {
      const h2 = state.hashes.get(`${kind}:${it.id}`);
      if (h2 && hamming(h, h2) <= HASH_TOLERANCE) { tab.selected.add(it.id); n++; }
    });
    if (kind === state.tab) renderList();
    setStatus(`${n} item(ns) da busca atual com a mesma foto foram selecionados. Confira a lista antes de aplicar.`, 'ok');
  }

  async function load(kind = state.tab) {
    const tab = state.tabs[kind];
    try {
      if (kind === state.tab) setStatus(`Carregando ${KINDS[kind].many} do Cardápio Web…`);
      const items = await fetchKind(kind);
      tab.companyId = localStorage.getItem('active_company_id');
      setItems(kind, items);
      tab.loaded = true;
      updateTabCounts();
      if (kind === state.tab) { renderList(); summary(); }
    } catch (e) {
      if (kind === state.tab) setStatus(e.message, 'err');
    }
  }

  // ---------------------------------------------------------------- recorte
  const crop = { img: null, scale: 1, ox: 0, oy: 0, size: 0, x: 0, y: 0, drag: null, onDone: null, srcName: '' };

  async function openCrop(file, onDone) {
    let img;
    try { img = await loadImage(file); }
    catch (e) { setStatus(e.message, 'err'); return; }
    crop.img = img;
    crop.srcName = file.name || 'foto';
    crop.onDone = onDone;
    const W = 420;
    crop.scale = Math.min(W / img.naturalWidth, W / img.naturalHeight);
    crop.dw = img.naturalWidth * crop.scale;
    crop.dh = img.naturalHeight * crop.scale;
    crop.ox = (W - crop.dw) / 2;
    crop.oy = (W - crop.dh) / 2;
    crop.size = 0;
    $('cropSize').value = 100;
    setCropSize(100, true);
    $('cropModal').classList.add('open');
  }

  function setCropSize(pct, center) {
    const max = Math.min(crop.img.naturalWidth, crop.img.naturalHeight);
    const old = crop.size;
    crop.size = Math.max(20, Math.round((max * pct) / 100));
    if (center || !old) {
      crop.x = (crop.img.naturalWidth - crop.size) / 2;
      crop.y = (crop.img.naturalHeight - crop.size) / 2;
    } else {
      crop.x += (old - crop.size) / 2;
      crop.y += (old - crop.size) / 2;
    }
    clampCrop();
    drawCrop();
  }

  function clampCrop() {
    crop.x = Math.min(Math.max(0, crop.x), crop.img.naturalWidth - crop.size);
    crop.y = Math.min(Math.max(0, crop.y), crop.img.naturalHeight - crop.size);
  }

  function drawCrop() {
    const c = $('cropCanvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(crop.img, crop.ox, crop.oy, crop.dw, crop.dh);
    const bx = crop.ox + crop.x * crop.scale, by = crop.oy + crop.y * crop.scale, bs = crop.size * crop.scale;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, c.width, by);
    ctx.fillRect(0, by + bs, c.width, c.height - by - bs);
    ctx.fillRect(0, by, bx, bs);
    ctx.fillRect(bx + bs, by, c.width - bx - bs, bs);
    ctx.strokeStyle = '#6BEA57';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bs, bs);
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(bx + (bs * i) / 3, by); ctx.lineTo(bx + (bs * i) / 3, by + bs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by + (bs * i) / 3); ctx.lineTo(bx + bs, by + (bs * i) / 3); ctx.stroke();
    }
    $('cropWarn').textContent = crop.size < 400 ? `Atenção: a área escolhida tem só ${Math.round(crop.size)}px; a foto pode ficar sem nitidez.` : '';
  }

  function canvasPoint(e) {
    const r = $('cropCanvas').getBoundingClientRect();
    const k = $('cropCanvas').width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  $('cropCanvas').addEventListener('pointerdown', (e) => {
    const p = canvasPoint(e);
    crop.drag = { px: p.x, py: p.y, x: crop.x, y: crop.y };
    $('cropCanvas').setPointerCapture(e.pointerId);
  });
  $('cropCanvas').addEventListener('pointermove', (e) => {
    if (!crop.drag) return;
    const p = canvasPoint(e);
    crop.x = crop.drag.x + (p.x - crop.drag.px) / crop.scale;
    crop.y = crop.drag.y + (p.y - crop.drag.py) / crop.scale;
    clampCrop();
    drawCrop();
  });
  const endDrag = () => { crop.drag = null; };
  $('cropCanvas').addEventListener('pointerup', endDrag);
  $('cropCanvas').addEventListener('pointercancel', endDrag);
  $('cropSize').addEventListener('input', (e) => setCropSize(+e.target.value, false));
  const closeCrop = () => { $('cropModal').classList.remove('open'); $('file').value = ''; crop.onDone = null; };
  $('cropCancel').addEventListener('click', closeCrop);

  $('cropOk').addEventListener('click', async () => {
    let blob;
    try { blob = await squareBlob(crop.img, crop); }
    catch (e) { setStatus(e.message, 'err'); return; }
    const cb = crop.onDone;
    const name = crop.srcName, size = crop.size;
    closeCrop();
    if (cb) cb(blob, name, size);
  });

  // foto única para todos os selecionados
  function setNewImage(blob, srcName) {
    if (state.newImage) URL.revokeObjectURL(state.newImage.previewUrl);
    // nome único evita que o navegador/CDN mostre a foto antiga em cache
    const filename = `${slug(srcName)}-${Date.now()}.jpg`;
    state.newImage = { blob, previewUrl: URL.createObjectURL(blob), filename };
    const box = $('newimg');
    box.textContent = '';
    const img = document.createElement('img');
    img.src = state.newImage.previewUrl;
    box.append(img, el('span', 'hint', `Foto pronta (${Math.round(blob.size / 1024)} KB)`));
    updateFooter();
  }

  // ---------------------------------------------------------------- confirmação / aplicar
  function openConfirm(build) {
    const body = $('confirmBody');
    body.textContent = '';
    build(body);
    $('confirmModal').classList.add('open');
  }
  const closeConfirm = () => $('confirmModal').classList.remove('open');

  // linhas: [{ id, name, oldUrl, newUrl }]
  function previewRows(rows) {
    const box = el('div', 'plist');
    rows.forEach((r) => {
      const p = el('div', 'prow');
      p.append(thumbEl(r.oldUrl, 34));
      if (r.newUrl !== undefined) p.append(el('span', 'to', '→'), thumbEl(r.newUrl, 34));
      p.append(el('span', null, `${r.name || '(item)'} · ID ${r.id}`));
      box.appendChild(p);
    });
    return box;
  }

  function buttonsRow(buttons) {
    const row = el('div', 'row');
    row.style.justifyContent = 'flex-end';
    row.style.marginTop = '10px';
    buttons.forEach(([label, cls, fn]) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; row.appendChild(b); });
    return row;
  }

  // jobs: [{ id, blob, filename, previewUrl }]
  function confirmJobs(kind, jobs, single, onCancel) {
    const tab = state.tabs[kind];
    openConfirm((body) => {
      body.appendChild(el('h3', null, `Trocar a foto de ${plural(jobs.length, kind)}?`));
      if (single) {
        const top = el('div', 'newimg');
        const img = document.createElement('img');
        img.src = jobs[0].previewUrl;
        top.append(img, el('p', null, 'Esta foto vai substituir a foto atual de cada item abaixo. Os demais não são tocados. Um backup é salvo antes para você poder desfazer.'));
        body.appendChild(top);
        const names = new Set(jobs.map((j) => norm(tab.byId.get(j.id) && tab.byId.get(j.id).name)));
        if (names.size > 1) body.appendChild(el('p', 'warn', `Atenção: a seleção tem ${names.size} nomes diferentes. Confira se é isso mesmo.`));
      } else {
        body.appendChild(el('p', null, 'Cada item recebe a foto indicada à direita da seta. Os demais não são tocados. Um backup é salvo antes para você poder desfazer.'));
      }
      body.appendChild(previewRows(jobs.map((j) => {
        const it = tab.byId.get(j.id);
        return { id: j.id, name: it && it.name, oldUrl: it && (it.thumbnail_url || it.image_url), newUrl: j.previewUrl };
      })));
      body.appendChild(buttonsRow([
        ['Cancelar', '', () => { closeConfirm(); if (onCancel) onCancel(); }],
        [`Confirmar e trocar ${jobs.length}`, 'primary', () => runJobs(kind, jobs, body)],
      ]));
    });
  }

  $('apply').addEventListener('click', () => {
    if (!state.newImage || !T().selected.size) return;
    const ni = state.newImage;
    const jobs = [...T().selected].map((id) => ({ id, blob: ni.blob, filename: ni.filename, previewUrl: ni.previewUrl }));
    confirmJobs(state.tab, jobs, true);
  });

  function storageGet(key) { return new Promise((res) => chrome.storage.local.get(key, (v) => res(v[key]))); }
  function storageSet(obj) { return new Promise((res) => chrome.storage.local.set(obj, res)); }

  function showResult(body, title, lines, kind) {
    body.textContent = '';
    const log = el('div', 'log');
    log.textContent = lines.join('\n');
    body.append(el('h3', null, title), log, buttonsRow([['Fechar', 'primary', closeConfirm]]));
    setStatus(title + ' Atualize a página (F5) para ver as fotos novas na tela do portal.', kind);
  }

  async function runJobs(kind, jobs, body) {
    const tab = state.tabs[kind];
    state.busy = true;
    updateFooter();
    body.textContent = '';
    const log = el('div', 'log');
    body.append(el('h3', null, 'Trocando fotos… não feche esta aba.'), log);
    const out = (s) => { log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
    const lines = [];
    const push = (s) => { lines.push(s); out(s); };
    try {
      const company = localStorage.getItem('active_company_id');
      if (company !== tab.companyId) throw new Error('A loja ativa mudou desde que a lista foi carregada. Clique em Recarregar e selecione de novo.');

      out('Conferindo a situação atual no Cardápio Web…');
      const fresh = new Map((await fetchKind(kind)).map((it) => [it.id, it]));

      // backup ANTES de qualquer alteração
      const backup = {
        at: new Date().toISOString(),
        companyId: company,
        kind,
        items: jobs.filter((j) => fresh.has(j.id)).map((j) => {
          const it = fresh.get(j.id);
          return { id: j.id, name: it.name, image_url: cleanUrl(it.image_url) || null, raw_image_url: it.image_url || null, newFilename: j.filename };
        }),
      };
      const hist = (await storageGet('history')) || [];
      hist.unshift(backup);
      await storageSet({ history: hist.slice(0, HISTORY_MAX) });
      out(`Backup salvo (${backup.items.length} itens).`);

      let ok = 0, skip = 0, fail = 0;
      const done = [];
      for (const j of jobs) {
        const was = tab.byId.get(j.id);
        const now = fresh.get(j.id);
        if (!now) { push(`PULADO  ${j.id}: não existe mais`); skip++; continue; }
        if (was && norm(now.name) !== norm(was.name)) { push(`PULADO  ${j.id}: nome mudou para "${now.name}"`); skip++; continue; }
        if (was && cleanUrl(now.image_url) !== cleanUrl(was.image_url)) { push(`PULADO  ${j.id} ${now.name}: a foto foi alterada por outra pessoa/aba depois que a lista carregou`); skip++; continue; }
        try {
          await putImage(kind, j.id, j.blob, j.filename);
          done.push(j);
          ok++;
          push(`OK      ${j.id} ${now.name}`);
        } catch (e) {
          fail++;
          push(`ERRO    ${j.id} ${now.name}: ${e.message}`);
          if (/Sessão expirada/.test(e.message)) { push('Parei: sessão expirada. Atualize a página (F5) e repita para os que faltaram.'); break; }
        }
        await sleep(DELAY_MS);
      }

      out('Verificando no Cardápio Web…');
      const after = new Map((await fetchKind(kind)).map((it) => [it.id, it]));
      const notApplied = done.filter((j) => !cleanUrl(after.get(j.id) && after.get(j.id).image_url).includes(baseName(j.filename)));
      if (notApplied.length) lines.push(`ATENÇÃO: ${notApplied.length} não confirmados na verificação: ${notApplied.map((j) => j.id).join(', ')}`);

      // atualiza a lista local
      setItems(kind, [...after.values()]);
      state.hashes.clear();
      tab.selected.clear();
      if (dist.kind === kind) done.forEach((j) => { dist.assign.delete(j.id); dist.auto.delete(j.id); });
      updateTabCounts();
      if (kind === state.tab) renderList();

      const title = `Concluído: ${ok} trocado(s), ${skip} pulado(s), ${fail} erro(s).`;
      lines.unshift(title, '');
      showResult(body, title, lines, fail || notApplied.length ? 'err' : 'ok');
    } catch (e) {
      lines.push('Interrompido: ' + e.message);
      showResult(body, 'Interrompido: ' + e.message, lines, 'err');
    } finally {
      state.busy = false;
      updateFooter();
    }
  }

  // ---------------------------------------------------------------- desfazer
  $('undo').addEventListener('click', async () => {
    const hist = (await storageGet('history')) || [];
    const last = hist[0];
    if (!last) { setStatus('Não há nenhuma troca para desfazer.', 'err'); return; }
    if (last.companyId !== localStorage.getItem('active_company_id')) {
      setStatus('A última troca foi feita em outra loja. Entre na loja certa para desfazer.', 'err');
      return;
    }
    const kind = last.kind || 'sub';
    openConfirm((body) => {
      body.appendChild(el('h3', null, `Desfazer a troca de ${new Date(last.at).toLocaleString('pt-BR')} (${KINDS[kind].many})?`));
      body.appendChild(el('p', null, `Volta a foto anterior de ${plural(last.items.length, kind)}. Só restaura os que ainda estão com a foto colocada naquela troca.`));
      body.appendChild(previewRows(last.items.map((x) => ({ id: x.id, name: x.name, oldUrl: x.raw_image_url }))));
      body.appendChild(buttonsRow([['Cancelar', '', closeConfirm], ['Desfazer', 'danger', () => runUndo(last, body)]]));
    });
  });

  async function runUndo(last, body) {
    const kind = last.kind || 'sub';
    state.busy = true;
    updateFooter();
    body.textContent = '';
    const log = el('div', 'log');
    body.append(el('h3', null, 'Restaurando… não feche esta aba.'), log);
    const lines = [];
    const out = (s) => { lines.push(s); log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
    try {
      const fresh = new Map((await fetchKind(kind)).map((it) => [it.id, it]));
      let ok = 0, skip = 0, fail = 0;
      for (const b of last.items) {
        const now = fresh.get(b.id);
        const fn = b.newFilename || last.filename;
        if (!now) { out(`PULADO  ${b.id}: não existe mais`); skip++; continue; }
        if (!cleanUrl(now.image_url).includes(baseName(fn))) { out(`PULADO  ${b.id} ${now.name}: a foto já foi mudada depois`); skip++; continue; }
        try {
          if (b.image_url) {
            const r = await fetch(b.raw_image_url || b.image_url, { cache: 'no-store' });
            if (!r.ok) throw new Error('não consegui baixar a foto antiga');
            const blob = await r.blob();
            await putImage(kind, b.id, blob, `restaurada-${slug(b.image_url.split('/').pop() || 'foto')}-${Date.now()}.jpg`);
          } else {
            await removeImage(kind, b.id);
          }
          ok++;
          out(`OK      ${b.id} ${now.name}`);
        } catch (e) {
          fail++;
          out(`ERRO    ${b.id} ${now.name}: ${e.message}`);
        }
        await sleep(DELAY_MS);
      }
      if (!fail) {
        const hist = (await storageGet('history')) || [];
        await storageSet({ history: hist.slice(1) });
      }
      state.hashes.clear();
      await load(kind);
      const title = `Desfeito: ${ok} restaurado(s), ${skip} pulado(s), ${fail} erro(s).`;
      showResult(body, title, [title, '', ...lines], fail ? 'err' : 'ok');
    } catch (e) {
      showResult(body, 'Interrompido: ' + e.message, lines, 'err');
    } finally {
      state.busy = false;
      updateFooter();
    }
  }

  // ---------------------------------------------------------------- distribuir fotos
  const dist = { kind: null, targets: [], imgs: [], assign: new Map(), auto: new Set(), armed: null, seq: 0, msg: '' };

  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'a', 'o', 'em', 'na', 'no', 'img', 'foto', 'fotos', 'image', 'imagem',
    'whatsapp', 'wa', 'copia', 'copy', 'final', 'editada', 'jpg', 'jpeg', 'png', 'webp', 'heic']);
  const toks = (s) => norm(s).replace(/\.[a-z0-9]{2,5}$/, '').split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t) && !/^\d{5,}$/.test(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));

  function nameScore(fileName, itemName) {
    const a = toks(fileName), b = toks(itemName);
    if (!a.length || !b.length) return 0;
    if (a.join('') === b.join('')) return 1;
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    A.forEach((t) => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  // para cada item vazio, sugere a foto cujo nome de arquivo mais parece com o nome do item
  function autoMatch(imgs) {
    let n = 0;
    dist.targets.forEach((t) => {
      if (dist.assign.has(t.id)) return;
      let best = null, bestScore = 0;
      imgs.forEach((im) => { const s = nameScore(im.name, t.name); if (s > bestScore) { bestScore = s; best = im; } });
      if (best && bestScore >= AUTO_MATCH_MIN) { dist.assign.set(t.id, best.id); dist.auto.add(t.id); n++; }
    });
    return n;
  }

  // coloca a foto no item e nos outros selecionados vazios com o mesmo nome
  function assign(targetId, imgId) {
    const t = dist.targets.find((x) => x.id === targetId);
    if (!t) return 0;
    dist.assign.set(targetId, imgId);
    dist.auto.delete(targetId);
    let extra = 0;
    const n = norm(t.name);
    dist.targets.forEach((o) => {
      if (o.id !== targetId && !dist.assign.has(o.id) && norm(o.name) === n) { dist.assign.set(o.id, imgId); extra++; }
    });
    dist.msg = extra ? `Também coloquei em mais ${extra} com o mesmo nome "${t.name}".` : '';
    return extra;
  }

  async function addFiles(files, startTargetId) {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!list.length) return;
    dist.msg = `Preparando ${list.length} foto(s)…`;
    renderDistCount();
    const added = [];
    const fails = [];
    for (const f of list) {
      try {
        const img = await loadImage(f);
        const area = centerSquare(img);
        const blob = await squareBlob(img, area);
        const im = { id: ++dist.seq, file: f, name: f.name || `foto-${dist.seq}.jpg`, blob, url: URL.createObjectURL(blob), small: area.size < 400 };
        dist.imgs.push(im);
        added.push(im);
      } catch (_) { fails.push(f.name); }
    }
    let msg = `${added.length} foto(s) adicionada(s).`;
    if (startTargetId != null && added.length) {
      // soltou direto num item: a 1ª vai nele, as demais nos próximos vazios
      assign(startTargetId, added[0].id);
      const start = dist.targets.findIndex((t) => t.id === startTargetId);
      let k = 1;
      for (let i = start + 1; i < dist.targets.length && k < added.length; i++) {
        if (!dist.assign.has(dist.targets[i].id)) { assign(dist.targets[i].id, added[k].id); k++; }
      }
    } else {
      const n = autoMatch(added);
      if (n) msg += ` ${n} item(ns) sugerido(s) pelo nome do arquivo — confira os de borda laranja.`;
    }
    if (fails.length) msg += ` Não consegui abrir: ${fails.join(', ')}.`;
    dist.msg = msg;
    renderDist();
  }

  function bindDrop(elm, onDrop, overEl) {
    const o = overEl || elm;
    elm.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; o.classList.add('over'); });
    elm.addEventListener('dragleave', (e) => { if (!elm.contains(e.relatedTarget)) o.classList.remove('over'); });
    elm.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); o.classList.remove('over'); onDrop(e); });
  }

  function dropPayload(e) {
    const t = e.dataTransfer.getData('text/plain') || '';
    if (t.startsWith('flyto-img:')) return { imgId: +t.slice(10) };
    if (e.dataTransfer.files && e.dataTransfer.files.length) return { files: e.dataTransfer.files };
    return null;
  }

  function openDist() {
    const kind = state.tab;
    const tab = T();
    const targets = [...tab.selected].map((id) => tab.byId.get(id)).filter(Boolean).sort(cmpItems);
    if (!targets.length) return;
    if (dist.kind !== kind) { dist.assign.clear(); dist.auto.clear(); }
    dist.kind = kind;
    dist.targets = targets;
    const ids = new Set(targets.map((t) => t.id));
    [...dist.assign.keys()].forEach((id) => { if (!ids.has(id)) { dist.assign.delete(id); dist.auto.delete(id); } });
    dist.armed = null;
    dist.msg = dist.imgs.length ? '' : 'Comece adicionando as fotos (pode escolher várias de uma vez).';
    renderDist();
    $('distModal').classList.add('open');
  }

  function renderDistCount() {
    const n = dist.targets.filter((t) => dist.assign.has(t.id)).length;
    const autos = dist.targets.filter((t) => dist.auto.has(t.id)).length;
    const armed = dist.imgs.find((im) => im.id === dist.armed);
    let txt = `${n} de ${dist.targets.length} com foto nova` + (autos ? ` · ${autos} sugerido(s)` : '');
    if (armed) txt += ` · Clique nos itens para colocar "${armed.name}"`;
    else if (dist.msg) txt += ` · ${dist.msg}`;
    $('distCount').textContent = txt;
    $('distApply').disabled = !n || state.busy;
    $('distApply').textContent = n ? `Aplicar em ${n}` : 'Aplicar';
  }

  function renderDist() {
    const K = KINDS[dist.kind];
    $('distTitle').textContent = `Distribuir fotos · ${plural(dist.targets.length, dist.kind)} ${dist.targets.length === 1 ? K.sel1 : K.selN}`;
    const imgById = new Map(dist.imgs.map((im) => [im.id, im]));
    const uses = new Map();
    dist.assign.forEach((imgId) => uses.set(imgId, (uses.get(imgId) || 0) + 1));

    // bandeja de fotos
    const tray = $('tray');
    const tKeep = tray.scrollTop;
    tray.textContent = '';
    if (!dist.imgs.length) {
      const h = el('div', 'hint', 'Nenhuma foto ainda.');
      h.style.gridColumn = '1 / -1';
      tray.appendChild(h);
    }
    dist.imgs.forEach((im) => {
      const c = el('div', 'timg' + (dist.armed === im.id ? ' armed' : ''));
      c.draggable = true;
      c.title = 'Arraste para um item, ou clique e depois clique nos itens';
      const img = document.createElement('img');
      img.src = im.url;
      const nm = el('div', 'tname', im.name);
      nm.title = im.name;
      const u = uses.get(im.id) || 0;
      const use = el('div', 'tuse' + (u ? ' used' : ''), u ? `em ${u} item(ns)` : 'ainda não usada');
      c.append(img, nm, use);
      if (im.small) c.appendChild(el('div', 'warn', 'baixa resolução'));
      const act = el('div', 'tact');
      const bc = el('button', null, '✂');
      bc.title = 'Ajustar o corte';
      bc.addEventListener('click', (e) => {
        e.stopPropagation();
        openCrop(im.file, (blob, _n, size) => {
          URL.revokeObjectURL(im.url);
          im.blob = blob;
          im.url = URL.createObjectURL(blob);
          im.small = size < 400;
          renderDist();
        });
      });
      const br = el('button', null, '×');
      br.title = 'Remover esta foto';
      br.addEventListener('click', (e) => {
        e.stopPropagation();
        dist.imgs = dist.imgs.filter((x) => x !== im);
        [...dist.assign.entries()].forEach(([tid, iid]) => { if (iid === im.id) { dist.assign.delete(tid); dist.auto.delete(tid); } });
        if (dist.armed === im.id) dist.armed = null;
        URL.revokeObjectURL(im.url);
        renderDist();
      });
      act.append(bc, br);
      c.appendChild(act);
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'flyto-img:' + im.id); e.dataTransfer.effectAllowed = 'copy'; });
      c.addEventListener('click', () => { dist.armed = dist.armed === im.id ? null : im.id; dist.msg = ''; renderDist(); });
      tray.appendChild(c);
    });
    tray.scrollTop = tKeep;

    // itens selecionados (vagas)
    const slots = $('slots');
    const sKeep = slots.scrollTop;
    slots.textContent = '';
    dist.targets.forEach((t) => {
      const r = el('div', 'srow' + (dist.armed ? ' armed-target' : ''));
      const info = el('div');
      const nm = el('div', 'name', t.name);
      nm.appendChild(badgeEl(dist.kind, t));
      const used = usedIn(dist.kind, t);
      const meta = el('div', 'meta', `ID ${t.id}` + (used.length ? (dist.kind === 'item' ? ' · ' : ' · em: ') + used.slice(0, 2).join(', ') + (used.length > 2 ? '…' : '') : ''));
      info.append(nm, meta);
      const slot = el('div', 'slot');
      const im = imgById.get(dist.assign.get(t.id));
      if (im) {
        slot.classList.add('filled');
        if (dist.auto.has(t.id)) { slot.classList.add('auto'); }
        const img = document.createElement('img');
        img.src = im.url;
        img.title = im.name;
        slot.appendChild(img);
        if (dist.auto.has(t.id)) slot.appendChild(el('span', 'chip', 'sugerida'));
        const clr = el('button', 'clr', '×');
        clr.title = 'Tirar a foto deste item';
        clr.addEventListener('click', (e) => { e.stopPropagation(); dist.assign.delete(t.id); dist.auto.delete(t.id); dist.msg = ''; renderDist(); });
        slot.appendChild(clr);
      } else {
        slot.textContent = 'solte a foto aqui';
      }
      r.append(thumbEl(t.thumbnail_url || t.image_url, 44), info, el('span', 'arrow', '→'), slot);
      r.addEventListener('click', () => {
        if (!dist.armed) return;
        assign(t.id, dist.armed);
        renderDist();
      });
      bindDrop(r, (e) => {
        const p = dropPayload(e);
        if (!p) return;
        if (p.imgId) { assign(t.id, p.imgId); renderDist(); }
        else if (p.files) addFiles(p.files, t.id);
      });
      slots.appendChild(r);
    });
    slots.scrollTop = sKeep;
    renderDistCount();
  }

  bindDrop($('trayDrop'), (e) => { const p = dropPayload(e); if (p && p.files) addFiles(p.files); });
  bindDrop($('tray'), (e) => { const p = dropPayload(e); if (p && p.files) addFiles(p.files); }, $('trayDrop'));
  // soltar fora das áreas não deve abrir a imagem no navegador
  $('distModal').addEventListener('dragover', (e) => e.preventDefault());
  $('distModal').addEventListener('drop', (e) => { e.preventDefault(); const p = dropPayload(e); if (p && p.files) addFiles(p.files); });
  $('distPick').addEventListener('click', () => $('distFile').click());
  $('distFile').addEventListener('change', (e) => { const fs = e.target.files; if (fs && fs.length) addFiles([...fs]); e.target.value = ''; });
  $('distClose').addEventListener('click', () => $('distModal').classList.remove('open'));
  $('distAuto').addEventListener('click', () => {
    if (!dist.imgs.length) { dist.msg = 'Adicione as fotos primeiro.'; renderDistCount(); return; }
    const n = autoMatch(dist.imgs);
    dist.msg = n ? `${n} item(ns) sugerido(s) — confira os de borda laranja.` : 'Nenhum nome de arquivo parecido com os itens vazios.';
    renderDist();
  });
  $('distClear').addEventListener('click', () => { dist.assign.clear(); dist.auto.clear(); dist.armed = null; dist.msg = ''; renderDist(); });
  $('distApply').addEventListener('click', () => {
    const stamp = Date.now();
    const imgById = new Map(dist.imgs.map((im) => [im.id, im]));
    const fname = (im) => `${slug(im.name)}-${stamp}-${im.id}.jpg`;
    const jobs = dist.targets
      .filter((t) => imgById.has(dist.assign.get(t.id)))
      .map((t) => { const im = imgById.get(dist.assign.get(t.id)); return { id: t.id, blob: im.blob, filename: fname(im), previewUrl: im.url }; });
    if (!jobs.length) return;
    $('distModal').classList.remove('open');
    confirmJobs(dist.kind, jobs, false, () => $('distModal').classList.add('open'));
  });

  // ---------------------------------------------------------------- eventos gerais
  $('fab').addEventListener('click', () => {
    panel.classList.add('open');
    $('fab').style.display = 'none';
    placeHost();
    const tab = T();
    if (!tab.loaded || tab.companyId !== localStorage.getItem('active_company_id')) load();
    setTimeout(() => $('q').focus(), 50);
  });
  $('close').addEventListener('click', () => { panel.classList.remove('open'); $('fab').style.display = ''; placeHost(); });
  root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('reload').addEventListener('click', () => { state.hashes.clear(); load(); });
  let t;
  $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { $('list').scrollTop = 0; renderList(); }, 150); });
  ['exact', 'noimg', 'onlysel', 'stf'].forEach((id) => $(id).addEventListener('change', () => { $('list').scrollTop = 0; renderList(); }));
  $('selall').addEventListener('click', () => {
    const items = filtered();
    items.forEach((it) => T().selected.add(it.id));
    renderList();
    setStatus(`${items.length} selecionado(s) pela busca. Confira antes de aplicar.`);
  });
  $('clear').addEventListener('click', () => { T().selected.clear(); renderList(); });
  $('pick').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) openCrop(f, setNewImage); });
  $('dist').addEventListener('click', openDist);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.busy) return;
    if (isOpen('cropModal')) closeCrop();
    else if (isOpen('confirmModal')) closeConfirm();
    else if (isOpen('distModal')) $('distModal').classList.remove('open');
  });
  restoreFilters();
  updateFooter();
})();