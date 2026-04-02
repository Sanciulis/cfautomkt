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
- `GET /admin?controlType=<campaign|journey>&controlId=<id>&detailLevel=<summary|operations|full>` (abre Control Room com contexto selecionado)
- `POST /admin/actions/user/create` (cria usuario via formulario)
- `POST /admin/actions/campaign/create` (cria campanha via formulario)
- `POST /admin/actions/campaign/dispatch` (executa dispatch via formulario)
- `POST /admin/actions/control/status` (inicia, pausa ou para campanha/jornada)
- `POST /admin/actions/control/edit` (edita campos operacionais de campanha/jornada)
- `POST /admin/actions/integration/save` (salva configuracao WhatsApp)
- `POST /admin/actions/integration/test` (executa teste real no webhook WhatsApp)

Protecoes adicionais:
- rate limit no login por IP (janela de 10 min)
- bloqueio temporario apos 5 falhas consecutivas (15 min)
- em bloqueio, resposta `429` com header `Retry-After`

## Integracao WhatsApp no Admin (sessao web)

### POST /admin/actions/integration/save
Salva configuracao da integracao WhatsApp no KV (`admin_config:integration:whatsapp`).

Campos de formulario:
- `webhookUrl` (obrigatorio)
- `testPhone` (opcional)
- `testMessage` (opcional)

Comportamento:
- valida URL (`http/https`, em producao exige `https`)
- grava timestamp de atualizacao
- redireciona de volta para `/admin` com notice de sucesso/erro

### POST /admin/actions/integration/test
Dispara teste da integracao usando o webhook configurado (ou `webhookUrl` override no formulario).

Campos de formulario:
- `testPhone` (obrigatorio, ou ja salvo)
- `testMessage` (opcional)
- `webhookUrl` (opcional; override apenas para este teste)

Comportamento:
- envia payload no formato de dispatch para o webhook WhatsApp
- usa `Authorization: Bearer <DISPATCH_BEARER_TOKEN>`
- em sucesso/falha, redireciona para `/admin` com status

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

## Jornadas (Journey Management)

### POST /journey
Cria uma jornada conversacional com persona AI.

Request:
```json
{
  "id": "onboarding-premium",
  "name": "Onboarding Premium Q4",
  "objective": "Converter leads frios em clientes pagantes",
  "systemPrompt": "Você é a Ana, consultora de marketing digital..."
}
```

Response `201`:
```json
{
  "status": "success",
  "journeyId": "onboarding-premium"
}
```

### GET /journeys
Lista todas as jornadas.

### GET /journey/:id
Retorna detalhes de uma jornada específica.

### PUT /journey/:id
Atualiza nome, objetivo ou system prompt de uma jornada.

### POST /journey/:id/toggle
Alterna status da jornada entre `active` e `paused`.

### POST /journey/:id/enroll
Inscreve um lead em uma jornada.

Request:
```json
{
  "userId": "u-001",
  "phase": "discovery"
}
```

### GET /journey/:id/enrollments
Lista inscricoes de uma jornada.

### POST /journey/:journeyId/user/:userId/advance
Avanca o lead para a proxima fase da jornada (AIDA).

Fases: `discovery` → `interest` → `desire` → `action` → `retained`

Response:
```json
{
  "status": "success",
  "advanced": true,
  "newPhase": "interest",
  "completed": false
}
```

### POST /journey/:journeyId/user/:userId/chat
Endpoint de conversacao com persona AI. Envia mensagem do lead e recebe resposta inteligente.

Request:
```json
{
  "message": "Me conta mais sobre isso?"
}
```

Response:
```json
{
  "status": "success",
  "response": "Olha, vou te falar uma coisa...",
  "phaseAdvanced": true,
  "currentPhase": "interest"
}
```

Comportamento:
- A IA responde no tom da persona definida no `systemPrompt` da jornada
- Historico de conversacao e mantido (ultimas 30 mensagens)
- A fase do lead pode avancar automaticamente com base nas respostas
- Maximo de 400 caracteres por resposta

### POST /journey/:journeyId/user/:userId/open
Gera mensagem de abertura para primeiro contato com lead em uma jornada.

Response:
```json
{
  "status": "success",
  "message": "E aí Ana! Tudo bem? Vi que você..."
}
```

## Admin Panel - Jornadas

Rotas do painel:
- `POST /admin/actions/journey/create` (cria jornada via formulario)
- `POST /admin/actions/journey/toggle` (alterna status da jornada)
- `POST /admin/actions/journey/enroll` (inscreve lead em jornada)

## Erros comuns
- `400`: payload invalido
- `404`: usuario/campanha/jornada nao encontrado
- `409`: campanha pausada sem `force=true`
- `429`: muitas tentativas de login admin
- `500`: webhook nao configurado para canal

## Legos & Playground (Fase 2)

### POST /admin/api/playground/chat
Simulação de chat marketing com IA sem persistência de banco.
- Protegido por sessão admin (Cookie).
- Permite configurar `systemPrompt`, `objective`, `currentPhase`, `userProfile` no corpo da requisição.

