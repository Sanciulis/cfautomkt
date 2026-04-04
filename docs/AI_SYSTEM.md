# Sistema de IA - Martech Viral Marketing Platform 🤖

## Visão Geral

Este documento detalha todas as funcionalidades que utilizam Inteligência Artificial no sistema Martech, fornecendo base técnica para avaliação, otimização e manutenção por especialistas em IA.

## Arquitetura de IA

- **Provedor**: Cloudflare Workers AI
- **Modelo Principal**: `@cf/meta/llama-3-8b-instruct` (Llama 3.8B Instruct)
- **Linguagem**: Português Brasileiro
- **Framework**: Serverless (execução sob demanda)

## Funcionalidades de IA

### 1. Personalização de Mensagens (`src/ai.ts`)

#### `generatePersonalizedMessage()`
**Localização**: `src/ai.ts:5-45`

**Propósito**:
Geração de mensagens de marketing personalizadas baseadas no perfil individual do usuário.

**Parâmetros de Entrada**:
- `user`: Perfil completo do usuário (Record<UserRecord>)
- `baseCopy`: Mensagem base da campanha
- `channel`: Canal de comunicação (whatsapp/email/telegram)

**Dados Considerados na Personalização**:
- Canal preferido do usuário
- Perfil psicológico
- Score de engajamento
- Pontos virais acumulados

**Prompt Structure**:
```
Generate a {channel} marketing message in Brazilian Portuguese.
User profile:
- preferred_channel: {user.preferred_channel}
- psychological_profile: {user.psychological_profile}
- engagement_score: {user.engagement_score}
- viral_points: {user.viral_points}

Rules:
- max 400 characters
- include urgency and a clear CTA
- keep human tone and concise
- do not use fake claims

Base copy: "{baseCopy}"
```

**System Message**:
```
You are a senior conversion copywriter specialized in multichannel campaigns.
```

**Limitações**:
- Máximo 400 caracteres
- Tom conversacional brasileiro
- Foco em urgência e CTA claro

**Casos de Uso**:
- Campanhas de marketing viral
- Mensagens de reativação
- Comunicação personalizada

**Fallback**:
```
Oferta exclusiva para voce. ${baseCopy} Clique no link e aproveite agora.
```

---

### 2. Sistema de Personas e Conversação (`src/persona.ts`)

#### `runPersonaConversation()`
**Localização**: `src/persona.ts:120-180`

**Propósito**:
Mantém conversas automatizadas contextuais seguindo o modelo AIDA (Atenção → Interesse → Desejo → Ação → Retenção).

**Parâmetros de Entrada**:
- `journey`: Jornada completa (JourneyRecord)
- `user`: Perfil do usuário
- `phase`: Fase atual da jornada
- `history`: Histórico conversacional (últimas 10 mensagens)

**Fases do Modelo AIDA**:

1. **Discovery (Atenção)**:
   - Apresentação calorosa e casual
   - Despertar curiosidade
   - Perguntas abertas sobre interesses

2. **Interest (Interesse)**:
   - Aprofundamento da conversa
   - Compartilhamento de casos reais
   - Storytelling curto e relatable

3. **Desire (Desejo)**:
   - Benefícios tangíveis
   - Prova social e escassez
   - Visualização positiva

4. **Action (Ação)**:
   - CTA direto e claro
   - Redução de fricção
   - Suporte imediato

5. **Retained (Retenção)**:
   - Tratamento como insider
   - Pedido de feedback
   - Programa de indicações

**Características Técnicas**:
- Janela de contexto: 10 mensagens
- Detecção automática de avanço de fase
- Tom brasileiro coloquial
- Máximo 400 caracteres por resposta

**Regras Absolutas**:
- Nunca revelar que é IA
- Português brasileiro natural
- Adaptação ao perfil psicológico
- Resposta empática a sinais de desinteresse

---

#### `generateJourneyOpeningMessage()`
**Localização**: `src/persona.ts:185-220`

