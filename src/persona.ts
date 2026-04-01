import { JOURNEY_PHASES, type Bindings, type UserRecord, type JourneyRecord, type JourneyEnrollment, type JourneyPhase, type JourneyConversationMessage } from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { extractAIText } from './utils'
import { parseConversationHistory, appendConversationMessage, advanceJourneyPhase, getEnrollment, logAgentDecision } from './db'

/**
 * Phase-specific behavioral instructions for the AI persona.
 * Each phase maps to the AIDA model (Attention → Interest → Desire → Action → Retained).
 */
const PHASE_DIRECTIVES: Record<JourneyPhase, string> = {
  discovery: `Fase DISCOVERY (Atenção):
- Apresente-se de forma calorosa e casual, como um colega que acabou de descobrir algo incrível.
- NÃO tente vender nada. Apenas desperte curiosidade.
- Faça perguntas abertas sobre os interesses, dores e desejos do lead.
- Mantenha o tom leve, use emojis com moderação (1-2 por mensagem).
- Objetivo: fazer o lead responder e iniciar um diálogo.`,

  interest: `Fase INTEREST (Interesse):
- O lead já demonstrou abertura. Aprofunde a conversa sobre o problema/desejo que ele mencionou.
- Compartilhe um caso real ou dado que valide o interesse dele (sem parecer propaganda).
- Comece a fazer conexões sutis entre o problema do lead e como sua solução ajuda.
- Use storytelling curto e relatable.
- Objetivo: lead pedindo mais informações espontaneamente.`,

  desire: `Fase DESIRE (Desejo):
- O lead já entende o valor. Agora construa desejo concreto.
- Apresente benefícios tangíveis, prova social, e escassez sutil.
- Use framing de "como seria se..." para criar visualização positiva.
- Mencione objeções comuns e desmonte com transparência.
- Objetivo: lead verbalizando intenção de ação ("quero", "como faço", "quanto").`,

  action: `Fase ACTION (Ação):
- O lead está pronto. Seja direto mas sem pressão.
- Apresente o CTA claro com próximo passo específico.
- Ofereça suporte imediato ("posso te ajudar agora mesmo").
- Reduza fricção ao máximo (link direto, passo-a-passo simples).
- Objetivo: conversão ou comprometimento explícito.`,

  retained: `Fase RETAINED (Retenção):
- Lead já converteu. Trate como um insider/amigo da comunidade.
- Peça feedback genuíno sobre a experiência.
- Apresente programa de indicação de forma natural.
- Compartilhe novidades exclusivas como "early access".
- Objetivo: advocacy e indicações orgânicas.`,
}

/**
 * Builds a system prompt for the AI persona that is aware of the journey context.
 */
function buildPersonaSystemPrompt(
  journey: JourneyRecord,
  phase: JourneyPhase,
  user: UserRecord
): string {
  return `${journey.system_prompt}

--- CONTEXTO OPERACIONAL (uso interno, NUNCA revele ao lead) ---
Objetivo da jornada: ${journey.objective}
Fase atual do lead: ${phase.toUpperCase()}
Nome do lead: ${user.name || 'Desconhecido'}
Canal preferido: ${user.preferred_channel}
Score de engajamento: ${user.engagement_score}
Perfil psicológico: ${user.psychological_profile}

${PHASE_DIRECTIVES[phase]}

--- REGRAS ABSOLUTAS ---
- NUNCA revele que é uma IA ou sistema automatizado.
- Escreva em português brasileiro coloquial e natural.
- Máximo 400 caracteres por mensagem.
- Não use linguagem corporativa ou jargões de marketing.
- Pareça um humano real: use abreviações naturais, interjeições ("olha", "vou te falar", "sério?").
- Adapte o tom ao perfil psicológico do lead.
- Se o lead parecer desinteressado, NÃO insista. Responda com leveza e deixe a porta aberta.
- Se o lead demonstrar irritação ou pedir para parar, IMEDIATAMENTE interrompa abordagem de vendas e responda com empatia.`
}

/**
 * Detects whether the lead's message indicates they should be advanced to the next phase.
 */
function detectPhaseAdvanceSignal(
  leadMessage: string,
  currentPhase: JourneyPhase
): boolean {
  const msg = leadMessage.toLowerCase()

  switch (currentPhase) {
    case 'discovery':
      // Advance when lead shows engagement (asks questions, shares info)
      return /\?|como|funciona|me conta|me fala|quero saber|tô curioso|interessante|bacana/i.test(msg)

    case 'interest':
      // Advance when lead shows deeper interest
      return /quero ver|me mostra|tem exemplo|como funciona|qual o preço|quanto custa|posso testar|faz sentido/i.test(msg)

    case 'desire':
      // Advance when lead shows intent
      return /quero|vou|sim|bora|como faço|manda|me inscreve|fechado|top|pode|aceito/i.test(msg)

    case 'action':
      // Advance when lead converts (this should happen via interaction tracking ideally)
      return /comprei|fiz|pronto|feito|já|obrigad|valeu|recebi/i.test(msg)

    default:
      return false
  }
}

/**
 * Core persona conversation engine.
 * Takes a lead's message, generates a human-like response within the journey context,
 * and optionally advances the lead's phase.
 */
