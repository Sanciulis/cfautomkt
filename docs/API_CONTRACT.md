# API Contract - Martech Viral System

Base URLs:
- Preview: `https://martech-viral-system-preview.bkpdsf.workers.dev`
- Production: `https://fluxoia.com`

## Autenticacao administrativa
Quando o secret `ADMIN_API_KEY` estiver configurado no Worker, os endpoints administrativos exigem:
- Header `x-api-key: <token>`, ou
- Header `Authorization: Bearer <token>`

Endpoints protegidos:
- `GET /user/:id`
- `POST /user`
- `POST /user/:id/consent`
- `POST /campaign`
- `POST /interaction`
- `POST /personalize/:id`
- `POST /campaign/:id/send`
- `GET /metrics/overview`

## Autenticacao do painel admin (web)
O painel web usa login por senha e cookie de sessao assinado.

Secrets recomendados:
- `ADMIN_PANEL_PASSWORD`
- `ADMIN_SESSION_SECRET`

Compatibilidade:
- Se esses secrets nao estiverem definidos, o Worker usa `ADMIN_API_KEY` como fallback.

Rotas do painel:
- `GET /admin/login` (formulario de login)
- `POST /admin/login` (valida senha e seta cookie `martech_admin_session`)
- `POST /admin/logout` (invalida cookie)
- `GET /admin` (dashboard protegido)
- `POST /admin/actions/user/create` (cria usuario via formulario)
- `POST /admin/actions/campaign/create` (cria campanha via formulario)
- `POST /admin/actions/campaign/dispatch` (executa dispatch via formulario)

Protecoes adicionais:
- rate limit no login por IP (janela de 10 min)
- bloqueio temporario apos 5 falhas consecutivas (15 min)
- em bloqueio, resposta `429` com header `Retry-After`

## GET /
Status do worker.

Response:
```json
{
  "name": "Viral Marketing System",
  "status": "ok",
  "env": "preview"
}
```

## POST /user
Cria usuario.

Request:
```json
{
  "id": "u-whats-001",
  "name": "Ana",
  "email": "ana@example.com",
  "phone": "+5511999990001",
  "preferredChannel": "whatsapp",
  "psychologicalProfile": "empreendedor",
  "referredBy": "u-root-001"
}
```

Response `201`:
```json
{
  "status": "success",
  "user": {
    "id": "u-whats-001",
    "referralCode": "uwhats00abc123"
  }
}
```

## GET /user/:id
Retorna perfil do usuario.

## POST /user/:id/consent
Atualiza consentimento de marketing (opt-in/opt-out).

Request:
```json
{
  "marketingOptIn": false,
  "source": "admin_api"
}
```

Response:
```json
{
  "status": "success",
  "user": {
    "id": "u-whats-001",
    "marketingOptIn": false,
    "optOutAt": "2026-03-29 12:00:00",
    "consentSource": "admin_api",
    "consentUpdatedAt": "2026-03-29 12:00:00"
  }
}
```

## POST /campaign
Cria campanha.

Request:
```json
{
  "id": "cmp-whats-001",
  "name": "Campanha WhatsApp MVP",
  "baseCopy": "Oferta limitada para hoje.",
  "incentiveOffer": "Convide 2 amigos e ganhe bonus",
  "channel": "whatsapp"
}
```

Response `201`:
```json
{
  "status": "success",
  "campaignId": "cmp-whats-001"
}
```

## POST /interaction
Registra evento no funil.

Eventos aceitos:
- `sent`
- `opened`
- `clicked`
- `shared`
- `converted`
- `referral_click`
- `personalized`
- `send_failed`

Request:
```json
{
  "userId": "u-whats-001",
  "campaignId": "cmp-whats-001",
  "channel": "whatsapp",
  "eventType": "clicked",
  "metadata": { "source": "landing" }
}
```

## POST /personalize/:id
Gera copy personalizada para usuario.