**Propósito**:
Geração da primeira mensagem de abordagem para leads novos em jornadas.

**Características**:
- Primeiríssima interação
- Tom casual e genuíno
- Adaptação ao nome do lead
- Contexto da jornada

**Prompt**:
```
Gere a primeira mensagem de abordagem para o lead {user.name}.
Esta é a PRIMEIRÍSSIMA interação. Seja casual e genuíno.
Lembre: máximo 400 caracteres, tom de conversa de WhatsApp entre amigos.
```

**Fallback**:
```
E aí{user.name ? ` ${user.name}` : ''}! Tudo bem? 😊 Vi que você tem interesse em {(journey.objective || 'nossos produtos').toLowerCase()}. Posso te contar uma coisa rápida sobre isso?
```

---

#### `simulatePersonaConversation()`
**Localização**: `src/persona.ts:225-290`

**Propósito**:
Simulação isolada de conversas para testes e debugging sem persistir dados.

**Características**:
- Não salva no banco de dados
- Retorna histórico em memória
- Usada no playground admin
- Mesma lógica de produção

---

### 3. Agente Conversacional de Newsletter (`src/newsletter-agent.ts` + `src/routes/api.ts`)

**Propósito**:
Executar conversas de WhatsApp orientadas a conversão para newsletter semanal com rastreabilidade completa no painel admin.

**Capacidades**:
- Detecção de intenção (`subscribe`, `opt_out`, `feedback`, `question`, `other`)
- Análise de sentimento por mensagem (`positive`, `neutral`, `negative`)
- Geração de resposta automatizada com fallback seguro
- Atualização de consentimento em cenários de conversão e opt-out

**Persistência dedicada**:
- `newsletter_conversation_sessions`
- `newsletter_conversation_messages`

**Operação no painel**:
- Início manual da abordagem por contato (`/admin/actions/newsletter-agent/start`)
- Resposta manual (`/admin/actions/newsletter-agent/reply`)
- Atualização de feedback e status (`/admin/actions/newsletter-agent/feedback`)
- Auditoria por sessão com histórico completo

**Integração inbound**:
- Endpoint `POST /webhooks/whatsapp/inbound`
- Autenticação com `DISPATCH_BEARER_TOKEN`
- Encaminhamento via gateway Baileys quando `INBOUND_WEBHOOK_URL` estiver configurado

---

### 4. Agente Conversacional de Servicos (`src/service-agent.ts` + `src/routes/api.ts`)

**Propósito**:
Gerenciar conversas comerciais de WhatsApp para agendamento, orcamento e tira-duvidas com rastreabilidade fim-a-fim no painel admin.

**Capacidades**:
- Detecção de intenção (`appointment`, `quote`, `question`, `opt_out`, `other`)
- Sinal de sentimento por mensagem
- Registro de pipeline comercial:
 - solicitacoes de agendamento (`service_appointments`)
 - solicitacoes de orcamento (`service_quotes`)
- Resposta automatica com fallback seguro para coleta de contexto

**Persistência dedicada**:
- `service_conversation_sessions`
- `service_conversation_messages`
- `service_appointments`
- `service_quotes`

**Operação no painel**:
- Início manual por contato (`/admin/actions/service-agent/start`)
- Resposta manual (`/admin/actions/service-agent/reply`)
- Atualização de status, notas e follow-up (`/admin/actions/service-agent/status`)
- Configuração operacional completa (`/admin/actions/service-agent/config/save`):
 - auto-reply inbound (ligar/desligar)
 - captura automática de agendamentos e orcamentos
 - janela de horário comercial + timezone
 - template de abertura, mensagem fora do horario e diretriz de qualificação
 - modelo de IA e limite de caracteres por resposta
- Auditoria de sessão com histórico, agendamentos e orcamentos

**Integração inbound**:
- Endpoint `POST /webhooks/whatsapp/services/inbound`
- Autenticação com `DISPATCH_BEARER_TOKEN`
- Encaminhamento via gateway Baileys quando `INBOUND_WEBHOOK_URL` estiver configurado