### Entidades Desacopladas (Modulares)
- **Personas:** `PersonaRecord` em `types.ts`.
- **Products:** `ProductRecord` em `types.ts`.
- **Learning Loops:** Registro de sugestões automáticas da IA para os prompts das Personas.

As novas APIs de Jornadas agora realizam JOINs automáticos para retornar o `system_prompt` da Persona e o `objective` do Produto vinculados.
# #   S e g m e n t a � � o 
 
 # # #   C r i a r   S e g m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / s e g m e n t / c r e a t e ` 
 -   * * B o d y * * :   ` n a m e ` ,   ` d e s c r i p t i o n `   ( o p c i o n a l ) ,   ` c r i t e r i a `   ( J S O N   a r r a y   d e   S e g m e n t C r i t e r i a ) 
 -   * * E x e m p l o   c r i t e r i a * * :   ` [ { " f i e l d " :   " e n g a g e m e n t _ s c o r e " ,   " o p e r a t o r " :   " g t " ,   " v a l u e " :   5 } ,   { " f i e l d " :   " p r e f e r r e d _ c h a n n e l " ,   " o p e r a t o r " :   " e q " ,   " v a l u e " :   " w h a t s a p p " } ] ` 
 
 # # #   L i s t a r   S e g m e n t o s 
 ` G E T   / a d m i n / a p i / s e g m e n t s ` 
 -   * * R e s p o s t a * * :   ` {   s e g m e n t s :   S e g m e n t R e c o r d [ ]   } ` 
 
 # # #   A t u a l i z a r   S e g m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / s e g m e n t / u p d a t e ` 
 -   * * B o d y * * :   ` s e g m e n t I d ` ,   ` n a m e `   ( o p c i o n a l ) ,   ` d e s c r i p t i o n `   ( o p c i o n a l ) ,   ` c r i t e r i a `   ( o p c i o n a l ) 
 
 # # #   D e l e t a r   S e g m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / s e g m e n t / d e l e t e ` 
 -   * * B o d y * * :   ` s e g m e n t I d ` 
 
 # # #   O b t e r   U s u � r i o s   e m   S e g m e n t o 
 ` G E T   / a d m i n / a p i / s e g m e n t s / : s e g m e n t I d / u s e r s ` 
 -   * * R e s p o s t a * * :   ` {   u s e r s :   U s e r R e c o r d [ ]   } ` 
 
 # # #   A t u a l i z a r   S e g m e n t o s   d e   U s u � r i o 
 ` P O S T   / a d m i n / a c t i o n s / s e g m e n t / r e f r e s h ` 
 -   * * B o d y * * :   ` u s e r I d `   ( r e a v a l i a   t o d o s   o s   s e g m e n t o s   p a r a   o   u s u � r i o ) 
 
 # #   R e g r a s   d e   C o n g e l a m e n t o 
 
 # # #   C r i a r   R e g r a   d e   C o n g e l a m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / f r e e z i n g - r u l e / c r e a t e ` 
 -   * * B o d y * * :   ` t y p e `   ( u s e r _ f r e e z e / c a m p a i g n _ f r e e z e / s e g m e n t _ f r e e z e ) ,   ` n a m e ` ,   ` d e s c r i p t i o n `   ( o p c i o n a l ) ,   ` c o n d i t i o n s `   ( J S O N ) ,   ` a c t i o n s `   ( J S O N ) ,   ` p r i o r i t y `   ( o p c i o n a l ) 
 
 # # #   A t u a l i z a r   R e g r a   d e   C o n g e l a m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / f r e e z i n g - r u l e / u p d a t e ` 
 -   * * B o d y * * :   ` r u l e I d ` ,   c a m p o s   o p c i o n a i s   p a r a   a t u a l i z a � � o 
 
 # # #   D e l e t a r   R e g r a   d e   C o n g e l a m e n t o 
 ` P O S T   / a d m i n / a c t i o n s / f r e e z i n g - r u l e / d e l e t e ` 
 -   * * B o d y * * :   ` r u l e I d ` 
 
 # # #   C r i a r   R e g r a s   P a d r � o 
 ` P O S T   / a d m i n / a c t i o n s / f r e e z i n g - r u l e / c r e a t e - d e f a u l t s ` 
 -   C r i a   r e g r a s   p r � - c o n f i g u r a d a s   p a r a   c e n � r i o s   c o m u n s 
 
 # # #   L i s t a r   R e g r a s   d e   C o n g e l a m e n t o 
 ` G E T   / a d m i n / a p i / f r e e z i n g - r u l e s ` 
 -   * * Q u e r y * * :   ` t y p e `   ( o p c i o n a l ,   f i l t r a   p o r   t i p o ) 
 -   * * R e s p o s t a * * :   ` {   r u l e s :   F r e e z i n g R u l e [ ]   } ` 
 
 