Request:
```json
{
  "campaignId": "cmp-whats-001",
  "baseCopy": "Oferta base opcional"
}
```

Response:
```json
{
  "user": {
    "id": "u-whats-001",
    "preferredChannel": "whatsapp",
    "engagementScore": 3.5
  },
  "campaignId": "cmp-whats-001",
  "personalizedMessage": "..."
}
```

## GET /ref/:code
Rastreia clique viral e redireciona para landing.

Comportamento:
- aplica dedupe em KV (janela 1h por user+ipHash)
- grava `referral_click` quando elegivel
- soma `viral_points` para dono do code
- redirect `302` para `LANDING_PAGE_URL?ref=<code>`

## GET /unsubscribe/:code
Descadastro publico usando o `referral_code` do usuario.

Comportamento:
- aplica `marketing_opt_in = 0`
- registra `opt_out_at` e atualiza metadados de consentimento
- retorna pagina HTML de confirmacao (sucesso ou erro)

## POST /campaign/:id/send
Dispara campanha para lote de usuarios.

Request:
```json
{
  "userIds": ["u-whats-001", "u-whats-002"],
  "limit": 100,
  "personalize": true,
  "dryRun": false,
  "channel": "whatsapp",
  "includeInactive": false,
  "force": false,
  "metadata": { "batch": "2026-03-29" }
}
```

Campos especiais:
- `dryRun=true`: nao envia webhook; valida selecao/fluxo
- `force=true`: ignora bloqueio de campanha `paused`
- `webhookUrlOverride` (apenas preview): override temporario de destino do webhook
- `webhookUrlOverride` exige `https://`, sem credenciais em URL, e host presente em `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST`

Response:
```json
{
  "status": "success",
  "campaignId": "cmp-whats-001",
  "channel": "whatsapp",
  "dryRun": false,
  "requested": 2,
  "sent": 2,
  "failed": 0,
  "skipped": 0,
  "failures": []
}
```

Payload enviado ao webhook inclui:
- `referralUrl`
- `unsubscribeUrl` (quando disponivel para o usuario)

### Exemplo de integracao WhatsApp com gateway Baileys
Destino sugerido em `WHATSAPP_WEBHOOK_URL`:
- `https://<gateway>/dispatch/whatsapp`

Autenticacao:
- Worker envia `Authorization: Bearer <DISPATCH_BEARER_TOKEN>`
- Gateway deve validar o mesmo token

Payload esperado no gateway:
```json
{
  "channel": "whatsapp",
  "campaign": { "id": "cmp-whats-001", "name": "Campanha WhatsApp MVP" },
  "user": {
    "id": "u-whats-001",
    "name": "Ana",
    "email": "ana@example.com",
    "phone": "+5511999990001",
    "preferredChannel": "whatsapp"
  },
  "message": "Oferta limitada para hoje",
  "referralUrl": "https://fluxoia.com/ref/abc",
  "unsubscribeUrl": "https://fluxoia.com/unsubscribe/abc",
  "metadata": { "batch": "2026-03-29" }
}
```

Resposta esperada (2xx):
```json
{
  "status": "success",
  "provider": "baileys",
  "campaignId": "cmp-whats-001",
  "userId": "u-whats-001",
  "to": "5511999990001@s.whatsapp.net",
  "messageId": "ABCD1234"
}
```

## GET /metrics/overview
Consolida metricas do sistema.

Response:
```json
{
  "totals": {
    "users": 3,
    "interactions": 6,
    "sent": 2,
    "conversions": 0,
    "shares": 0,
    "activeCampaigns": 1
  },
  "metrics": {
    "conversionRate": 0,
    "kFactor": 0
  },
  "topReferrers": []
}
```

## Erros comuns
- `400`: payload invalido
- `404`: usuario/campanha nao encontrado
- `409`: campanha pausada sem `force=true`
- `429`: muitas tentativas de login admin
- `500`: webhook nao configurado para canal
