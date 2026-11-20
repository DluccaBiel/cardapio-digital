// Undercut · SDR WhatsApp — painel lateral dentro do WhatsApp Web.
// Lê só a conversa ABERTA (nome + telefone), mostra a ficha do lead do SDR e oferece ações.
// Nada é enviado sozinho daqui: envios automáticos são do robô; aqui você insere texto no
// campo de digitação (você aperta Enter) ou pede ao robô para enviar.
// A UI fica num Shadow DOM (não mexe no CSS do WhatsApp) e é montada só com textContent.

;(() => {
  if (window.__undercutSdr) return
  window.__undercutSdr = true

  const api = (path, opts = {}) => chrome.runtime.sendMessage({ type: 'api', path, ...opts })
  const state = { phone: null, name: null, view: null, loading: false, collapsed: false, error: null, manualPhones: {} }

  // -------------------------------------------------------------------------
  // Leitura da conversa aberta
  // -------------------------------------------------------------------------
  function chatName() {
    const header = document.querySelector('#main header')
    if (!header) return null
    const span = header.querySelector('span[dir="auto"][title]') || header.querySelector('span[dir="auto"]')
    return (span?.getAttribute('title') || span?.textContent || '').trim() || null
  }

  const onlyDigits = (s) => String(s || '').replace(/\D/g, '')
  function looksLikePhone(s) {
    const d = onlyDigits(s)
    return d.length >= 10 && d.length <= 15 && /^[+\d\s()-]+$/.test(String(s).trim())
  }

  /** Telefone da conversa: id das mensagens (…_5519999990000@c.us_…), título com número, ou informado à mão. */
  function chatPhone(name) {
    const nodes = document.querySelectorAll('#main [data-id]')
    for (let i = nodes.length - 1; i >= 0 && i >= nodes.length - 40; i--) {
      const m = /(?:true|false)_(\d{10,15})@c\.us/.exec(nodes[i].getAttribute('data-id') || '')
      if (m) return m[1]
    }
    if (name && looksLikePhone(name)) return onlyDigits(name)
    if (name && state.manualPhones[name]) return state.manualPhones[name]
    return null
  }

  // -------------------------------------------------------------------------
  // Campo de digitação do WhatsApp
  // -------------------------------------------------------------------------
  function composer() {
    return document.querySelector('#main footer div[contenteditable="true"]')
  }
  function insertIntoComposer(text) {
    const box = composer()
    if (!box) return toast('Abra uma conversa para inserir o texto.')
    box.focus()
    document.execCommand('selectAll', false)
    document.execCommand('insertText', false, text)
    toast('Texto inserido — revise e aperte Enter para enviar.')
  }

  // Atalhos #reuniao, #proposta… digitados SOZINHOS no campo: mudam a etapa e não são enviados.
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey) return
      const box = composer()
      if (!box || !box.contains(ev.target)) return
      const text = (box.innerText || '').trim().toLowerCase()
      const cmds = state.view?.commands
      if (!cmds || !/^#[\p{L}]+$/u.test(text)) return
      const stage = cmds[text]
      if (!stage) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      document.execCommand('selectAll', false)
      document.execCommand('delete', false)
      patchLead({ stage }, `Etapa → ${stageLabel(stage)}`)
    },
    true,
  )

  // -------------------------------------------------------------------------
  // UI (Shadow DOM)
  // -------------------------------------------------------------------------
  const host = document.createElement('div')
  host.id = 'undercut-sdr-panel'
  host.style.cssText = 'position:fixed;top:0;right:0;height:100vh;z-index:2147483000;'
  const root = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Archivo, system-ui, -apple-system, sans-serif; }
    .wrap { height: 100vh; display: flex; }
    .tab { align-self: center; writing-mode: vertical-rl; transform: rotate(180deg); cursor: pointer; background: #d7141f; color: #fff; border: 0;
           padding: 12px 6px; border-radius: 0 6px 6px 0; font: 700 11px 'JetBrains Mono', monospace; letter-spacing: .14em; }
    .panel { width: 330px; height: 100vh; overflow-y: auto; background: #0b0b0c; color: #ece9e3; border-left: 1px solid #222225; padding: 12px 12px 40px; font-size: 13px; line-height: 1.45; }
    .panel.hidden { display: none; }
    h2 { margin: 0; font-size: 15px; }
    h3 { margin: 16px 0 6px; font: 700 10px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .12em; color: #8e8a86; }
    .muted { color: #8e8a86; font-size: 12px; }
    .row { display: flex; gap: 6px; align-items: center; }
    .between { justify-content: space-between; }
    .card { border: 1px solid #222225; background: #111113; border-radius: 6px; padding: 8px; margin-bottom: 6px; }
    .alert { border-color: rgba(255,59,71,.5); background: rgba(255,59,71,.1); color: #ffb3b8; }
    .ok { color: #34d399; }
    .pill { display: inline-flex; border-radius: 99px; padding: 1px 8px; font: 700 10px 'JetBrains Mono', monospace; text-transform: uppercase; }
    .pill.red { background: rgba(255,59,71,.15); color: #ff6b73; } .pill.green { background: rgba(52,211,153,.12); color: #34d399; } .pill.gray { background: #18181b; color: #8e8a86; }
    select, input, textarea { width: 100%; background: #111113; color: #ece9e3; border: 1px solid #2a2a2e; border-radius: 5px; padding: 6px 8px; font-size: 13px; }
    select:focus, input:focus, textarea:focus { outline: none; border-color: #d7141f; }
    textarea { resize: vertical; min-height: 54px; }
    button { cursor: pointer; border: 1px solid #2a2a2e; background: transparent; color: #cfcbc4; border-radius: 5px; padding: 5px 9px; font-size: 12px; font-weight: 600; }
    button:hover { border-color: #d7141f; color: #fff; }
    button.primary { background: #d7141f; border-color: #d7141f; color: #fff; }
    button.primary:hover { background: #b5121b; }
    button:disabled { opacity: .45; cursor: default; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chips button { font-weight: 500; }
    .note.done { opacity: .5; text-decoration: line-through; }
    .toast { position: fixed; bottom: 18px; right: 18px; background: #1f0d0f; border: 1px solid rgba(215,20,31,.5); color: #ffd9db; padding: 8px 12px; border-radius: 8px; font-size: 12px; max-width: 300px; }
    label.lbl { display: block; font: 700 10px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .1em; color: #8e8a86; margin: 8px 0 3px; }
  `
  root.appendChild(style)
  const wrap = h('div', { class: 'wrap' })
  const tab = h('button', { class: 'tab', title: 'Mostrar/ocultar o painel do SDR' }, 'UNDERCUT SDR')
  const panel = h('div', { class: 'panel' })
  wrap.append(tab, panel)
  root.appendChild(wrap)
  tab.addEventListener('click', () => {
    state.collapsed = !state.collapsed
    panel.classList.toggle('hidden', state.collapsed)
  })

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
      else if (k === 'value') el.value = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
    return el
  }

  let toastTimer = null
  function toast(text) {
    root.querySelector('.toast')?.remove()
    const t = h('div', { class: 'toast' }, text)
    root.appendChild(t)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => t.remove(), 3500)
  }

  const brl = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  const stageLabel = (key) => state.view?.stages?.find((s) => s.key === key)?.label ?? key
  function rel(iso) {
    if (!iso) return '—'
    const diff = Date.parse(iso) - Date.now()
    const abs = Math.abs(diff)
    const txt = abs < 3_600_000 ? `${Math.round(abs / 60_000)} min` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)} h` : `${Math.round(abs / 86_400_000)} d`
    return diff >= 0 ? `em ${txt}` : `há ${txt}`
  }

  // -------------------------------------------------------------------------
  // Dados
  // -------------------------------------------------------------------------
  async function load() {
    const name = chatName()
    const phone = chatPhone(name)
    state.name = name
    if (!name) {
      state.view = null
      state.phone = null
      return render()
    }
    if (phone !== state.phone || !state.view) {
      state.phone = phone
      state.view = null
    }
    if (!phone) return render()
    state.loading = true
    render()
    const r = await api(`/sdr/leads/by-phone?phone=${encodeURIComponent(phone)}`)
    state.loading = false
    if (r.status === 401) state.error = 'Entre na extensão: clique no ícone do Undercut na barra do Chrome.'
    else if (r.status !== 200) state.error = r.json?.error?.message ?? `Erro ${r.status}`
    else {
      state.error = null
      state.view = r.json.data.lead ? r.json.data : { lead: null }
    }
    render()
  }

  async function patchLead(patch, okText) {
    const lead = state.view?.lead
    if (!lead) return
    const r = await api(`/sdr/leads/${lead.id}`, { method: 'PATCH', body: patch, etag: lead.etag })
    if (r.status === 200) {
      state.view = r.json.data
      toast(okText || 'Salvo.')
    } else if (r.status === 409) {
      toast('O lead mudou em outro lugar — recarreguei a ficha.')
      await load()
      return
    } else toast(r.json?.error?.message ?? 'Não consegui salvar.')
    render()
  }

  async function createLead(inbound) {
    const r = await api('/sdr/leads', { method: 'POST', body: { name: state.name || state.phone, phone: state.phone, inbound } })
    if (r.status === 201) {
      state.view = r.json.data
      toast(inbound ? 'Lead adicionado em "Respondeu".' : 'Lead adicionado — o 1º contato entra na fila do robô.')
    } else toast(r.json?.error?.message ?? 'Não consegui adicionar.')
    render()
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  function render() {
    panel.replaceChildren()
    panel.append(h('div', { class: 'row between' }, h('h2', {}, 'SDR · Undercut'), h('button', { onclick: () => load(), title: 'Recarregar' }, '↻')))

    if (state.error) return panel.append(h('div', { class: 'card alert' }, state.error))
    if (!state.name) return panel.append(h('p', { class: 'muted' }, 'Abra uma conversa para ver a ficha do lead.'))

    if (!state.phone) {
      const input = h('input', { placeholder: 'Ex.: 19 99999-0000' })
      return panel.append(
        h('p', { class: 'muted' }, `Não consegui ler o número de "${state.name}" (contato salvo/privacidade do WhatsApp). Informe o telefone:`),
        input,
        h('button', {
          class: 'primary',
          style: 'margin-top:6px',
          onclick: () => {
            const d = onlyDigits(input.value)
            if (d.length < 10) return toast('Telefone inválido.')
            state.manualPhones[state.name] = d.length <= 11 ? `55${d}` : d
            load()
          },
        }, 'Usar este número'),
      )
    }
    if (state.loading && !state.view) return panel.append(h('p', { class: 'muted' }, 'Carregando…'))

    const v = state.view
    if (!v?.lead) {
      const inbound = h('input', { type: 'checkbox', id: 'inb', style: 'width:auto' })
      return panel.append(
        h('div', { class: 'card' }, h('b', {}, state.name), h('div', { class: 'muted' }, `+${state.phone}`)),
        h('p', { class: 'muted' }, 'Este contato ainda não é lead do SDR. A automação só fala com leads.'),
        h('label', { class: 'row', style: 'margin:8px 0' }, inbound, h('span', {}, 'Ele(a) me procurou (sem 1º contato automático)')),
        h('button', { class: 'primary', onclick: () => createLead(inbound.checked) }, 'Adicionar ao SDR'),
      )
    }

    const l = v.lead
    // Cabeçalho + alertas
    panel.append(
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('b', {}, l.name), l.status === 'opt_out' ? h('span', { class: 'pill red' }, 'Opt-out') : null),
        h('div', { class: 'muted' }, `+${l.phone}${l.city ? ` · ${l.city}${l.uf ? `/${l.uf}` : ''}` : ''}${l.category ? ` · ${l.category}` : ''}`),
      ),
    )
    if (l.needs_human) {
      panel.append(
        h('div', { class: 'card alert' },
          h('b', {}, 'Precisa de você'),
          h('div', {}, l.handoff_reason || 'O lead pediu atendimento humano.'),
          h('button', { style: 'margin-top:6px', onclick: () => patchLead({ needs_human: false }, 'Marcado como resolvido.') }, 'Resolvido'),
        ),
      )
    }

    // Funil
    const stageSel = h('select', { onchange: (e) => patchLead({ stage: e.target.value }, `Etapa → ${stageLabel(e.target.value)}`) }, v.stages.map((s) => h('option', { value: s.key, selected: s.key === l.stage }, s.label)))
    const value = h('input', { type: 'number', min: '0', step: '50', value: l.deal_value ?? '', placeholder: 'R$ previsto' })
    value.addEventListener('change', () => patchLead({ deal_value: value.value === '' ? null : Number(value.value) }, 'Valor previsto salvo.'))
    panel.append(h('h3', {}, 'Funil'), stageSel, h('label', { class: 'lbl' }, 'Valor previsto (R$)'), value)
    if (v.cadence) panel.append(h('p', { class: 'muted' }, `Follow-up "${v.cadence.name}" · passo ${v.cadence.step}/${v.cadence.total}${v.cadence.next_run_at ? ` · ${rel(v.cadence.next_run_at)}` : ' · aguardando envio'}`))

    // IA
    const aiOn = v.ai?.enabled && !l.ai_paused
    panel.append(
      h('h3', {}, 'Atendimento'),
      h('div', { class: 'row between' },
        h('span', { class: `pill ${aiOn ? 'green' : 'gray'}` }, v.ai?.enabled ? (l.ai_paused ? 'Você assumiu' : 'IA respondendo') : 'IA desligada'),
        v.ai?.enabled ? h('button', { onclick: () => patchLead({ ai_paused: !l.ai_paused }, l.ai_paused ? 'IA de volta neste lead.' : 'Você assumiu: a IA não responde este lead.') }, l.ai_paused ? 'Devolver para a IA' : 'Assumir conversa') : null,
      ),
    )

    // Envios pendentes / sugestões
    const awaiting = v.tasks.filter((t) => t.status === 'aguardando_aprovacao')
    const queued = v.tasks.filter((t) => t.status !== 'aguardando_aprovacao')
    if (awaiting.length) {
      panel.append(h('h3', {}, 'Sugestões da IA'))
      for (const t of awaiting) {
        const ta = h('textarea', {}, t.body)
        panel.append(
          h('div', { class: 'card' }, ta,
            h('div', { class: 'row', style: 'margin-top:6px' },
              h('button', { class: 'primary', onclick: () => taskAction(t, 'approve', ta.value) }, 'Enviar'),
              h('button', { onclick: () => insertIntoComposer(ta.value) }, 'Usar no campo'),
              h('button', { onclick: () => taskAction(t, 'cancel') }, 'Descartar'),
            ),
          ),
        )
      }
    }
    if (queued.length) {
      panel.append(h('h3', {}, 'Na fila do robô'))
      for (const t of queued) {
        panel.append(
          h('div', { class: 'card' },
            h('div', { class: 'muted' }, `${t.kind === 'first_contact' ? '1º contato' : t.kind === 'follow_up' ? 'Follow-up' : t.kind === 'ai_reply' ? 'IA' : 'Manual'} · ${t.status === 'falhou' ? `falhou: ${t.error ?? ''}` : rel(t.scheduled_at)}${t.respects_window ? ' · no horário de envio' : ''}`),
            h('div', {}, t.body.length > 160 ? `${t.body.slice(0, 160)}…` : t.body),
            ['pendente', 'falhou'].includes(t.status) ? h('button', { style: 'margin-top:5px', onclick: () => taskAction(t, 'cancel') }, 'Cancelar') : null,
          ),
        )
      }
    }

    // Respostas rápidas
    if (v.quick_replies.length) {
      panel.append(h('h3', {}, 'Respostas rápidas'), h('div', { class: 'chips' }, v.quick_replies.map((q) => h('button', { title: q.preview, onclick: () => insertIntoComposer(q.preview) }, q.title))))
    }

    // Notas e lembretes
    const noteBody = h('textarea', { placeholder: 'Nota ou lembrete…' })
    const remind = h('input', { type: 'datetime-local' })
    panel.append(
      h('h3', {}, 'Notas e lembretes'),
      noteBody,
      h('label', { class: 'lbl' }, 'Lembrar em (opcional)'),
      remind,
      h('button', {
        class: 'primary',
        style: 'margin-top:6px',
        onclick: async () => {
          if (!noteBody.value.trim()) return toast('Escreva a nota.')
          const r = await api(`/sdr/leads/${l.id}/notes`, { method: 'POST', body: { body: noteBody.value.trim(), remind_at: remind.value ? new Date(remind.value).toISOString() : null } })
          if (r.status === 201) {
            toast('Nota salva.')
            load()
          } else toast(r.json?.error?.message ?? 'Não consegui salvar a nota.')
        },
      }, 'Salvar nota'),
    )
    for (const n of v.notes) {
      const cb = h('input', { type: 'checkbox', checked: n.done, style: 'width:auto' })
      cb.addEventListener('change', async () => {
        const r = await api(`/sdr/notes/${n.id}`, { method: 'PATCH', body: { done: cb.checked }, etag: `"${n.updated_at}"` })
        if (r.status !== 200) toast(r.json?.error?.message ?? 'Não consegui salvar.')
        load()
      })
      panel.append(
        h('div', { class: `card note${n.done ? ' done' : ''}` },
          h('div', { class: 'row' }, cb, h('span', {}, n.body)),
          n.remind_at ? h('div', { class: 'muted' }, `⏰ ${new Date(n.remind_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} (${rel(n.remind_at)})`) : null,
        ),
      )
    }

    // Atalhos + saída
    panel.append(
      h('h3', {}, 'Atalhos no chat'),
      h('p', { class: 'muted' }, 'Digite sozinho no campo e aperte Enter (não é enviado): #reuniao · #proposta · #qualificado · #cliente · #perdido'),
      l.status !== 'opt_out'
        ? h('button', { style: 'margin-top:10px', onclick: () => confirm('Marcar opt-out? O lead não recebe mais mensagens.') && patchLead({ opt_out: true }, 'Opt-out registrado.') }, 'Marcar opt-out (não contatar)')
        : null,
    )
  }

  async function taskAction(task, action, body) {
    const r = await api(`/sdr/tasks/${task.id}`, { method: 'PATCH', body: { action, ...(body ? { body } : {}) }, etag: task.etag })
    toast(r.status === 200 ? (action === 'approve' ? 'Enviando pelo robô…' : 'Cancelado.') : r.json?.error?.message ?? 'Não consegui.')
    load()
  }

  // -------------------------------------------------------------------------
  // Observa a troca de conversa
  // -------------------------------------------------------------------------
  let lastKey = null
  let debounce = null
  function checkChat() {
    const name = chatName()
    const key = `${name}|${chatPhone(name)}`
    if (key !== lastKey) {
      lastKey = key
      load()
    }
  }
  const observer = new MutationObserver(() => {
    clearTimeout(debounce)
    debounce = setTimeout(checkChat, 400)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setInterval(checkChat, 2000) // conversa trocada sem mutação perceptível
  setInterval(() => document.visibilityState === 'visible' && state.view?.lead && load(), 30_000)
  render()
  checkChat()
})()
