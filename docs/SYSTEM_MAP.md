# System Map - Martech Viral System

## 1) Objetivo do sistema
O sistema roda na Cloudflare Edge para automatizar marketing com:
- personalizacao de mensagens via Workers AI
- disparo multicanal via webhook externo
- tracking viral por links de referral
- agente autonomo com cron para otimizar canal e campanhas

## 2) Componentes principais
| Componente | Papel | Arquivo/config |
|---|---|---|
| Cloudflare Worker + Hono | API HTTP, orquestração de fluxo e agente scheduled | `src/index.ts` |
| Admin Web Panel | Operação manual e Playground AI | `src/routes/admin.ts` |
| D1 | Persistência (Users, Legos, Interactions, Learning Loops) | `schema.sql` |
| Workers AI | Geração de copy e Análise de Funil | binding `AI` |
| Segmentation Module | Gerenciamento de segmentos de usuários para campanhas direcionadas | `src/segmentation.ts` |
| Freezing Rules Module | Regras automáticas de congelamento para usuários, campanhas e segmentos | `src/freezing-rules.ts` |

## 3) Arquitetura em alto nível
```text
[Client/Lead] <--> [Public API / Ref Links]
                       |
[Admin Dashboard] <--> [Admin API / Playground]
     |                 |
     |          [Cloudflare Worker]
     |           /      |       \
     |   [Workers AI] [D1 DB] [Webhooks]
     |      (Review)  (Lego)  (Dispatch)
```

## 4) Fluxos de negócio

### 4.1 Jornadas AI (Lego Architecture)
1. **Persona:** Criada com um System Prompt específico (ex: "Rafael, colega infiltrado").
2. **Produto:** Definido com descrição e link de checkout.
3. **Jornada:** Criada ligando uma Persona a um Produto.
4. **Lead Enrollment:** Quando um lead inicia conversa, a IA assume o tom da Persona para vender o Produto.

### 4.2 Agente de Revisão Sistemática (Cron)
Executa a cada 6h:
1. **Analise de Drop-off:** Identifica jornadas com mais de 3 leads parados no funil.
2. **AI Audit:** Envia amostras de conversas para o LLaMa 3 analisar o "churn".
3. **Learning Loop:** Grava sugestão de ajuste de prompt em `ai_learning_loops`.
4. **Aplicação:** O Admin revisa e aplica o novo prompt para otimizar a conversão linear.

### 4.3 Outros fluxos (Referral & Opt-out)
*Mantidos conforme MVP original (veja README).*

## 5) Modelo de dados (Fase 2)

### `personas`
- identidade visual e psicológica da IA
- `system_prompt` base

### `products`
- o que está sendo vendido
- descrição para o contexto da IA

### `journeys`
- conectores entre leads, personas e produtos

### `ai_learning_loops`
- repositório de inteligência e sugestões de melhoria

### `interactions` & `agent_decisions`
- trilha de eventos e decisões automáticas

## 6) Pesos de engajamento por evento
| Evento | Peso |
|---|---:|
| `sent` | 0.25 |
| `opened` | 1 |
| `clicked` | 2 |
| `shared` | 3 |
| `converted` | 5 |
| `referral_click` | 1 |
| `personalized` | 1.5 |
| `send_failed` | 0 |

## 7) Ambientes
| Ambiente | Worker | D1 | KV | Rota |
|---|---|---|---|---|
| preview | `martech-viral-system-preview` | `martech_db_preview` | `059caa2e...` | `*.workers.dev` |
| production | `martech-viral-system` | `martech_db` | `70edae18...` | `fluxoia.com/*` |

## 8) Configuracoes criticas
- `LANDING_PAGE_URL`: destino do redirect referral
- `DISPATCH_WEBHOOK_URL` e overrides por canal (`WHATSAPP_`, `EMAIL_`, `TELEGRAM_`)
- `DISPATCH_BEARER_TOKEN` (secret) para autenticar envio
- `ADMIN_API_KEY` (secret) para proteger API administrativa
- `ADMIN_PANEL_PASSWORD` e `ADMIN_SESSION_SECRET` (secrets) para painel web
- `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST`: hosts permitidos no `webhookUrlOverride` (somente preview)
- Gateway Baileys usa os mesmos tokens de dispatch para validar chamadas do Worker

## 9) Limites atuais
- Sem fila com retry/backoff no dispatch (falhas sao logadas, mas sem reprocessamento automatico)
- Testes de integracao ainda parciais (admin/login e dispatch cobertos; faltam cenarios de referral/interaction/consent completo)
- Sem painel frontend dedicado para `agent_decisions` (dados ja existem no D1)