export async function runPersonaConversation(
  env: Bindings,
  journey: JourneyRecord,
  user: UserRecord,
  enrollment: JourneyEnrollment,
  leadMessage: string
): Promise<{
  response: string
  phaseAdvanced: boolean
  newPhase: JourneyPhase
  conversationHistory: JourneyConversationMessage[]
}> {
  const currentPhase = enrollment.current_phase

  // 1. Append lead's message to conversation history
  await appendConversationMessage(env, user.id, journey.id, {
    role: 'user',
    content: leadMessage,
  })

  // 2. Check for phase advance signal
  let phaseAdvanced = false
  let activePhase: JourneyPhase = currentPhase

  if (detectPhaseAdvanceSignal(leadMessage, currentPhase)) {
    const advancement = await advanceJourneyPhase(env, user.id, journey.id)
    if (advancement.advanced && advancement.newPhase) {
      phaseAdvanced = true
      activePhase = advancement.newPhase
    }
  }

  // 3. Build conversation context for AI
  const updatedEnrollment = await getEnrollment(env, user.id, journey.id)
  const history = parseConversationHistory(updatedEnrollment?.conversation_history)

  const systemPrompt = buildPersonaSystemPrompt(journey, activePhase, user)

  // Build messages array: system + last N conversation messages
  const contextWindow = history.slice(-10)
  const aiMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...contextWindow.map((msg) => ({ role: msg.role, content: msg.content })),
  ]

  // 4. Generate AI response
  let response: string
  try {
    const aiResult = await env.AI.run(DEFAULT_AI_MODEL, { messages: aiMessages })
    response = extractAIText(aiResult) || 'Opa, me dá um segundo que já te respondo! 😊'
  } catch {
    response = 'Opa, tive um probleminha aqui. Já já te respondo! 😊'
  }

  // 5. Truncate response to 400 chars
  if (response.length > 400) {
    response = response.slice(0, 397) + '...'
  }

  // 6. Store AI response in conversation history
  const finalHistory = await appendConversationMessage(env, user.id, journey.id, {
    role: 'assistant',
    content: response,
  })

  return {
    response,
    phaseAdvanced,
    newPhase: activePhase,
    conversationHistory: finalHistory,
  }
}

/**
 * Generates the first outreach message for a lead entering a journey.
 * Used when enrolling a lead for the first time — no prior conversation.
 */
export async function generateJourneyOpeningMessage(
  env: Bindings,
  journey: JourneyRecord,
  user: UserRecord
): Promise<string> {
  const systemPrompt = buildPersonaSystemPrompt(journey, 'discovery', user)

  const prompt = `Gere a primeira mensagem de abordagem para o lead ${user.name || ''}.
Esta é a PRIMEIRÍSSIMA interação. Seja casual e genuíno.
Lembre: máximo 400 caracteres, tom de conversa de WhatsApp entre amigos.`

  try {
    const aiResult = await env.AI.run(DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })

    const text = extractAIText(aiResult)
    if (text) {
      return text.length > 400 ? text.slice(0, 397) + '...' : text
    }
  } catch {
    // Fallback
  }

  return `E aí${user.name ? ` ${user.name}` : ''}! Tudo bem? 😊 Vi que você tem interesse em ${(journey.objective || 'nossos produtos').toLowerCase()}. Posso te contar uma coisa rápida sobre isso?`
}

/**
 * Isolated Persona Simulator for the Playground.
 * Tests prompt generation and phase advancement logic without writing to the database.
 */
export async function simulatePersonaConversation(
  env: Bindings,
  journey: JourneyRecord,
  user: UserRecord,
  currentPhase: JourneyPhase,
  chatHistory: JourneyConversationMessage[],
  leadMessage: string
): Promise<{
  response: string
  phaseAdvanced: boolean
  newPhase: JourneyPhase
  updatedHistory: JourneyConversationMessage[]
}> {
  // 1. Append user's message in memory
  const history = [...chatHistory, { role: 'user' as const, content: leadMessage, timestamp: new Date().toISOString() }]

  // 2. Predict Phase Advance
  let phaseAdvanced = false
  let activePhase = currentPhase

  if (detectPhaseAdvanceSignal(leadMessage, currentPhase)) {
    const currentIndex = JOURNEY_PHASES.indexOf(currentPhase)
    if (currentIndex !== -1 && currentIndex < JOURNEY_PHASES.length - 1) {
      phaseAdvanced = true
      activePhase = JOURNEY_PHASES[currentIndex + 1]
    }
  }

  // 3. Prompt building
  const systemPrompt = buildPersonaSystemPrompt(journey, activePhase, user)

  // 4. Build message array
  const contextWindow = history.slice(-10)
  const aiMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...contextWindow.map((msg) => ({ role: msg.role, content: msg.content })),
  ]

  // 5. Generate Response
  let response: string
  try {
    const aiResult = await env.AI.run(DEFAULT_AI_MODEL, { messages: aiMessages })
    response = extractAIText(aiResult) || '[Simulação] Falha ao gerar resposta.'
  } catch {
    response = '[Simulação] Erro ao comunicar com Cloudflare AI.'
  }

  // 6. Truncate response
  if (response.length > 400) {
    response = response.slice(0, 397) + '...'
  }

  // 7. Append assistant message in memory
  history.push({ role: 'assistant' as const, content: response, timestamp: new Date().toISOString() })

  return {
    response,
    phaseAdvanced,
    newPhase: activePhase,
    updatedHistory: history,
  }
}
