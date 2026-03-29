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

## 3) Migracoes de banco

### Banco novo
Use `schema.sql`.

### Banco legado (producao antiga)
Use migracao dedicada:
```bash
npx wrangler d1 execute martech_db --remote --file=./migrations/20260329_expand_legacy_schema.sql
```

Depois reaplique schema para garantir indexes e tabelas:
```bash
npx wrangler d1 execute martech_db --remote --file=./schema.sql
```

## 4) Deploy

### Preview
```bash
npx wrangler deploy --env preview --minify
```

### Producao
```bash
npx wrangler deploy --minify
```

## 5) Secrets obrigatorios
```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put ADMIN_API_KEY --env preview
npx wrangler secret put DISPATCH_BEARER_TOKEN
npx wrangler secret put DISPATCH_BEARER_TOKEN --env preview
```

## 6) Smoke test em preview

### 6.1 Health
```bash
curl https://martech-viral-system-preview.bkpdsf.workers.dev/
```

### 6.2 Criar usuario
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/user \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"u-001","name":"Ana","phone":"+5511999990001","preferredChannel":"whatsapp"}'
```

### 6.3 Criar campanha
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"cmp-001","name":"Campanha teste","baseCopy":"Oferta valida ate hoje","channel":"whatsapp"}'
```

### 6.4 Dispatch dryRun
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/cmp-001/send \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"personalize":true,"includeInactive":true}'
```

### 6.5 Dispatch real (teste controlado em preview)
```bash
curl -X POST https://martech-viral-system-preview.bkpdsf.workers.dev/campaign/cmp-001/send \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":false,"personalize":false,"includeInactive":true,"webhookUrlOverride":"https://httpbin.org/post"}'
```

### 6.6 Conferir metricas
```bash
curl https://martech-viral-system-preview.bkpdsf.workers.dev/metrics/overview \
  -H "x-api-key: <ADMIN_API_KEY>"
```

## 7) Troubleshooting

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

## 8) Operacao diaria recomendada
1. Rodar campanhas novas primeiro em preview (`dryRun`)
2. Validar payload real com override controlado (preview)
3. Promover para producao
4. Monitorar `/metrics/overview` e tabela `agent_decisions`
