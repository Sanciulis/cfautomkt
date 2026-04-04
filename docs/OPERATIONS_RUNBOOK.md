# Operations Runbook - Martech Viral System

## 1) Prerequisitos
- Node.js + npm
- Wrangler v4
- Cloudflare API Token + Account ID

## 2) Setup local
```bash
npm install
npm run typecheck
npx wrangler d1 execute martech_db --local --file=./schema.sql
npx wrangler dev
```

### 2.1) Gateway WhatsApp (Baileys) local
```bash
cd integrations/whatsapp-baileys-gateway
cp .env.example .env
npm install
npm run dev
```

Checklist:
1. Definir `DISPATCH_BEARER_TOKEN` no `.env` do gateway.
2. Autenticar WhatsApp via QR (terminal) ou pairing code.
3. Confirmar health:
```bash
curl http://localhost:8788/health
```

## 3) Migracoes de banco

### Banco novo
Use `schema.sql`.

### Banco legado (producao antiga)
Use migracao dedicada:
```bash
npx wrangler d1 execute martech_db --remote --file=./migrations/legacy/20260329_expand_legacy_schema.sql
```

Depois reaplique schema para garantir indexes e tabelas:
```bash
npx wrangler d1 execute martech_db --remote --file=./schema.sql
```

### Migracao de consentimento (LGPD)
Aplicar uma vez por ambiente:
```bash
npx wrangler d1 execute martech_db --remote --file=./migrations/legacy/20260329_add_user_consent_columns.sql
npx wrangler d1 execute martech_db_preview --remote --env preview --file=./migrations/legacy/20260329_add_user_consent_columns.sql
```

Observacao:
- Arquivos em `migrations/legacy/` sao migracoes de banco antigo e devem ser executados manualmente quando necessario.

## 4) Deploy

### Preview
```bash
npx wrangler deploy --env preview --minify
```

### Producao
```bash
npx wrangler deploy --minify
```

## 4.1) Fluxo de PR com GitHub Actions (obrigatório)

Workflows existentes:
- `.github/workflows/deploy.yml` (`Cloudflare CI/CD`)
- `.github/workflows/security-scan.yml` (`Security Scan`)

Checklist antes do merge:
1. Abrir PR para `main`.
2. Aguardar execução dos workflows obrigatórios.
3. Confirmar status verde em:
- `Cloudflare CI/CD` (job `validate`)
- `Security Scan` (job `Secret Scan (Gitleaks)`)
4. Não realizar merge com checks obrigatórios falhando.
5. Em caso de exceção, registrar justificativa formal no PR.

Observações:
- Em PR, o workflow de CI/CD executa `validate` e `deploy-preview`.
- Em `push` na `main`, o workflow de CI/CD executa `validate` e `deploy-production`.

## 5) Secrets obrigatorios
```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put ADMIN_API_KEY --env preview
npx wrangler secret put ADMIN_PANEL_PASSWORD
npx wrangler secret put ADMIN_PANEL_PASSWORD --env preview
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET --env preview
npx wrangler secret put DISPATCH_BEARER_TOKEN
npx wrangler secret put DISPATCH_BEARER_TOKEN --env preview
npx wrangler secret put AI_ALERT_WEBHOOK_URL
npx wrangler secret put AI_ALERT_WEBHOOK_URL --env preview
npx wrangler secret put AI_ALERT_WEBHOOK_TOKEN
npx wrangler secret put AI_ALERT_WEBHOOK_TOKEN --env preview
```

Gateway Baileys:
- configure o mesmo valor de `DISPATCH_BEARER_TOKEN` no `.env` do gateway
- configure `GATEWAY_ADMIN_TOKEN` dedicado para endpoints de sessao (`/session/*`)

Observacao:
- O painel admin funciona com fallback para `ADMIN_API_KEY`, mas em producao use `ADMIN_PANEL_PASSWORD` e `ADMIN_SESSION_SECRET` dedicados.
- `webhookUrlOverride` em preview so aceita hosts definidos em `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST` (em `wrangler.toml`).

## 6) Smoke test em preview

### 6.1 Health
```bash
curl https://martech-viral-system-preview.bkpdsf.workers.dev/
```

### 6.2 Login no painel admin (sessao)
```bash
curl -i -c cookies.txt -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/admin/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "password=<ADMIN_PANEL_PASSWORD>"

curl -i -b cookies.txt https://martech-viral-system-preview.bkpdsf.workers.dev/admin
```

### 6.3 Criar usuario
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/user \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"u-001","name":"Ana","phone":"+5511999990001","preferredChannel":"whatsapp","marketingOptIn":true,"consentSource":"pilot_form"}'
```

### 6.4 Criar campanha
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"cmp-001","name":"Campanha teste","baseCopy":"Oferta valida ate hoje","channel":"whatsapp"}'
```

