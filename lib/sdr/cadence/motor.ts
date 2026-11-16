// Motor de Cadência Multicanal - Undercut SDR
// Roda a cada 5 minutos (pg_cron ou edge function)
// Processa lead_cadence_enrollments com next_run_at <= now()

// ============================================================
// CONFIGURAÇÕES DO MOTOR
// ============================================================

// Janela de envio: seg–sex, 9h–18h no fuso do lead
const SEND_WINDOW_START = 9;
const SEND_WINDOW_END = 18;

// Dias da semana (0 = Domingo, 1 = Segunda, ..., 6 = Sábado)
const WEEKDAYS_SEGUNDA_A_SEXTA = [1, 2, 3, 4, 5];

// Limites diários por caixa
const DAILY_EMAIL_LIMIT = 40;
const DAILY_WHATSAPP_TEMPLATE_LIMIT = 100;

// ============================================================
// TYPES
// ============================================================

export type CadenceStep = {
  id: string;
  step: number; // número do passo na cadência
  day_relative: number; // dia relativo (1 = dia 1, 2 = dia 2, etc.)
  canal: 'email' | 'whatsapp' | 'ligação';
  template_id: string;
  condicao_saida?: string; // condição que sai da cadência
  observacoes?: string;
};

export type Cadence = {
  id: string;
  name: string;
  description: string;
  niche: 'food' | 'estetica';
  steps: CadenceStep[];
  created_at: string;
  updated_at: string;
};

export type LeadCadenceEnrollment = {
  id: string;
  lead_id: string;
  cadence_id: string;
  current_step: number;
  next_run_at: string; // Próximo horário de execução
  status: 'agendado' | 'em_andamento' | 'pausado' | 'concluido' | 'cancelado';
  started_at?: string;
  completed_at?: string;
  suppressed?: boolean; // true se está na suppression_list
};

// ============================================================
// EXEMPLO: Cadência Padrão "Food – 14 dias"
// ============================================================

// Definimos a cadência como constante (não exportada como variável separada)
// para evitar conflitos de redeclaração

const CADENCE_FOOD_14_DIAS: Cadence = {
  id: 'food_14_dias',
  name: 'Food – 14 dias',
  description: 'Cadência padrão para empresas do nicho food',
  niche: 'food',
  created_at: '2026-11-16T00:00:00.000Z',
  updated_at: '2026-11-16T00:00:00.000Z',
  steps: [
    // D1 - E-mail: Abertura personalizada
    {
      id: 'd1',
      step: 1,
      day_relative: 0,
      canal: 'email',
      template_id: 'email_d1_food',
      observacoes: 'Abertura personalizada com 1 sinal observado',
    },
    // D2 - WhatsApp: Template oficial ou wa.me assistido
    {
      id: 'd2',
      step: 2,
      day_relative: 1,
      canal: 'whatsapp',
      template_id: 'whatsapp_d2',
      observacoes: 'Template oficial (Cloud API) ou tarefa wa.me assistida',
    },
    // D4 - Ligação: Tarefa click-to-call
    {
      id: 'd4',
      step: 3,
      day_relative: 3,
      canal: 'ligação',
      template_id: 'roteiro_ligacao',
      observacoes: 'Tarefa: click-to-call + roteiro',
    },
    // D6 - E-mail: Prova/caso curto + pergunta aberta
    {
      id: 'd6',
      step: 4,
      day_relative: 5,
      canal: 'email',
      template_id: 'email_d6',
      observacoes: 'Prova/caso curto + pergunta aberta',
    },
    // D9 - WhatsApp: Follow-up curto
    {
      id: 'd9',
      step: 5,
      day_relative: 8,
      canal: 'whatsapp',
      template_id: 'whatsapp_d9',
      observacoes: 'Follow-up curto com pergunta de sim/não',
    },
    // D11 - Ligação: Tarefa
    {
      id: 'd11',
      step: 6,
      day_relative: 10,
      canal: 'ligação',
      template_id: 'roteiro_ligacao',
      observacoes: 'Tarefa',
    },
    // D14 - E-mail: Breakup
    {
      id: 'd14',
      step: 7,
      day_relative: 13,
      canal: 'email',
      template_id: 'email_d14_breakup',
      observacoes: 'Encerrando contato (breakup) com opção de retomar depois',
    },
  ],
};

