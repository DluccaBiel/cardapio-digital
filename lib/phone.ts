/** Telefones do Brasil para o público dos disparos (funções puras). */

/** Normaliza para só dígitos com DDI 55 (celular/fixo do Brasil); null se não parecer telefone. */
export function normalizeBrPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) d = `55${d}`
  if (!/^\d{12,13}$/.test(d) || !d.startsWith('55')) return null
  return d
}

/** Aceita uma linha por contato: "11999998888", "Pizzaria do Zé; 11999998888" ou "11999998888 - Pizzaria do Zé". */
export function parseManualContacts(text: string): { name: string; phone: string }[] {
  const out = new Map<string, { name: string; phone: string }>()
  for (const line of text.split(/\r?\n/).slice(0, 500)) {
    const raw = line.trim()
    if (!raw) continue
    const m = raw.match(/\+?\d[\d\s().-]{8,}\d/)
    if (!m) continue
    const phone = normalizeBrPhone(m[0])
    if (!phone || out.has(phone)) continue
    const name = raw.replace(m[0], '').replace(/^[\s;,|:-]+|[\s;,|:-]+$/g, '').slice(0, 200) || `Contato ${phone.slice(-4)}`
    out.set(phone, { name, phone })
  }
  return Array.from(out.values())
}
