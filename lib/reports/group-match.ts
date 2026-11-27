/** Sugere o grupo de WhatsApp de cada cliente pelo nome (puro, testável). */
export type MatchGroup = { jid: string; name: string }

const STOP = new Set(['ca', 'conta', 'de', 'do', 'da', 'dos', 'das', 'e', 'bm', 'ads', 'anuncio', 'anuncios', 'grupo', 'the', 'a', 'o'])

export function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
}

/**
 * Para cada cliente, o grupo cujo nome contém (quase) todas as palavras do cliente.
 * Só devolve pares sem ambiguidade (melhor grupo único e cada grupo usado uma vez).
 */
export function matchGroups<G extends MatchGroup>(clients: { id: string; name: string }[], groups: G[]): { id: string; group: G }[] {
  const gt = groups.map((g) => ({ g, t: new Set(tokens(g.name)) }))
  const scored = clients
    .map((c) => {
      const ct = tokens(c.name)
      if (!ct.length) return { id: c.id, best: null as G | null, score: 0, tie: false }
      const sc = gt
        .map(({ g, t }) => ({ g, score: ct.filter((x) => t.has(x)).length / ct.length }))
        .sort((a, b) => b.score - a.score)
      const top = sc[0]
      return { id: c.id, best: top && top.score >= 0.6 ? top.g : null, score: top?.score ?? 0, tie: Boolean(top && sc[1] && sc[1].score === top.score) }
    })
    .filter((x) => x.best && !x.tie)
  const used = new Set<string>()
  const out: { id: string; group: G }[] = []
  for (const x of scored.sort((a, b) => b.score - a.score)) {
    if (used.has(x.best!.jid)) continue
    used.add(x.best!.jid)
    out.push({ id: x.id, group: x.best! })
  }
  return out
}
