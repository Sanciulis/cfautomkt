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
| Cloudflare Worker + Hono | API HTTP, orchestracao de fluxo e agente scheduled | `src/index.ts` |
| Admin Web Panel | Operacao manual com login/sessao (criar user/campaign e dispatch) | rotas `/admin/*` em `src/index.ts` |
| D1 | Persistencia de usuarios, campanhas, eventos e decisoes do agente | `schema.sql` |
| KV | Dedupe de clique referral por IP hash + janela TTL | binding `MARTECH_KV` |
| Workers AI | Geracao de copy personalizada | binding `AI` |
| Webhook externo | Entrega real (whatsapp/email/telegram) | vars `*_WEBHOOK_URL` |
| GitHub Actions | CI/CD para preview e producao | `.github/workflows/deploy.yml` |

## 3) Arquitetura em alto nivel
```text
[Client API + Browser Admin]
    |
    v
[Cloudflare Worker API - Hono]
    | \
    |  \--> [Workers AI] (personalizacao)
    |
    +-----> [D1] (users/campaigns/interactions/agent_decisions)
    |
    +-----> [KV] (referral dedupe)
    |
    +-----> [Webhook Provider] (disparo real por canal)
```

## 4) Fluxos de negocio

### 4.1 Cadastro de usuario
1. `POST /user`
2. Worker gera `referral_code`
3. Persiste em `users`

Resultado: usuario pronto para funis e referral.

### 4.1b Painel admin (web)
1. `GET /admin/login` abre tela de autenticacao
2. `POST /admin/login` valida senha (`ADMIN_PANEL_PASSWORD`)
3. Worker cria cookie de sessao assinado (`ADMIN_SESSION_SECRET`)
4. `GET /admin` carrega dashboard com metricas, campanhas e decisoes
5. Acoes via formulario:
   - `POST /admin/actions/user/create`
   - `POST /admin/actions/campaign/create`
   - `POST /admin/actions/campaign/dispatch`

### 4.2 Registro de eventos
1. `POST /interaction`
2. Valida `eventType`
3. Grava em `interactions`
4. Atualiza `engagement_score` em `users` com peso do evento

Observacao: evento `shared` incrementa `viral_points`.

### 4.3 Personalizacao pontual
1. `POST /personalize/:id`
2. Carrega usuario (e campanha opcional)
3. Chama Workers AI com prompt contextual
4. Retorna mensagem + grava evento `personalized`

### 4.4 Referral tracking
1. Usuario compartilha `/ref/:code`
2. Worker identifica dono do code no D1
3. Deduplica por `user + ipHash` no KV (TTL 1h)
4. Se novo clique: grava `referral_click` e soma `viral_points`
5. Redireciona para landing com `?ref=<code>`

### 4.5 Dispatch de campanha
1. `POST /campaign/:id/send`
2. Carrega campanha e valida status (`paused` bloqueia, exceto `force=true`)
3. Resolve canal e URL de webhook
4. Seleciona usuarios por filtro:
   - `userIds` explicitos, ou
   - canal + atividade recente (ou `includeInactive=true`)
5. Opcional: personaliza mensagem por usuario
6. Envia para webhook (ou simula com `dryRun=true`)
7. Registra:
   - `sent` em sucesso
   - `send_failed` em falha

Observacao: em `preview`, existe `webhookUrlOverride` para testes controlados com restricao de host por allowlist.

### 4.6 Agente autonomo (cron)
Executa a cada 6h:
1. Move usuarios frios para canal `sms`
2. Analisa conversao de campanhas ativas nos ultimos 7 dias
3. Pausa campanha com baixo desempenho (`sent >= 20` e `conversion < 2%`)
4. Registra recomendacao para power referrers (`viral_points >= 5`)

Tudo logado em `agent_decisions`.

## 5) Modelo de dados

### `users`
- identidade e contato
- canal preferido
- perfil psicologico
- score de engajamento
- referral (`referral_code`, `referred_by`, `viral_points`)

### `campaigns`
- copy base
- incentivo
- canal
- status (`active|paused`)

### `interactions`
- eventos do funil e operacao (`sent`, `clicked`, `send_failed`, etc.)
- metadados JSON para debug/rastreabilidade

### `agent_decisions`
- trilha de decisoes automaticas do cron

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

## 9) Limites atuais
- Sem fila com retry/backoff no dispatch (falhas sao logadas, mas sem reprocessamento automatico)
- Sem testes automatizados de integracao ainda
- Sem painel frontend dedicado para `agent_decisions` (dados ja existem no D1)
