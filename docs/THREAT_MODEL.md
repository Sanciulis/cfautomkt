# Threat Model - Secrets and Cloudflare Security

## 1) Escopo
Sistema analisado:
- Worker API (`src/index.ts`)
- D1 (`users`, `campaigns`, `interactions`, `agent_decisions`)
- KV (`MARTECH_KV`)
- Workers AI
- CI/CD (GitHub Actions + Wrangler)
- Segredos locais (`.env`) e segredos em Cloudflare/GitHub

Objetivo:
- proteger `CLOUDFLARE_API_TOKEN` e outros segredos
- reduzir risco de uso indevido, exfiltracao e impacto operacional

## 2) Ativos criticos
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID` (nao secreto, mas sensivel operacionalmente)
- `DISPATCH_BEARER_TOKEN`
- `ADMIN_API_KEY`
- `ADMIN_PANEL_PASSWORD`
- `ADMIN_SESSION_SECRET`
- dados de usuarios (telefone/email/perfil)
- historico de interacoes e decisoes do agente
- controles de deploy (pipeline CI/CD)

## 3) Fronteiras de confianca
1. Estacao local do desenvolvedor (`.env`, CLI, terminal)
2. GitHub (repo, Actions, Secrets)
3. Cloudflare (Worker, D1, KV, AI, deploy API)
4. Provedor de dispatch externo (webhook)
5. Cliente chamando API publica

## 4) Superficies de ataque
- vazamento de segredo por commit acidental de `.env`
- log de segredo em CI ou terminal
- token Cloudflare com privilegio excessivo
- abuso de endpoint de dispatch sem autenticacao forte
- brute force em `/admin/login`
- furto/reuso de cookie de sessao admin
- webhook externo comprometido ou mal configurado
- replay/abuso de links de referral
- uso malicioso de `webhookUrlOverride` em preview (SSRF/control plane abuse)

## 5) STRIDE por fluxo

## 5.1 Fluxo de deploy (GitHub -> Cloudflare)
- Spoofing: atacante usa token vazado para publicar Worker malicioso
- Tampering: altera workflow para exfiltrar secrets
- Repudiation: falta trilha de auditoria de quem fez deploy
- Information Disclosure: secrets expostos em logs/artefatos
- DoS: deploy de versao quebrada causando indisponibilidade
- Elevation: token com permissao ampla (conta inteira)

Controles:
- token com minimo privilegio (Workers Scripts Write + D1/KV especificos)
- segredos apenas em GitHub Secrets e Cloudflare Secrets
- branch protection + revisao obrigatoria em `main`
- secret scanning no CI
- ambiente preview isolado de producao

## 5.2 Fluxo API de dispatch
- Spoofing: chamada nao autorizada em `/campaign/:id/send`
- Tampering: payload manipulado (ex.: `force=true` indevido)
- Info Disclosure: retorno com detalhes internos de falha
- DoS: disparos massivos sem limite
- Elevation: uso de canal indevido/override inseguro

Controles:
- autenticar endpoints administrativos (API key/JWT/mTLS/gateway)
- rate limit por IP/chave
- limites de lote (`limit <= 500`) ja implementado
- logs de `send_failed` + monitoramento de erro
- `webhookUrlOverride` permitido apenas em `preview` (ja implementado)
- allowlist de host no `webhookUrlOverride` em preview (ja implementado)
- bloqueio de envios para usuarios com opt-out (`marketing_opt_in = 0`)

## 5.2b Fluxo painel admin (senha + sessao)
- Spoofing: tentativa de login com senha vazada
- Tampering: manipulacao de cookie de sessao
- Info Disclosure: vazamento de mensagem de erro com detalhe sensivel
- DoS: brute force no endpoint de login
- Elevation: uso da mesma chave em API e painel

Controles:
- cookie `HttpOnly + Secure + SameSite=Strict` (ja implementado)
- sessao assinada com HMAC e TTL de 12h (ja implementado)
- segredo dedicado para sessao (`ADMIN_SESSION_SECRET`)
- senha dedicada para painel (`ADMIN_PANEL_PASSWORD`)
- rate limit por IP e bloqueio temporario no `/admin/login` (ja implementado)
- WAF/rate-limit na borda Cloudflare para `POST /admin/login` (ja configurado em producao)

## 5.3 Fluxo referral
- Spoofing: cliques falsos para inflar `viral_points`
- Tampering: manipulacao do `ref` no link
- DoS: spam de requests em `/ref/:code`

Controles:
- dedupe em KV por IP hash com TTL (ja implementado)
- normalizacao e lookup estrito de `referral_code`
- monitor de anomalia em `referral_click` por usuario/IP

## 6) Matriz de risco (priorizada)
| Risco | Probabilidade | Impacto | Nivel |
|---|---|---|---|
| Token Cloudflare vazado | Alta | Critico | Critico |
| Dispatch sem auth robusta | Media | Alto | Alto |
| Brute force no login admin | Media | Alto | Alto |
| Workflow CI alterado maliciosamente | Media | Alto | Alto |
| Webhook externo comprometido | Media | Medio/Alto | Alto |
| Abuso de referral | Alta | Medio | Medio/Alto |
| Exposicao de PII em logs | Media | Medio | Medio |

## 7) Medidas obrigatorias (imediatas)
1. Rotacionar `CLOUDFLARE_API_TOKEN` e `DISPATCH_BEARER_TOKEN`.
2. Garantir `.env` fora de versionamento (`.gitignore` ja criado).
3. Usar `.env.example` sem segredos reais (ja criado).
4. Configurar `DISPATCH_BEARER_TOKEN` em Cloudflare Secrets (prod e preview).
5. Habilitar scanning de segredos no CI.
6. Revisar escopo do token Cloudflare para privilegio minimo.
7. Definir `ADMIN_PANEL_PASSWORD` e `ADMIN_SESSION_SECRET` dedicados.
8. Garantir rota de opt-out operacional (`/user/:id/consent` e `/unsubscribe/:code`).

## 8) Medidas recomendadas (curto prazo)
1. Proteger endpoints administrativos com autenticacao explicita.
2. Aplicar regra WAF dedicada para `/admin/login` com threshold por ASN/pais.
3. Criar retries com fila + backoff para dispatch.
4. Adicionar alertas de:
   - pico de `send_failed`
   - pico anormal de `referral_click`
   - tentativa de envio para usuario opt-out
   - deploy fora de janela esperada

## 9) Playbook de incidente (vazamento de token)
1. Revogar token exposto imediatamente.
2. Emitir novo token com escopo minimo.
3. Substituir token em GitHub Secrets/ambiente local.
4. Revisar logs de deploy e alteracoes dos ultimos 7 dias.
5. Forcar novo deploy limpo em preview e producao.
6. Registrar causa raiz e acao corretiva permanente.

## 10) Checklist de compliance operacional
- Segredo em repo? **Nao**
- Segredo em `wrangler.toml`? **Nao** (usar `wrangler secret put`)
- Token com escopo minimo? **Sim (obrigatorio)**
- Preview isolado de producao? **Sim**
- Scan de segredos em PR/push? **Sim** (`security-scan.yml`)
