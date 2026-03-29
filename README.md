# AI Viral Marketing System (Martech)

Motor de marketing autonomo na Cloudflare Edge com foco em:
- disparo multicanal
- hiperpersonalizacao com IA
- tracking viral por referral
- otimizacao automatica por agente agendado

## Documentacao do sistema
- Mapa completo de arquitetura e fluxos: `docs/SYSTEM_MAP.md`
- Contrato de API e payloads: `docs/API_CONTRACT.md`
- Runbook operacional (deploy, smoke tests e troubleshooting): `docs/OPERATIONS_RUNBOOK.md`
- Modelagem de ameacas e seguranca de segredos: `docs/THREAT_MODEL.md`
- Integracao WhatsApp via Baileys (gateway Node): `integrations/whatsapp-baileys-gateway/README.md`

## Stack
- Cloudflare Workers + Hono
- Cloudflare D1 (SQLite)
- Cloudflare KV
- Cloudflare Workers AI
- Gateway Node.js (Baileys) para envio WhatsApp
- GitHub Actions (CI/CD)

## Arquitetura (MVP executavel)
1. API recebe eventos e atualiza score do usuario.
2. Worker gera copy personalizada com Workers AI.
3. Links `/ref/:code` rastreiam clique, incrementam viral_points e redirecionam para landing com `?ref=`.
4. Agente `scheduled` roda a cada 6h para:
   - migrar usuarios frios para SMS
   - pausar campanhas com baixa conversao
   - registrar decisoes em `agent_decisions`
5. Endpoint de metricas agrega conversao e K-factor.
6. Para canal WhatsApp, o Worker entrega em webhook externo (ex.: gateway Baileys).

## Modelagem de dados (D1)
Arquivos: `schema.sql`

Tabelas:
- `users`
- `campaigns`
- `interactions`
- `agent_decisions`

## Endpoints principais
- `GET /` status do sistema
- `GET /admin/login` tela de autenticacao do painel admin
- `POST /admin/login` cria sessao admin (cookie HttpOnly)
- `POST /admin/logout` encerra sessao admin
- `GET /admin` dashboard operacional (protegido por sessao)
- `POST /user` cria usuario
- `GET /user/:id` retorna perfil
- `POST /user/:id/consent` atualiza consentimento (`marketingOptIn`) para opt-in/opt-out
- `POST /campaign` cria campanha
- `POST /interaction` registra evento (`sent`, `opened`, `clicked`, `shared`, `converted`, `referral_click`, `personalized`, `send_failed`)
- `POST /personalize/:id` gera copy personalizada com IA
- `POST /campaign/:id/send` dispara campanha para lote de usuarios via webhook (whatsapp/email/telegram)
- `GET /ref/:code` tracking viral + redirect para landing
- `GET /unsubscribe/:code` descadastro publico (opt-out LGPD)
- `GET /metrics/overview` metricas consolidadas do funil

## Setup local
1. Instalar dependencias:
```bash
npm install
```

2. Aplicar schema no D1 local:
```bash
npx wrangler d1 execute martech_db --local --file=./schema.sql
```

3. Rodar em desenvolvimento:
```bash
npm run dev
```

4. Validar TypeScript:
```bash
npm run typecheck
```

5. Rodar testes de integracao:
```bash
npm test
```

## Integracao WhatsApp com Baileys
1. Subir gateway local:
```bash
cd integrations/whatsapp-baileys-gateway
cp .env.example .env
npm install
npm run dev
```
2. Autenticar sessao WhatsApp (QR no terminal ou endpoint `/session/pairing-code`).
3. Apontar `WHATSAPP_WEBHOOK_URL` para `https://<gateway>/dispatch/whatsapp`.
4. Garantir que o token do gateway (`DISPATCH_BEARER_TOKEN` no `.env`) seja igual ao secret do Worker.

## Deploy
### Producao
```bash
npm run deploy
```

### Preview
```bash
npx wrangler deploy --env preview --minify
```

## Migracao de banco legado (producao)
Se o banco de producao foi criado com o schema antigo, aplique:
```bash
npx wrangler d1 execute martech_db --remote --file=./migrations/20260329_expand_legacy_schema.sql
```

Para habilitar campos de consentimento LGPD em bancos ja existentes:
```bash
npx wrangler d1 execute martech_db --remote --file=./migrations/20260329_add_user_consent_columns.sql
npx wrangler d1 execute martech_db_preview --remote --env preview --file=./migrations/20260329_add_user_consent_columns.sql
```

## CI/CD (GitHub Actions)
Arquivo: `.github/workflows/deploy.yml`

Fluxo:
- Pull Request em `main`: valida + deploy `preview`
- Push em `main`: valida + deploy `production`

Secrets necessarios no GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Seguranca de segredos (obrigatorio)
1. Nao commitar `.env` (protegido por `.gitignore`).
2. Use apenas `.env.example` no repositorio.
3. Rotacione imediatamente token Cloudflare e tokens/senhas administrativas se houve exposicao.
4. Armazene segredos no GitHub Secrets e Cloudflare Secrets.
5. Pipeline de scan de segredos: `.github/workflows/security-scan.yml`.
6. Proteja APIs com `ADMIN_API_KEY`.
7. Configure o painel admin com `ADMIN_PANEL_PASSWORD` e `ADMIN_SESSION_SECRET`.
8. Login do painel admin possui bloqueio temporario por tentativas excessivas.

## Configuracao Wrangler
Arquivo: `wrangler.toml`

Inclui:
- `APP_ENV` e `LANDING_PAGE_URL`
- URLs de dispatcher por canal (`DISPATCH_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_URL`)
- `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST` para restringir host de `webhookUrlOverride` em preview
- `triggers.crons` para agente autonomo
- ambiente `env.preview` com D1/KV separados de producao

## Secrets de operacao (Cloudflare)
Configure os segredos abaixo em producao e preview:
```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put ADMIN_API_KEY --env preview
npx wrangler secret put ADMIN_PANEL_PASSWORD
npx wrangler secret put ADMIN_PANEL_PASSWORD --env preview
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET --env preview
npx wrangler secret put DISPATCH_BEARER_TOKEN
npx wrangler secret put DISPATCH_BEARER_TOKEN --env preview
```

Observacao: se `ADMIN_PANEL_PASSWORD` ou `ADMIN_SESSION_SECRET` nao forem definidos, o Worker usa `ADMIN_API_KEY` como fallback por compatibilidade.

## Teste rapido de dispatch (preview)
1. Criar usuarios e campanha.
2. Testar selecao e personalizacao sem envio externo:
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/<campaign_id>/send \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"personalize":true,"includeInactive":true,"limit":50}'
```
3. Em `preview`, pode validar envio real sem trocar `wrangler.toml` usando override temporario:
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/<campaign_id>/send \
  -H "Content-Type: application/json" \
  -d '{"dryRun":false,"personalize":false,"includeInactive":true,"webhookUrlOverride":"https://httpbin.org/post"}'
```

Observacao:
- `webhookUrlOverride` em preview aceita apenas hosts presentes em `PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST`.

## Proximo ciclo recomendado
1. Adicionar testes de integracao para `/interaction`, `/ref/:code`, `/unsubscribe/:code` e `/user/:id/consent`.
2. Conectar provedores reais (Meta/Twilio/Resend) aos webhooks de dispatcher.
3. Criar retries com backoff e fila para falhas de envio.
