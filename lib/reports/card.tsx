/**
 * Card do relatório em PNG (1080×1350, 4:5) — SOMENTE servidor (next/og).
 * Mesmos números da mensagem; miniaturas dos anúncios embutidas como data URL
 * (baixadas antes, com timeout — se falhar, o card sai sem a imagem).
 */
import { ImageResponse } from 'next/og'
import { KIND_LABEL } from './blocks'
import { int, money, type ReportPayload } from './format'

const RED = '#D7141F'
const KIND_COLOR: Record<string, string> = {
  sales: '#22C55E',
  messages: '#38BDF8',
  profile: '#E879F9',
  traffic: '#F59E0B',
  engagement: '#F472B6',
  leads: '#A78BFA',
  awareness: '#94A3B8',
  other: '#94A3B8',
}

async function inlineImage(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 1_500_000) return null
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v == null) return null
  const good = invert ? v < 0 : v > 0
  const color = v === 0 ? '#8E8A86' : good ? '#4ADE80' : '#F87171'
  return <div style={{ display: 'flex', fontSize: 24, color, marginLeft: 14 }}>{v === 0 ? '= 0%' : `${v > 0 ? '+' : '-'}${Math.abs(v)}%`}</div>
}

export async function renderReportCard(p: ReportPayload): Promise<ImageResponse> {
  const blocks = p.show.byObjective ? p.blocks.slice(0, 4) : []
  const ads = p.show.topCreatives ? p.topAds.slice(0, 3) : []
  const thumbs = await Promise.all(ads.map((a) => inlineImage(a.thumbnail)))

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0B0C', color: '#F7F5F1', padding: '52px 64px 44px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', width: 14, height: 44, background: RED, marginRight: 18 }} />
            <div style={{ display: 'flex', fontSize: 26, letterSpacing: 6, color: '#8E8A86' }}>RELATÓRIO DE TRÁFEGO</div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#8E8A86' }}>{p.workspaceName.slice(0, 30)}</div>
        </div>

        <div style={{ display: 'flex', fontSize: p.title.length > 22 ? 56 : 72, marginTop: 18, flexShrink: 0 }}>{p.title.slice(0, 34)}</div>
        <div style={{ display: 'flex', fontSize: 28, color: '#CFCBC4', marginTop: 6, flexShrink: 0 }}>
          {`${p.periodLabel}${p.previousLabel ? `  ·  comparado a ${p.previousLabel}` : ''}`}
        </div>

        {p.show.general && (
          <div style={{ display: 'flex', marginTop: 24, gap: 24, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#151517', border: '2px solid #2A2A2E', borderRadius: 18, padding: '20px 28px' }}>
              <div style={{ display: 'flex', fontSize: 24, color: '#8E8A86' }}>Investimento</div>
              <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 8 }}>
                <div style={{ display: 'flex', fontSize: 52, fontWeight: 800 }}>{money(p.totals.spend)}</div>
                <Delta v={p.totals.spendDelta} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', width: 330, background: '#151517', border: '2px solid #2A2A2E', borderRadius: 18, padding: '26px 30px' }}>
              <div style={{ display: 'flex', fontSize: 24, color: '#8E8A86' }}>Alcance</div>
              <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, marginTop: 8 }}>{int(p.totals.reach)}</div>
            </div>
          </div>
        )}

        {blocks.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 20, flexShrink: 0 }}>
            {blocks.map((b) => (
              <div
                key={b.key}
                style={{ display: 'flex', flexDirection: 'column', width: blocks.length === 1 ? 952 : 464, background: '#151517', border: '2px solid #2A2A2E', borderTop: `8px solid ${KIND_COLOR[b.kind] ?? RED}`, borderRadius: 18, padding: '16px 26px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#CFCBC4' }}>
                  <div style={{ display: 'flex' }}>{b.title.slice(0, 30)}</div>
                  <div style={{ display: 'flex', color: '#8E8A86' }}>{money(b.spend)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 10 }}>
                  <div style={{ display: 'flex', fontSize: 54, fontWeight: 800 }}>{int(b.result)}</div>
                  <Delta v={b.deltaResult} />
                </div>
                <div style={{ display: 'flex', fontSize: 24, color: KIND_COLOR[b.kind] ?? RED }}>{b.resultLabel}</div>
                {b.costPerResult != null && (
                  <div style={{ display: 'flex', fontSize: 24, color: '#CFCBC4', marginTop: 10 }}>
                    {`${b.costLabel}: ${money(b.costPerResult)}`}
                    <Delta v={b.deltaCost} invert />
                  </div>
                )}
                {b.kind === 'sales' && b.revenue > 0 && (
                  <div style={{ display: 'flex', fontSize: 24, color: '#4ADE80', marginTop: 6 }}>{`Faturamento ${money(b.revenue)} · ROAS ${(b.roas ?? 0).toFixed(2).replace('.', ',')}x`}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {p.show.byObjective && blocks.length === 0 && (
          <div style={{ display: 'flex', marginTop: 24, fontSize: 28, color: '#8E8A86' }}>Sem campanhas com investimento no período.</div>
        )}

        {ads.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20, flexShrink: 0 }}>
            <div style={{ display: 'flex', fontSize: 24, color: '#8E8A86', marginBottom: 14 }}>Melhores anúncios</div>
            <div style={{ display: 'flex', gap: 24 }}>
              {ads.map((a, i) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', width: 301, background: '#151517', border: '2px solid #2A2A2E', borderRadius: 14, padding: 12 }}>
                  {thumbs[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[i]!} width={64} height={64} style={{ borderRadius: 10, objectFit: 'cover' }} alt="" />
                  ) : (
                    <div style={{ display: 'flex', width: 64, height: 64, borderRadius: 10, background: '#2A2A2E', alignItems: 'center', justifyContent: 'center', fontSize: 34, color: '#8E8A86' }}>{`${i + 1}º`}</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14, width: 175 }}>
                    <div style={{ display: 'flex', fontSize: 30, fontWeight: 800 }}>{int(a.result)}</div>
                    <div style={{ display: 'flex', fontSize: 18, color: '#8E8A86' }}>{KIND_LABEL[a.kind].result.toLowerCase()}</div>
                    <div style={{ display: 'flex', fontSize: 18, color: '#CFCBC4' }}>{a.name.slice(0, 18)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flex: 1 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid #2A2A2E', paddingTop: 20, flexShrink: 0, fontSize: 24, color: '#8E8A86' }}>
          <div style={{ display: 'flex' }}>
            {p.show.balance
              ? p.balance.debt > 0
                ? `Pagamento pendente: ${money(p.balance.debt)}`
                : p.balance.kind === 'pix'
                  ? `Saldo Pix: ${money(p.balance.available)}${p.balance.daysLeft != null ? ` · ~${p.balance.daysLeft} dias` : ''}`
                  : p.balance.kind === 'card'
                    ? 'Pagamento no cartão'
                    : ' '
              : ' '}
          </div>
          <div style={{ display: 'flex', color: RED, letterSpacing: 4 }}>UNDERCUT</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { 'Cache-Control': 'private, no-store' } },
  )
}
