---
applyTo: "**/*.{ts,js}"
description: Instruções específicas para desenvolvimento em TypeScript/JavaScript no projeto Martech, incluindo convenções de código, arquitetura e melhores práticas.
---

# Instruções para Desenvolvimento em TypeScript/JavaScript - Projeto Martech

## Visão Geral do Projeto
O Martech é uma plataforma de marketing viral baseada em Cloudflare Workers, Hono, D1 (SQLite), KV e Workers AI. Seu objetivo é automatizar campanhas, integrar canais e permitir agentes autônomos para reativação de usuários.

## Estrutura de Código
- **src/**: Código principal modular
  - `index.ts`: Ponto de entrada, monta rotas
  - `types.ts`: Tipos compartilhados
  - `constants.ts`: Constantes do sistema
  - `utils.ts`: Helpers puros
  - `auth.ts`: Autenticação e sessões
  - `ai.ts`: Integração com Workers AI
  - `db.ts`: Operações D1
  - `consent.ts`: Lógica LGPD
  - `dispatch.ts`: Orquestração de disparos
  - `integration.ts`: Configurações de integração
  - `scheduled.ts`: Agente autônomo
  - `routes/`: Rotas específicas (admin, api, public)

## Convenções de Código
- Use TypeScript estritamente
- Mantenha funções puras quando possível
- Separe lógica de negócio de infraestrutura
- Use templates para views reutilizáveis
- Documente novas funcionalidades em docs/

## Integrações
- Workers AI para personalização
- D1 para persistência
- KV para cache/dedupe
- Webhooks externos para disparos
- WhatsApp via Baileys gateway

## Deploy e Ambiente
- Deploy via Wrangler
- Configurações em .env
- Ambiente Cloudflare Workers

## Compatibilidade com Antigravity
Para agentes Antigravity, consulte o skill em `.agents/skills/martech-project-info/SKILL.md` para orientações adicionais.

## Fluxo de Desenvolvimento e Evolução (obrigatório)

### Uso conjunto de artefatos de governança
- `SKILL.md`: contexto do projeto, objetivo, arquitetura e diretrizes transversais.
- `typescript.instructions.md`: regras de implementação para arquivos `.ts` e `.js`.
- `docs/AI_ROADMAP.md`: cronograma oficial de evolução de IA.
- `docs/AI_SYSTEM.md`: catálogo técnico das funcionalidades de IA.

### Checklist por entrega
1. Planejar:
- Identificar impacto da mudança em módulos, integrações, segurança e operação.
2. Implementar:
- Seguir padrão modular, responsabilidade única por módulo e tipagem explícita.
3. Validar:
- Executar build/test/lint quando aplicável e validar regressão dos fluxos afetados.
- Garantir que os workflows do GitHub Actions aplicáveis ao PR estejam verdes antes do merge.
- Verificar ao menos `Cloudflare CI/CD` (job `validate`) e `security-scan` quando habilitado para o branch.
4. Documentar:
- Atualizar documentos em `docs/` relacionados à mudança.
- Em mudança de IA, atualizar `docs/AI_ROADMAP.md` e `docs/AI_SYSTEM.md`.
5. Registrar evolução:
- Registrar decisão técnica, impacto e próximos passos no documento de roadmap.

### Critérios de qualidade para evolução contínua
- Não entregar feature sem documentação mínima correspondente.
- Não alterar comportamento crítico sem critério de validação definido.
- Não introduzir módulo novo sem explicitar responsabilidade e ponto de integração.