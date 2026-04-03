# Roadmap de IA - Martech

## Objetivo Claro
Evoluir o sistema de IA do Martech para um padrão de operação confiável, mensurável e otimizado para conversão, com governança de mudanças e melhoria contínua a cada entrega.

## Resultado Esperado
- Aumentar qualidade das respostas e taxa de conversão das jornadas.
- Reduzir falhas silenciosas e uso de fallback sem visibilidade.
- Dar previsibilidade para custo, risco e performance de IA.
- Manter um ciclo contínuo de melhoria com evidências.

## Princípios de Execução
- Toda mudança de IA precisa de métrica de sucesso definida antes do deploy.
- Toda nova feature de IA precisa de observabilidade mínima.
- Toda otimização de prompt deve passar por experimento controlado.
- Toda atualização neste roadmap deve registrar impacto e próximos passos.
- Toda entrega deve passar por validação em GitHub Actions antes de merge/deploy.

## Cronograma Base (Por Ordem de Execução)

### Etapa 1 - Fundacao de Confiabilidade
Objetivo da fase: criar base de monitoramento e controle de risco das chamadas de IA.

Entregas:
1. Instrumentar logs estruturados de inferencia com:
- fluxo
- modelo
- latencia
- sucesso/erro
- uso de fallback
- identificador de prompt (hash)
2. Definir painéis operacionais com:
- taxa de erro
- taxa de fallback
- latencia p50/p95
- volume por funcionalidade
3. Criar alertas operacionais iniciais para:
- pico de falhas
- aumento de fallback
- degradacao de latencia
4. Implementar controles de protecao:
- limite por rota critica
- limite por janela temporal

Criterio de pronto da etapa:
- Time consegue responder em minutos: onde falhou, quanto impactou e qual fluxo foi afetado.

### Etapa 2 - Qualidade de Conversao
Objetivo da fase: melhorar qualidade de resposta e progressao de fase nas jornadas.

Entregas:
1. Definir dataset de avaliacao com historico real anonimizando dados sensiveis.
2. Definir scorecard de qualidade por fluxo:
- aderencia ao tom
- clareza de CTA
- progressao de fase
- risco de resposta inadequada
3. Criar rotina de avaliacao recorrente com comparacao entre versoes de prompt.
4. Executar testes A/B de prompts nas funcoes principais:
- personalizacao de mensagem
- conversa de jornada
- mensagem de abertura

Criterio de pronto da etapa:
- Existem ganhos comprovados por experimento em pelo menos 2 fluxos criticos.

### Etapa 3 - Otimizacao e Escala
Objetivo da fase: consolidar governanca de IA e ampliar eficiencia operacional.

Entregas:
1. Criar politica de rollout gradual para mudancas de prompt/modelo.
2. Implementar trilha de auditoria de mudancas:
- versao de prompt
- data de ativacao
- motivo da mudanca
- responsavel
3. Introduzir estrategia de custo e eficiencia:
- orcamento por fluxo
- metas de custo por conversao
4. Formalizar processo de melhoria continua com ritual recorrente por ciclo:
- revisar metricas
- fechar aprendizados
- priorizar proximo ciclo

Criterio de pronto da etapa:
- Time opera IA com governanca completa, previsibilidade de risco e controle de custo.

## Backlog por Etapa

### Etapa 1 - Concluída / Em Refinamento
1. Observabilidade de inferencia por fluxo. (Concluído)
2. Painéis operacionais de IA no admin. (Concluído)
3. Alertas de falha, fallback e health-check agendado. (Concluído)
4. Deduplicação de alertas e notificação via Webhook. (Concluído)

### Etapa 2 - Foco Atual (Qualidade de Conversão)
1. Definir dataset de avaliacao com historico real. (Entregue)
2. Construir scorecard de qualidade de resposta. (Entregue - Endpoint /eval/run por LLM-as-a-judge)
3. Criar rotina de avaliacao comparativa de prompts. (Entregue - Runner A/B visual no Admin)
4. Executar Testes A/B de prompt nos fluxos principais.

### Etapa 3 - Próximos Passos (Otimização e Escala)
1. Auditoria de mudancas de prompt/modelo e versionamento. (Entregue - Tabelas e PromptManager injetado)
2. Politica de rollout gradual.
3. Controle de custo por funcionalidade e orçamentos.

### Futuro / Ideias Adicionais
1. Cache inteligente para prompts repetidos.
2. Estudos comparativos de modelos alternativos.

## Mapa de Responsabilidades

### Dono de Produto IA
- Define metas de negocio e criterios de sucesso.
- Aprova prioridades por sprint.

### Especialista IA
- Propõe e valida melhorias de prompt/modelo.
- Conduz avaliacao e experimento A/B.

### Engenharia Backend
- Implementa instrumentacao, limites e deploy seguro.
- Mantem confiabilidade dos fluxos de IA.

