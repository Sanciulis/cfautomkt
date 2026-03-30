# WhatsApp Integration via Baileys

Gateway Node.js para envio de mensagens WhatsApp usando Baileys, integrado ao Worker principal via webhook.

## Por que gateway separado?
- Cloudflare Workers nao suporta sessao WebSocket persistente do WhatsApp Web.
- Baileys precisa de processo Node sempre ativo para manter autenticacao.
- O Worker continua como orquestrador de campanha; o gateway apenas entrega mensagens WhatsApp.

## Fluxo
1. Worker chama `POST /dispatch/whatsapp`.
2. Gateway valida bearer token.
3. Gateway envia mensagem via Baileys para o numero do usuario.
4. Gateway responde `2xx` em sucesso para o Worker registrar `sent`.

## Setup
```bash
cd integrations/whatsapp-baileys-gateway
cp .env.example .env
npm install
npm run dev
```

## Deploy com Docker
```bash
cd integrations/whatsapp-baileys-gateway
cp .env.example .env
# ajuste os tokens e opcoes no .env
docker compose up -d --build
```

Exemplo seguro de exposicao:
- publicar apenas `POST /dispatch/whatsapp` no Nginx
- manter `session/*` acessivel apenas localmente (`127.0.0.1`)
- mapear porta do container apenas em loopback: `127.0.0.1:8788:8788`

## Variaveis de ambiente
- `DISPATCH_BEARER_TOKEN` (obrigatoria): deve ser igual ao secret `DISPATCH_BEARER_TOKEN` do Worker.
- `GATEWAY_ADMIN_TOKEN` (opcional): token para endpoints de sessao (`/session/*`).
- `PORT`, `HOST`
- `BAILEYS_SESSION_DIR`
- `BAILEYS_PRINT_QR`
- `BAILEYS_RECONNECT_DELAY_MS`
- `WHATSAPP_APPEND_REFERRAL`
- `WHATSAPP_APPEND_UNSUBSCRIBE`

## Endpoints
- `GET /health`
- `POST /dispatch/whatsapp` (Bearer `DISPATCH_BEARER_TOKEN`)
- `GET /session/status` (Bearer `GATEWAY_ADMIN_TOKEN`)
- `GET /session/qr` (Bearer `GATEWAY_ADMIN_TOKEN`)
- `POST /session/pairing-code` (Bearer `GATEWAY_ADMIN_TOKEN`)
- `POST /session/reconnect` (Bearer `GATEWAY_ADMIN_TOKEN`)

## Primeira autenticacao
1. Suba o gateway com `BAILEYS_PRINT_QR=true`.
2. Escaneie o QR mostrado no terminal com o WhatsApp.
3. Opcionalmente use pairing code:
```bash
curl -X POST http://localhost:8788/session/pairing-code \
  -H "Authorization: Bearer <GATEWAY_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"5511999990001\"}"
```
4. Credenciais ficam em `BAILEYS_SESSION_DIR` (nao commitar).

## Integracao com Worker
Defina `WHATSAPP_WEBHOOK_URL` no Worker apontando para o gateway:

```toml
WHATSAPP_WEBHOOK_URL = "https://wa-gateway.seu-dominio.com/dispatch/whatsapp"
```

Exemplo alternativo via path no dominio principal:
```toml
WHATSAPP_WEBHOOK_URL = "https://seu-dominio.com/webhooks/dispatch/whatsapp"
```

E configure no Worker:
```bash
npx wrangler secret put DISPATCH_BEARER_TOKEN
npx wrangler secret put DISPATCH_BEARER_TOKEN --env preview
```

No gateway, use o mesmo token em `.env`.

## Teste rapido
```bash
curl -X POST http://localhost:8788/dispatch/whatsapp \
  -H "Authorization: Bearer <DISPATCH_BEARER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{
    \"channel\":\"whatsapp\",
    \"campaign\":{\"id\":\"cmp-001\",\"name\":\"Teste\"},
    \"user\":{\"id\":\"u-001\",\"phone\":\"+5511999990001\"},
    \"message\":\"Oferta valida hoje\",
    \"referralUrl\":\"https://fluxoia.com/ref/abc\",
    \"unsubscribeUrl\":\"https://fluxoia.com/unsubscribe/abc\"
  }"
```

## Observacoes de seguranca
- Nunca exponha `/session/*` sem TLS e sem token forte.
- Nao commite pasta `session/`.
- Rode atras de reverse proxy com HTTPS.
- Aplique allowlist de IP para endpoints administrativos sempre que possivel.
