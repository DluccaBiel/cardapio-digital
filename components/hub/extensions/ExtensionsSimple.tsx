import { ExtensionDownloads } from './ExtensionDownloads'

/** Tela de Extensões do COLABORADOR: só baixar, instalar e usar (sem status, chaves nem relatórios). */
export function ExtensionsSimple({ workspaceName }: { workspaceName: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[1100px] px-4 pb-12 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,rgba(215,20,31,0.10),transparent_62%)]" aria-hidden="true" />
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#85817C]">{workspaceName}</p>
      <h1 className="uc-title mt-1 text-[34px] text-[#F7F5F1] md:text-[44px]">Extensões</h1>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#8E8A86]">
        Baixe a extensão da plataforma do cliente, instale no Chrome e entre com o e-mail e a senha que você criou. O passo a passo está em cada cartão.
      </p>
      <ExtensionDownloads />
    </div>
  )
}