### Operacoes
- Monitora alertas, incidentes e qualidade em producao.
- Mantem runbook de resposta.

## Indicadores Oficiais
1. Taxa de fallback por fluxo.
2. Taxa de erro de inferencia.
3. Latencia p50 e p95 por funcionalidade.
4. Taxa de progressao de fase em jornada.
5. Taxa de conversao por fluxo com IA.
6. Custo estimado por conversao.

## Cadencia de Atualizacao do Roadmap
- Atualizacao obrigatoria a cada entrega que altere IA.
- Revisao executiva ao fim de cada ciclo de entrega.
- Revisao estrategica por marco concluido (etapa).

## Modelo de Atualizacao (usar em toda evolucao)

Data da atualizacao:
Responsavel:
Entrega realizada:
Fluxos impactados:
Metricas antes:
Metricas depois:
Riscos identificados:
Acoes corretivas:
Proximos passos:

## Historico de Atualizacoes

### 2026-04-01 - Marco inicial de observabilidade de inferencia
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Tabela `ai_inference_logs` criada para telemetria de IA.
- Logging de inferencia integrado em:
	- `generatePersonalizedMessage`
	- `runPersonaConversation`
	- `generateJourneyOpeningMessage`
	- `simulatePersonaConversation`
	- `scheduled_ai_learning_loop`
Fluxos impactados:
- Personalizacao de mensagens
- Jornadas conversacionais
- Simulador admin
- Learning loop do agente scheduled
Metricas antes:
- Sem telemetria estruturada por inferencia.
Metricas depois:
- Registro de status, latencia, fallback e hash de prompt por chamada de IA.
Riscos identificados:
- Crescimento de volume da tabela exige rotina futura de retenção.
Acoes corretivas:
- Planejar política de retenção e agregação na Etapa 1.
Proximos passos:
- Criar consulta operacional para p50/p95, erro e fallback por fluxo.
- Adicionar alertas iniciais baseados em taxa de erro/fallback.

### 2026-04-01 - Health-check operacional agendado
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Health-check de IA integrado ao agente scheduled.
- Regras de severidade warning/critical aplicadas sobre erro, fallback e latência p95 (janela 24h).
- Geração de alerta operacional via `agent_decisions` com `decision_type = ai_ops_alert`.
Fluxos impactados:
- Operação contínua de IA
- Observabilidade e resposta a incidentes
Metricas antes:
- Dependência de verificação manual no dashboard para detecção de degradação.
Metricas depois:
- Detecção automática por ciclo agendado e registro de alerta estruturado.
Riscos identificados:
- Pode haver repetição de alerta em ciclos consecutivos durante incidentes longos.
Acoes corretivas:
- Planejar deduplicação com janela temporal em próxima iteração.
Proximos passos:
- Definir notificação ativa (ex.: webhook) para alertas críticos.
- Implementar deduplicação de alertas por severidade e janela.

### 2026-04-01 - Deduplicação e notificação crítica
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Deduplicação de alertas operacionais de IA por severidade via KV.
- Janela de dedupe:
	- warning: 1h
	- critical: 30min
- Notificação ativa para webhook configurável em alertas críticos.
Fluxos impactados:
- Health-check agendado
- Operação de incidentes IA
Metricas antes:
- Possibilidade de repetição de alertas em ciclos consecutivos.
Metricas depois:
- Redução de ruído operacional e escalonamento ativo para eventos críticos.
Riscos identificados:
- Webhook externo indisponível pode perder notificação em tempo real.
Acoes corretivas:
- Monitorar falhas de webhook em logs e configurar destino redundante.
Proximos passos:
- Criar painel de histórico de alertas e taxa de acionamento por severidade.

### 2026-04-01 - Histórico de alertas no Admin
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Endpoint `GET /admin/api/ai/alerts` criado para histórico de `ai_ops_alert`.
- Painel visual no Admin (view Agente Autônomo) com filtros por janela temporal.
Fluxos impactados:
- Observabilidade operacional de IA
- Triagem de incidentes e análise de tendência
Metricas antes:
- Consulta manual de alertas em logs e banco.
Metricas depois:
- Visualização centralizada de severidade, erro, fallback e p95 por evento.
Riscos identificados:
- Crescimento de histórico pode exigir paginação/retencão avançada.
Acoes corretivas:
- Planejar paginação e política de retenção no ciclo de otimização da Etapa 1.
Proximos passos:
- Adicionar taxa de acionamento por severidade (gráfico/tendência) no dashboard.