const CADENCE_ESTETICA_14_DIAS: Cadence = {
  id: 'estetica_14_dias',
  name: 'Estética – 14 dias',
  description: 'Cadência padrão para empresas do nicho estetica',
  niche: 'estetica',
  created_at: '2026-11-16T00:00:00.000Z',
  updated_at: '2026-11-16T00:00:00.000Z',
  steps: [
    {
      id: 'd1',
      step: 1,
      day_relative: 0,
      canal: 'email',
      template_id: 'email_d1_estetica',
      observacoes: 'Abertura personalizada com 1 sinal observado',
    },
    {
      id: 'd2',
      step: 2,
      day_relative: 1,
      canal: 'whatsapp',
      template_id: 'whatsapp_d2',
      observacoes: 'Template oficial (Cloud API) ou tarefa wa.me assistida',
    },
    {
      id: 'd4',
      step: 3,
      day_relative: 3,
      canal: 'ligação',
      template_id: 'roteiro_ligacao',
      observacoes: 'Tarefa: click-to-call + roteiro',
    },
    {
      id: 'd6',
      step: 4,
      day_relative: 5,
      canal: 'email',
      template_id: 'email_d6',
      observacoes: 'Prova/caso curto + pergunta aberta',
    },
    {
      id: 'd9',
      step: 5,
      day_relative: 8,
      canal: 'whatsapp',
      template_id: 'whatsapp_d9',
      observacoes: 'Follow-up curto com pergunta de sim/não',
    },
    {
      id: 'd11',
      step: 6,
      day_relative: 10,
      canal: 'ligação',
      template_id: 'roteiro_ligacao',
      observacoes: 'Tarefa',
    },
    {
      id: 'd14',
      step: 7,
      day_relative: 13,
      canal: 'email',
      template_id: 'email_d14_breakup',
      observacoes: 'Encerrando contato (breakup)',
    },
  ],
};

// ============================================================
// EXPORTADOS
// ============================================================