### 6.5 Dispatch dryRun
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/cmp-001/send \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"personalize":true,"includeInactive":true}'
```

### 6.6 Dispatch real (teste controlado em preview)
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/cmp-001/send \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":false,"personalize":false,"includeInactive":true,"webhookUrlOverride":"https://httpbin.org/post"}'
```

### 6.6.1 Validar bloqueio de host nao permitido
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/cmp-001/send \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"personalize":false,"includeInactive":true,"webhookUrlOverride":"https://example.com/hook"}'
```
Esperado: erro `400` informando host nao allowlisted.

### 6.10 Smoke test do gateway Baileys
```bash
curl http://localhost:8788/health

curl -X GET http://localhost:8788/session/status \
  -H "Authorization: Bearer <GATEWAY_ADMIN_TOKEN>"

curl -X POST http://localhost:8788/dispatch/whatsapp \
  -H "Authorization: Bearer <DISPATCH_BEARER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"channel\":\"whatsapp\",\"user\":{\"id\":\"u-001\",\"phone\":\"+5511999990001\"},\"message\":\"Teste gateway\"}"
```

### 6.11 Smoke test Telegram
Checklist:
1. Defina `TELEGRAM_BOT_TOKEN` no Worker (production e/ou preview).
2. No Telegram, abra conversa com o bot e envie `/start` pelo menos uma vez.
3. Configure no painel admin um `Chat ID de Teste` valido (somente numerico ou `@canal`).
4. Nao use token do bot no campo de chat ID (token tem formato `123456:ABC...`).

Opcional para descobrir chat IDs recentes via Bot API:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates"
```

Teste direto de envio:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"<CHAT_ID>","text":"Teste de integracao Martech Telegram"}'
```

Se retornar `chat not found`, confirme se o chat iniciou conversa com o bot e se o chat ID esta correto.

### 6.7 Conferir metricas
```bash
curl https://martech-viral-system-preview.bkpdsf.workers.dev/metrics/overview \
  -H "x-api-key: <ADMIN_API_KEY>"
```

### 6.8 Aplicar opt-out via API admin
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/user/u-001/consent \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"marketingOptIn":false,"source":"support_request"}'
```

### 6.9 Testar link publico de descadastro
```bash
curl -i https://martech-viral-system-preview.bkpdsf.workers.dev/unsubscribe/<referral_code>
```

## 7) Troubleshooting

### WAF login admin (producao)
Configuracao ativa em `fluxoia.com`:
- expressao: `POST /admin/login`
- acao: `block`
- limite: `5 requests / 10s` por `cf.colo.id + ip.src`
- mitigacao: `10s`

Observacao:
- estes limites seguem restricoes do plano Free da Cloudflare para rate limiting.

### Deploy falha por conflito de rota no preview
Sintoma:
- erro `A route with the same pattern already exists`

Acao:
- manter `routes = []` no bloco `[env.preview]`
- usar apenas workers.dev para preview

### Deploy falha por workers.dev/schedules
Sintoma:
- erro `10063` relacionado a workers.dev

Acao:
- garantir subdomain workers configurado na conta
- usar wrangler v4

### Dispatch com `failed > 0`
Checklist:
1. URL webhook correta para canal
2. Secret `DISPATCH_BEARER_TOKEN` configurado
3. Destino do usuario existe (`phone` ou `email`)
4. Provedor externo retornando 2xx

### Gateway Baileys nao conecta
Checklist:
1. Verificar `/session/status` para `connected=true`.
2. Se `connected=false`, obter QR novo ou usar `/session/pairing-code`.
3. Confirmar que pasta `session/` persiste entre reinicios.
4. Se sessao foi invalidada, remover `session/` e reautenticar.

### Dispatch retorna erro de `webhookUrlOverride`
Checklist:
1. Confirmar `https://` no valor de `webhookUrlOverride`.
2. Remover credenciais de URL (`user:pass@`).
3. Verificar se host esta em `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST`.

### Usuario recebeu mensagem apos descadastro
Checklist:
1. Confirmar que `POST /user/:id/consent` retornou `marketingOptIn=false`.
2. Confirmar se o usuario foi selecionado por `userIds` e se apareceu como `skipped` no retorno do dispatch.
3. Verificar se a migration `20260329_add_user_consent_columns.sql` foi aplicada no ambiente.
 - Referencia: `migrations/legacy/20260329_add_user_consent_columns.sql`.

### Login admin retorna erro
Checklist:
1. Verificar se `ADMIN_PANEL_PASSWORD` e `ADMIN_SESSION_SECRET` estao definidos no ambiente correto.
2. Confirmar que a requisicao de login usa `Content-Type: application/x-www-form-urlencoded`.
3. Confirmar acesso por HTTPS (cookie de sessao usa `Secure`).
4. Se receber `429`, aguardar o `Retry-After` (bloqueio por tentativas excessivas).

## 8) Operacao diaria recomendada
1. Rodar campanhas novas primeiro em preview (`dryRun`)
2. Validar payload real com override controlado (preview)
3. Promover para producao
4. Monitorar `/metrics/overview` e tabela `agent_decisions`