### 2026-04-01 - Exportação CSV de alertas
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Endpoint `GET /admin/api/ai/alerts/export.csv` para exportar histórico de alertas operacionais.
- Botão de exportação CSV no painel do Agente Autônomo.
Fluxos impactados:
- Avaliação offline de incidentes IA
- Trabalho do especialista de IA em análise de tendência
Metricas antes:
- Extração manual e ad-hoc dos dados de alertas.
Metricas depois:
- Download direto de dataset estruturado para auditoria e otimização.
Riscos identificados:
- Arquivos maiores em janelas amplas podem aumentar tempo de download.
Acoes corretivas:
- Limite de horas e limite de linhas no endpoint para controle operacional.
Proximos passos:
- Incluir export agregado de tendência diária por severidade.

### 2026-04-01 - Sistema de Geração de Evaluation Dataset
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Endpoint `GET /admin/api/ai/eval-dataset/export` para exportar dados reais.
- Geração de CSV/JSON ofuscando PII básico (Email, Phone, CPF).
- Botões de extração e seleção de limit inseridos na UI do painel do Agente Autônomo.
Fluxos impactados:
- Planejamento de Scorecards (Etapa 2)
- Melhoria contínua de prompts
Metricas antes:
- Nenhum acesso a interações completadas e estruturadas em massa testável.
Metricas depois:
- Exportação nativa de histórico ofuscado contendo as transcripts das conversas junto com flag de sucesso (`is_success`).
Riscos identificados:
- Ofuscação de PII por Regex nativa pode não pegar formatos exóticos de telefone/nomes customizados.
Acoes corretivas:
- Mapear futuramente uma rotina de ofuscação usando um modelo leve especializado (ex. token classification) para PII robusto.
Proximos passos:
- Construir a primeira rotina base de Scorecard que fará ingestão deste formato.

### 2026-04-01 - Scorecard Engine e A/B Runner
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Rotina `runPromptEvaluation` utilizando LLM-as-a-judge (`@cf/meta/llama-3-8b-instruct`).
- Scorecard com pontuação estrita para `tone` (1-5), `cta` (1-5), `safety` (0-1) e justificativa (`reasoning`).
- Rota `POST /admin/api/ai/eval/run` para simulação direta na Cloudflare.
- UI de A/B Testing inserida no painel Admin (Agente Autônomo).
Fluxos impactados:
- Workflow de experimentação do Especialista de IA.
Metricas antes:
- "Achismo" sobre qual prompt era melhor para o funil.
Metricas depois:
- Validação sistêmica rodando simulação paralela controlada (Prompt A vs Prompt B) com notas quantificáveis de Qualidade (QA).
Riscos identificados:
- Viés de auto-avaliação (O Llama-3-8B avaliando o modelo de geração Llama-3-8B pode ter tendência sistêmica à aprovação cega).
Acoes corretivas:
- Adicionar no pipeline a adoção do Llama-70B provido via API de Terceiros ou Workers AI (quando disponível para fallback) atuando exclusivamente de _Judge_.
Proximos passos:
- Executar os primeiros Testes A/B oficiais nos fluxos principais de personalização.

### 2026-04-01 - Pipeline de Versionamento e Auditoria de Prompts (Início Etapa 3)
Data da atualizacao: 2026-04-01
Responsavel: Engenharia
Entrega realizada:
- Tabela de rastreio `ai_prompt_versions` implementada com logs estruturados (Razão da mudança, Responsável, Modelo associado, Timestamp).
- Criação e Injeção do módulo `prompt-manager.ts` dentro do core (`ai.ts`).
- Função `generatePersonalizedMessage` agora busca ativamente a versão "vencedora" / atual da tabela no banco em vez de usar constante no código.
Fluxos impactados:
- Deploy de novos prompts testados
- Gestão de Configuração de AI (Dono de Produto de IA)
Metricas antes:
- Prompts "vencedores" precisavam de deploy via Pull Request para ir a prod.
- Risco de regressão silenciosa e impossibilidade de rollback em 1 segundo.
Metricas depois:
- Mudanças centralizadas e com rastreabilidade total (quem mudou, quando e o porquê). 
Riscos identificados:
- Custo de latência do request D1 adicional (resolvido temporariamente usando query direta otimizada de 1 índice `target_id` limit 1).
Acoes corretivas:
- Adicionar no pipeline cache no nível do Worker ou KV para segurar o prompt salvo em RAM e reduzir o `read` contínuo do banco.
Proximos passos:
- Implementar política de Rollout Gradual (Item 2 da Etapa 3).

### 2026-04-03 - Agente Conversacional de Newsletter com inicio via tela Admin
Data da atualizacao: 2026-04-03
Responsavel: Engenharia
Entrega realizada:
- Criado modulo `newsletter-agent.ts` para intencao, sentimento e resposta automatica.
- Criadas tabelas de sessao e historico (`newsletter_conversation_sessions`, `newsletter_conversation_messages`).
- Adicionado endpoint inbound `POST /webhooks/whatsapp/inbound` com autenticacao Bearer.
- Painel Admin ganhou view dedicada para:
 - iniciar conversa por contato
 - acompanhar historico de chat
 - revisar sentimento
 - salvar feedback/status