---

### 5. AI Learning Loop (`src/scheduled.ts`)

**Localização**: `src/scheduled.ts:140-175`

**Propósito**:
Análise automática de conversas fracassadas para gerar insights de otimização.

**Funcionamento**:
1. Identifica jornadas com leads estagnados (>3 dias sem resposta)
2. Coleta histórico de conversas
3. Envia para IA analisar padrões de fracasso
4. Gera sugestões de melhoria para system prompts

**Prompt de Análise**:
```
Analise estes diálogos de chat marketing que pararam de responder. Identifique por que o lead perdeu o interesse e sugira UM PEQUENO AJUSTE no System Prompt da persona para melhorar a conversão. Mantenha o tom profissional.
Conversas:
{chatContext}
```

**Resultado**:
- Insight armazenado em `ai_learning_loops`
- Status: `pending_review`
- Aguardar análise manual para aplicação

---

## Métricas e Monitoramento

### Indicadores de Performance
- **Taxa de Resposta da IA**: Tempo de resposta médio
- **Taxa de Fallback**: Percentual de uso de respostas padrão
- **Qualidade Conversacional**: Análise de engajamento do usuário
- **Conversão por Fase**: Taxa de avanço no funil AIDA

### Logs e Tracing
- Todas as interações com IA são logadas
- Histórico conversacional mantido
- Decisões do agente registradas em `agent_decisions`

---

## Otimizações e Melhorias

### Possíveis Melhorias

1. **Modelos Alternativos**:
   - Avaliar GPT-4, Claude para comparação
   - Modelos especializados em conversação

2. **Contexto Expandido**:
   - Aumentar janela de histórico conversacional
   - Incluir dados comportamentais adicionais

3. **A/B Testing**:
   - Sistema para testar variações de prompts
   - Métricas de conversão por variante

4. **Cache Inteligente**:
   - Cache de respostas similares
   - Redução de chamadas redundantes

5. **Fine-tuning**:
   - Modelo treinado especificamente para marketing brasileiro
   - Adaptação cultural aprimorada

### Limitações Atuais

1. **Janela de Contexto**: Limitada a 10 mensagens
2. **Comprimento de Resposta**: Máximo 400 caracteres
3. **Modelo Único**: Apenas Llama 3.8B
4. **Idioma**: Focado em português brasileiro

---

## Segurança e Compliance

### Proteções Implementadas
- Rate limiting nas chamadas de IA
- Fallbacks para falhas de API
- Logs de auditoria
- Compliance LGPD (não coleta dados sensíveis sem consentimento)

### Riscos
- Dependência de provedor externo (Cloudflare)
- Custos variáveis por uso
- Possibilidade de alucinações em respostas
- Viés cultural em prompts

---

## Manutenção e Suporte

### Monitoramento
- Dashboard admin com métricas de IA
- Logs de erro em tempo real
- Alertas para taxa de fallback elevada

### Health-check agendado (automático)
- O agente scheduled executa verificação operacional de IA na janela das últimas 24 horas.
- O alerta só é avaliado quando há amostra mínima de 25 inferências na janela.
- Regras de severidade aplicadas:
   - warning: erro > 5% ou fallback > 15% ou p95 > 2500ms
   - critical: erro > 10% ou fallback > 25% ou p95 > 4000ms
- Quando há degradação, o sistema registra evento operacional em `agent_decisions` com `decision_type = ai_ops_alert`.
- Alertas possuem deduplicação por severidade para evitar ruído:
   - warning: 1 alerta por hora
   - critical: 1 alerta por 30 minutos
- Em severidade crítica, o sistema pode notificar webhook externo quando configurado:
   - `AI_ALERT_WEBHOOK_URL`
   - `AI_ALERT_WEBHOOK_TOKEN` (opcional)
- Objetivo: detectar regressão sem depender da abertura do dashboard.