// Exporta a função de verificação de janela de envio
export function podeEnviarNaRodada(
  lead: {
    stage: string;
    suppressageList?: boolean;
    fuso_offset?: number; // offset do fuso em horas em relação a UTC
  },
  agora: Date
): {
  podeEnviar: boolean;
  motivo?: string;
  horaLocal?: string;
} {
  // 1. Checa suppression_list
  if (lead.suppressageList) {
    return {
      podeEnviar: false,
      motivo: 'Lead na suppression_list - cadência pausada',
    };
  }

  // 2. Checa stage (sai se já respondeu/opt-out/reunião)
  const stagesQuePausam = ['respondido', 'opt_out', 'reuniao_marcada'];
  if (lead.stage && stagesQuePausam.includes(lead.stage)) {
    return {
      podeEnviar: false,
      motivo: `Lead na stage ${lead.stage} - cadência pausada`,
    };
  }

  // 3. Checa janela de horário (seg–sex 9h–18h no fuso do lead).
  //    fuso_offset em horas relativo a UTC (Brasília = -3, padrão quando ausente).
  //    Usa getUTC* para não depender do fuso do servidor.
  const offset = lead.fuso_offset ?? -3;
  const local = new Date(agora.getTime() + offset * 60 * 60 * 1000);
  const horaAtual = local.getUTCHours();
  const horaLocalTexto = `${String(horaAtual).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;

  if (!WEEKDAYS_SEGUNDA_A_SEXTA.includes(local.getUTCDay())) {
    return { podeEnviar: false, motivo: 'Fora da janela de envio (seg–sex)', horaLocal: horaLocalTexto };
  }

  if (horaAtual < SEND_WINDOW_START || horaAtual >= SEND_WINDOW_END) {
    return {
      podeEnviar: false,
      motivo: `Fora da janela de envio (9h–18h)`,
      horaLocal: horaLocalTexto,
    };
  }

  // 4. Checa limite diário por caixa de e-mail (simulado)
  // Em produção, consultaríamos o banco de envios do dia
  const jaEnviouHoje = false; // placeholder - consultar bd

  if (jaEnviouHoje) {
    return {
      podeEnviar: false,
      motivo: 'Limite diário de e-mails atingido',
    };
  }

  // 5. Checa limite diário por número WhatsApp
  // Em produção, consultaríamos o banco de envios WhatsApp do dia
  const jaEnviouWhatsAppHoje = false; // placeholder

  if (jaEnviouWhatsAppHoje) {
    return {
      podeEnviar: false,
      motivo: 'Limite diário de WhatsApp atingido',
    };
  }

  return {
    podeEnviar: true,
    motivo: 'Pode enviar nesta rodada',
    horaLocal: horaLocalTexto,
  };
}

/** Cadências padrão disponíveis (food e estética). */
export const CADENCIAS_PADRAO: Cadence[] = [CADENCE_FOOD_14_DIAS, CADENCE_ESTETICA_14_DIAS];

// ============================================================
// ROTEIRO DE E-MAIL (TEXTO PRÉ-DEFINIDO)
// ============================================================

// E-mail D1 – Food
export const EMAIL_D1_FOOD = `> Assunto: {nome_fantasia} no Google\n>\n> Oi, {primeiro_nome_ou_equipe}, tudo bem?\n> Vi que a {nome_fantasia} tem {google_reviews_count} avaliações no Google e {sinal_observado}.\n> Trabalho com restaurantes aqui em {municipio} ajudando a transformar isso em pedido direto (sem depender só de app de delivery).\n> Faz sentido eu te mostrar em 15 minutos o que costuma funcionar para casas do seu porte?\n> {assinatura}\n> > Não quer receber mais e-mails? {link_descadastro}`;

// E-mail D14 – Breakup
export const EMAIL_D14_BREAKUP = `> Assunto: encerrando por aqui\n>\n> {primeiro_nome_ou_equipe}, como não tive retorno, imagino que agora não seja o momento — vou parar de te escrever.\n> Se em algum momento quiser conversar sobre {dor_principal_do_nicho}, é só responder este e-mail.\n> {assinatura}`;

// Roteiro de ligação (tarefa D4)
export const ROTEIRO_LIGACAO = `> "Oi, {nome}? Aqui é o {consultor}, da {empresa}. Te pega num momento ruim? — [se ok]\n> — Te mandei uma mensagem sobre {sinal_observado}. Hoje o que mais pesa aí: movimento/agenda ou depender de app/indicação? [ouvir]\n> — Faz sentido marcar 20 minutos essa semana para eu te mostrar o que funcionou em casos parecidos?`;

// Cadência padrão "Estética – 14 dias"
export const EMAIL_D1_ESTETICA = `> Assunto: agenda da {nome_fantasia}\n>\n> Oi, {primeiro_nome_ou_equipe}!\n> Dei uma olhada na {nome_fantasia} e {sinal_observado}.\n> Ajudo clínicas e estúdios de estética em {municipio} a encher horários vagos com clientes da própria região.\n> Topa uma conversa rápida de 15 min para eu entender como está a agenda hoje?\n> {assinatura}\n> > Não quer receber mais e-mails? {link_descadastro}`;

// WhatsApp D2 (template de marketing - submeter à Meta)
export const WHATSAPP_D2_TEMPLATE = `> Olá! Aqui é o {consultor}, da {empresa}. Ajudo {nicho_plural} em {municipio} a atrair mais clientes da região. Posso te mandar uma ideia rápida pensada para a {nome_fantasia}? Se preferir não receber mensagens, responda SAIR.`;

// E-mail Breakup
export const EMAIL_BREAKUP = `> Assunto: encerrando por aqui\n>\n> {primeiro_nome_ou_equipe}, como não tive retorno, imagino que agora não seja o momento — vou parar de te escrever.\n> Se em algum momento quiser conversar sobre {dor_principal_do_nicho}, é só responder este e-mail.\n> {assinatura}`;