- Gateway Baileys passou a encaminhar inbound para o Worker quando `INBOUND_WEBHOOK_URL` estiver configurado.
Fluxos impactados:
- Conversao de newsletter via WhatsApp
- Observabilidade conversacional no painel operacional
Metricas antes:
- Nao havia trilha auditavel unica para abordagem conversacional de newsletter.
Metricas depois:
- Sessao e mensagens versionadas por contato com sinal de sentimento e feedback operacional.
Riscos identificados:
- Ambientes sem migracao podem nao possuir as tabelas novas.
Acoes corretivas:
- Funcoes de leitura foram tornadas resilientes para evitar quebra do dashboard sem migracao aplicada.
Proximos passos:
- Definir experimento A/B para mensagem inicial do agente.
- Adicionar agregacao temporal de conversao por janela (24h/7d/30d).

### 2026-04-03 - Agente Conversacional de Servicos (Agendamento, Orcamento e Duvidas)
Data da atualizacao: 2026-04-03
Responsavel: Engenharia
Entrega realizada:
- Criado modulo `service-agent.ts` para atendimento comercial no WhatsApp com intents de agendamento, orcamento, duvidas e opt-out.
- Criadas tabelas dedicadas de sessao, historico e pipeline (`service_conversation_sessions`, `service_conversation_messages`, `service_appointments`, `service_quotes`).
- Adicionado endpoint inbound `POST /webhooks/whatsapp/services/inbound` com autenticacao Bearer.
- Painel Admin ganhou view dedicada para:
 - iniciar atendimento por contato
 - acompanhar historico da sessao
 - registrar follow-up/notas operacionais
 - visualizar eventos de agendamento e orcamento
Fluxos impactados:
- Captura e qualificacao de demanda comercial via WhatsApp
- Rastreabilidade operacional de pipeline de atendimento
Metricas antes:
- Conversas comerciais de servicos nao tinham trilha estruturada unica entre inbound e operacao.
Metricas depois:
- Cada sessao gera historico auditavel, status de pipeline e eventos transacionais de agenda/orcamento.
Riscos identificados:
- Intencao ambigua pode classificar quote/agendamento com dados incompletos.
Acoes corretivas:
- Respostas de fallback coletam contexto faltante (servico, data/hora, faixa de investimento) para reduzir ruído.
Proximos passos:
- Adicionar score de qualificacao por sessao para priorizacao comercial.
- Implementar SLA de follow-up com alertas por tempo sem resposta.

### 2026-04-03 - Painel completo de configuracao do Service Agent
Data da atualizacao: 2026-04-03
Responsavel: Engenharia
Entrega realizada:
- Adicionada configuracao dedicada do Service Agent com persistencia em KV (`admin_config:service_agent`).
- Painel Admin ganhou formulario completo para ajustar:
 - auto-reply inbound
 - captura automatica de agendamentos/orcamentos
 - horario comercial e timezone
 - template de abertura, resposta fora de horario e script de qualificacao
 - modelo de IA e limite de caracteres
- Runtime do agente passou a ler essa configuracao em tempo real para abertura e respostas do webhook de servicos.
- Quando auto-reply estiver desligado, inbound e registrado e sinalizado para tratamento manual (`manual_queue`).
Fluxos impactados:
- Operacao comercial de atendimento via WhatsApp
- Governanca de prompts e parametros operacionais sem alteracao de codigo
Metricas antes:
- Parametros do agente estavam hardcoded no runtime, sem painel dedicado.
Metricas depois:
- Ajustes operacionais do Service Agent podem ser feitos pelo Admin com efeito imediato.
Riscos identificados:
- Configuracoes incoerentes de horario/timezone podem gerar resposta fora da janela esperada.
Acoes corretivas:
- Validacao de formato HH:MM no save e fallback seguro para defaults em leitura.
Proximos passos:
- Adicionar dry-run de configuracao para simular resposta do agente antes de publicar mudancas.
- Versionar historico de mudancas de configuracao por usuario admin.

## Definicao de Sucesso do Programa
O programa sera considerado bem-sucedido quando:
1. Houver melhoria consistente de qualidade e conversao com evidencias.
2. O time conseguir detectar e corrigir degradacoes rapidamente.
3. As mudancas de IA ocorrerem com processo padronizado e auditavel.
4. O custo de IA estiver dentro da meta por fluxo de negocio.

## Ligacao com Documentacao Existente
Este roadmap complementa:
- docs/AI_SYSTEM.md
- docs/SYSTEM_MAP.md
- docs/OPERATIONS_RUNBOOK.md

Atualize este arquivo primeiro em qualquer mudanca relevante de IA e depois reflita os detalhes tecnicos nos demais documentos.