### Endpoint operacional (admin)
- `GET /admin/api/ai/metrics?hours=24`
- Retorna visão agregada por janela de tempo com:
   - total de inferências
   - taxa de erro
   - taxa de fallback
   - latência média
   - latência p50
   - latência p95
   - detalhamento por fluxo (`generate_personalized_message`, `run_persona_conversation`, etc.)
   - bloco `health` com:
      - `evaluated` (se havia amostra mínima para avaliação)
      - `severity` (`ok`, `warning`, `critical`, `insufficient_data`)
      - `minInferences` e thresholds usados na análise
- Uso recomendado:
   - acompanhamento diário em operação
   - baseline para experimentos de otimização de prompt/modelo
   - detecção de regressão de qualidade/performance

### Endpoint de histórico de alertas (admin)
- `GET /admin/api/ai/alerts?hours=168`
- Retorna alertas `ai_ops_alert` registrados pelo health-check agendado, incluindo:
   - severidade (`warning`/`critical`)
   - motivo
   - erro %
   - fallback %
   - latência p95
   - data/hora do evento
- Inclui também `trendByDay` com agregação diária por severidade (`warning`, `critical`, `total`).

### Endpoint de exportação CSV (admin)
- `GET /admin/api/ai/alerts/export.csv?hours=168`
- Retorna arquivo CSV para análise offline com colunas:
   - `created_at`
   - `severity`
   - `reason`
   - `error_rate`
   - `fallback_rate`
   - `latency_p95_ms`
   - `total_inferences`

### Endpoint de Extração de Dataset de Avaliação (admin)
- `GET /admin/api/ai/eval-dataset/export?format=(csv|json)&limit=500`
- Extrai amostra cega ofuscada (PII básico mascarado) do histórico de interações das Jornadas.
- Colunas base:
   - `journey_id`, `journey_name`, `persona_id`
   - `final_phase`, `is_success`, `turn_count`
   - `transcript` (histórico de conversas parseado sem payload original)

### Evaluator e Scorecard de Prompts (admin)
- `POST /admin/api/ai/eval/run`
- Roda uma inferência A/B e aplica um `llm-as-a-judge` no resultado.
- Retorna notas (1-5 para Tom, 1-5 para CTA, 0-1 para Risco de Segurança/Alucinação) com uma justificativa.

### Gerenciador e Auditoria de Prompts (Prompt Manager)
- Localizado em `src/prompt-manager.ts`.
- Desacopla as strings de Prompts hardcoded conectando nativamente na tabela base `ai_prompt_versions`.
- Permite histórico linear (Rollback / Auditoria de quem mudou o quê). Função `getActivePrompt` alimenta a `ai.ts` provendo o melhor promt e determinando a versão do Llama a ser usada dinamicamente.
- Cobertura atual de targets principais:
   - `flow:generate_personalized_message`
   - `flow:run_persona_conversation`
   - `flow:simulate_persona_conversation`
   - `flow:generate_journey_opening_message`
   - `flow:newsletter_agent_opening_message`
   - `flow:newsletter_agent_reply`
   - `flow:service_agent_opening_message`
   - `flow:service_agent_reply`
- Compatibilidade retroativa mantida para targets legados:
   - `flow:simulate_persona`
   - `flow:journey_opening`
- Publicacao via Admin com validacao de governanca:
   - bloqueio de `targetId` fora da lista suportada
   - validacao de tamanho minimo/maximo do prompt
   - validacao de placeholders por target quando aplicavel
   - retorno de warnings operacionais para revisão antes de rollout
- Preview de prompt antes de publicar:
   - endpoint `POST /admin/api/ai/prompts/preview`
   - renderizacao de placeholders com contexto de exemplo por target
   - exibicao de placeholders nao resolvidos para revisão preventiva

### Debugging
- Playground AI no painel admin
- Simulação de conversas
- Testes de prompts isolados

### Suporte
- Documentação técnica completa
- Logs detalhados de interações
- Capacidade de rollback para versões anteriores

---

*Este documento serve como referência técnica para especialistas em IA avaliarem e otimizarem o sistema de IA do Martech.*