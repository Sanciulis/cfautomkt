# Estratégia Operacional Martech (90 Dias)

## 1) Norte Estratégico

**Objetivo principal (Q2/Q3 2026)**  
Transformar o painel em uma máquina previsível de conversão, com operação semanal orientada por dados e decisões rápidas de otimização.

**North Star Metric (NSM)**  
`Leads convertidos por semana` (com consentimento válido e origem rastreável).

**Metas de 90 dias**
- Aumentar em **+25%** os leads convertidos/semana.
- Reduzir em **-30%** o tempo médio entre primeiro contato e conversão.
- Manter opt-out abaixo de **5%** nas campanhas ativas.
- Ter **100%** das ações críticas registradas no Control Room (start/pause/stop/edit).

---

## 2) Fluxo Operacional Oficial (fonte única de verdade)

1. `Entrada de lead`  
Usuário entra por grupo, API, upload ou inbound.

2. `Qualificação inicial`  
Definição de canal preferencial e contexto mínimo do lead.

3. `Orquestração`  
Envio para Campanha (broadcast), Jornada (AIDA), Newsletter Agent ou Service Agent.

4. `Execução e monitoramento`  
Acompanhamento em Dashboard + Control Room com ajustes de copy, status e ritmo.

5. `Conversão`  
Lead realiza ação final (compra, agendamento, orçamento, inscrição).

6. `Retenção e loop de melhoria`  
Análise de desempenho, ajustes de prompt e novos testes.

**Regra operacional**  
Toda operação ativa precisa estar vinculada a um objetivo claro (ex.: “agendar consulta”, “captar newsletter”, “pedir orçamento”) e a um dono responsável.

---

## 3) KPIs Obrigatórios por Módulo

## Dashboard
- Leads totais (crescimento semanal)
- Conversão média
- Erro de IA, fallback e latência p95
- Tendência de alertas críticos/warning

## Campaigns
- Envios
- Abertura/engajamento
- Conversão por campanha
- Falhas por canal

## Journeys (AIDA)
- Leads por fase (Discovery, Interest, Desire, Action, Retained)
- Taxa de avanço entre fases
- Tempo médio por fase

## Newsletter Agent
- Sessões ativas
- Taxa de inscrição/conversão
- Sentimento médio
- Opt-out por sessão e por mensagem

## Service Agent
- Sessões qualificadas
- Agendamentos criados/confirmados
- Orçamentos solicitados/enviados/aceitos
- Taxa de evolução de `question -> appointment|quote`

## Control Room
- Volume de ações operacionais (start/pause/stop/edit)
- Impacto após ação (janela de 24h e 7 dias)
- Campanhas/jornadas sem atualização > 7 dias

---

## 4) Cadência de Gestão

## Diário (15-20 min)
- Verificar alertas de IA e falhas de envio.
- Checar operações pausadas/estagnadas.
- Tratar incidentes de integração (WhatsApp/Email/Telegram).

## Semanal (60 min)
- Revisar KPIs por módulo.
- Escolher **1 hipótese principal** para teste (copy, canal, oferta, segmento ou prompt).
- Definir dono, janela do teste e critério de sucesso.
- Encerrar com decisão: escalar, ajustar ou descartar.

## Mensal (90 min)
- Revisar tendência de 4 semanas.
- Atualizar baseline de conversão.
- Repriorizar backlog P0/P1/P2.

---

## 5) Matriz de Decisão (quem decide o quê)

- **Growth/Negócio**: objetivo da campanha/jornada e critério de sucesso.
- **Operações**: priorização diária e execução no Control Room.
- **IA/Produto**: ajustes de prompt, persona e fallback.
- **Engenharia**: confiabilidade, integrações e telemetria.

**SLA recomendado**
- Incidente crítico (envio indisponível): resposta em até 30 min.
- Degradação moderada de IA: plano de ação em até 24h.

---

## 6) Backlog Prioritário (Execução)

## P0 (imediato, 1-2 semanas)
- Definir baseline oficial dos KPIs atuais (semana 0).
- Criar naming padrão para campanhas/jornadas (objetivo-canal-data).
- Implantar rotina semanal fixa de experimento único.
- Criar checklist operacional pré-disparo (token, webhook, status canal, dry-run).

## P1 (2-6 semanas)
- Painel com “impacto por ação” no Control Room (antes/depois).
- Alertas automáticos para campanhas sem progresso e jornadas travadas.
- Segmentação mínima por intenção/canal para reduzir envio genérico.
- Playbooks por objetivo: inscrição newsletter, orçamento, agendamento.

## P2 (6-12 semanas)
- Score de lead para priorização de atendimento.
- Biblioteca de prompts/versionamento com “vencedor atual”.
- Relatório executivo semanal automático (KPI + decisões + próximos testes).

---

## 7) Plano de 90 Dias (Sprintado)

## Fase 1 (Dias 1-30): Clareza e controle
- Baseline de métricas.
- Rituais semanais em funcionamento.
- Donos definidos por módulo.
- Checklists operacionais aplicados.

## Fase 2 (Dias 31-60): Otimização orientada por hipótese
- 4 a 6 experimentos completos.
- Redução de opt-out e aumento de avanço de fase.
- Ajustes de prompt com evidência de impacto.

## Fase 3 (Dias 61-90): Escala com previsibilidade
- Playbooks consolidados por objetivo.
- Priorização por score/intenção.
- Relatório executivo recorrente.

---

## 8) Definição de Sucesso

A ferramenta “faz sentido” quando:
- O time sabe **o que medir**, **quem decide** e **o que fazer toda semana**.
- Cada ação no painel tem objetivo e impacto mensurável.
- Conversão melhora com previsibilidade, e não por esforço ad-hoc.

---

## 9) Próxima Reunião de Alinhamento (roteiro)

1. Confirmar NSM e metas de 90 dias.  
2. Validar donos por módulo.  
3. Congelar KPI baseline (semana 0).  
4. Selecionar primeiro experimento da semana.  
5. Definir data de revisão e critério de sucesso.

