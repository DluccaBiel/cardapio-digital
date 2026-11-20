const $ = (id) => document.getElementById(id)
const send = (msg) => chrome.runtime.sendMessage(msg)

function show(el, on) {
  el.hidden = !on
}

function item(text, sub) {
  const li = document.createElement('li')
  li.textContent = text
  if (sub) {
    const s = document.createElement('small')
    s.textContent = sub
    li.appendChild(s)
  }
  return li
}

function fill(list, rows, empty) {
  list.replaceChildren()
  if (!rows.length) list.appendChild(item(empty))
  for (const r of rows) list.appendChild(r)
}

async function render() {
  const st = await send({ type: 'state' })
  $('hub').value = st.hubUrl
  show($('login'), !st.loggedIn)
  show($('app'), st.loggedIn)
  if (!st.loggedIn) return
  $('wsName').textContent = st.workspace?.name ?? 'Workspace'
  $('who').textContent = st.email ?? ''
  const r = await send({ type: 'inbox' })
  const d = r?.data
  if (!d) return
  const robot = $('robot')
  robot.textContent = d.robot.online ? (d.robot.whatsapp === 'ready' ? 'Online' : 'Online · WhatsApp desconectado') : 'Desligado'
  robot.className = `pill ${d.robot.online && d.robot.whatsapp === 'ready' ? 'ok' : 'bad'}`
  fill($('human'), d.needs_human.map((l) => item(l.name, l.handoff_reason || 'Pediu atendimento')), 'Ninguém esperando.')
  fill($('approvals'), d.awaiting_approval.map((t) => item(t.lead?.name ?? 'Lead', t.body.slice(0, 90))), 'Nada para aprovar.')
  fill($('reminders'), d.reminders.map((n) => item(n.lead?.name ?? 'Lead', n.body.slice(0, 90))), 'Sem lembretes vencidos.')
}

$('doLogin').addEventListener('click', async () => {
  const err = $('loginErr')
  show(err, false)
  $('doLogin').disabled = true
  const r = await send({ type: 'login', email: $('email').value.trim(), password: $('password').value, workspace_slug: $('ws').value || undefined })
  $('doLogin').disabled = false
  if (r.needsWorkspace) {
    const sel = $('ws')
    sel.replaceChildren(...r.workspaces.map((w) => Object.assign(document.createElement('option'), { value: w.slug, textContent: w.name })))
    show($('wsWrap'), true)
    return
  }
  if (!r.ok) {
    err.textContent = r.error
    show(err, true)
    return
  }
  $('password').value = ''
  render()
})

$('logout').addEventListener('click', async () => {
  await send({ type: 'logout' })
  render()
})

$('saveHub').addEventListener('click', async () => {
  const url = $('hub').value.trim().replace(/\/+$/, '')
  const err = $('hubErr')
  show(err, false)
  if (url.startsWith('http://localhost')) {
    const granted = await chrome.permissions.request({ origins: ['http://localhost/*'] })
    if (!granted) {
      err.textContent = 'Permissão para localhost negada.'
      show(err, true)
      return
    }
  }
  const r = await send({ type: 'setHub', hubUrl: url })
  if (!r.ok) {
    err.textContent = r.error
    show(err, true)
    return
  }
  render()
})

render()
