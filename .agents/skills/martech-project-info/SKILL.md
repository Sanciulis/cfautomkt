---
name: martech-project-info
description: Fornece ao agente um panorama completo do projeto Martech, incluindo objetivo, arquitetura, ambientes, deploy, integrações e práticas de documentação. Use para informar, organizar e orientar tarefas relacionadas ao projeto.
---

# Skill: Informações do Projeto Martech

Este skill orienta o agente a reconhecer e informar as principais características do projeto Martech, seu objetivo, arquitetura, ambientes, deploy, integrações e práticas de documentação.

## Quando usar este skill
- Sempre que o agente precisar entender, documentar ou explicar o projeto Martech
- Ao organizar tarefas, planejar melhorias ou integrar novos membros
- Para orientar sobre ambientes, deploy, integrações e documentação

## Objetivo do Projeto
O Martech é uma plataforma de marketing viral baseada em Cloudflare Workers, Hono, D1 (SQLite), KV e Workers AI. Seu objetivo é automatizar campanhas, integrar canais e permitir agentes autônomos para reativação de usuários.

## Características Principais
- Backend: Hono + Cloudflare Workers
- Banco de dados: D1 (SQLite)
- AI: Workers AI (Llama 2)
- Agente: Cron Worker para lógica autônoma
- Integrações: WhatsApp (Baileys), APIs externas
- Documentação: docs/ (API, Operações, Sistema, Ameaças)

## Como está sendo desenvolvido
- Linguagem principal: TypeScript
- Estrutura modular: src/ para código, docs/ para documentação, tests/ para testes
- Uso de templates para rotas e views
- Deploy via Wrangler (Cloudflare)
- Configuração por variáveis de ambiente (.env)

## Ambientes e Deploy
- Ambiente principal: Cloudflare Workers
- Deploy automatizado via Wrangler
- Configuração sensível em .env (tokens, chaves)
- Banco D1 gerenciado pelo Cloudflare

## Integrações
- WhatsApp via Baileys (integrations/whatsapp-baileys-gateway)
- APIs externas podem ser adicionadas em src/integration.ts
- Suporte a Workers AI para tarefas de IA

## Documentação
- docs/ contém:
  - API_CONTRACT.md: Contrato da API
  - OPERATIONS_RUNBOOK.md: Procedimentos operacionais
  - SYSTEM_MAP.md: Mapa do sistema
  - THREAT_MODEL.md: Modelo de ameaças
- Sempre documentar novas rotas, integrações e fluxos relevantes
- Use README.md para visão geral e instruções rápidas

## Organização e Eficiência
- Siga a estrutura de pastas existente
- Separe código de integração em integrations/
- Use templates para views reutilizáveis
- Mantenha o .env fora do versionamento público
- Atualize a documentação sempre que houver mudanças relevantes

## Checklist para o agente
1. Identifique o objetivo e arquitetura do projeto
2. Verifique ambientes e variáveis sensíveis
3. Consulte docs/ para detalhes técnicos e operacionais
4. Documente novas funcionalidades e integrações
5. Siga padrões de organização e modularidade

## Como usar este skill
- Leia e siga as orientações acima ao iniciar tarefas no projeto Martech
- Use como referência para onboarding, troubleshooting e planejamento
- Consulte sempre que houver dúvidas sobre estrutura, deploy ou integrações

## Vinculação com o fluxo de desenvolvimento e evolução
- Este skill deve ser aplicado em todo ciclo de desenvolvimento que envolva novas features, refatorações relevantes, integrações, mudanças de IA ou mudanças de operação.
- Para implementação técnica em TypeScript/JavaScript, aplicar em conjunto com `.github/instructions/typescript.instructions.md`.
- Para evolução de IA, usar `docs/AI_ROADMAP.md` como cronograma oficial e `docs/AI_SYSTEM.md` como referência técnica de capacidades.

### Gate obrigatório por entrega
1. Planejamento:
- Confirmar objetivo da entrega e impacto em arquitetura, integrações, segurança e documentação.
2. Implementação:
- Seguir convenções de código e modularidade definidas nas instructions.
3. Validação:
- Executar checagens técnicas (build/test/lint aplicáveis) e validar impacto operacional.
- Confirmar status dos workflows do GitHub Actions para o PR/branch (CI/CD e segurança).
- Não avançar para merge com checks obrigatórios falhando.
4. Documentação:
- Atualizar documentação técnica relevante em `docs/`.
- Se houver impacto em IA, atualizar `docs/AI_ROADMAP.md` usando o modelo de atualização.
5. Governança:
- Garantir consistência entre `SKILL.md`, `.github/instructions/*.instructions.md` e documentação operacional.

### Fluxo obrigatório de deploy para todos os agentes
- Todo agente que alterar código deve seguir o fluxo oficial de deploy e validação de ambiente.
- Fluxo preferencial (CI/CD):
 - Pull Request em `main`: executar `Cloudflare CI/CD` (`validate` + `deploy-preview`).
 - Push/Merge em `main`: executar `Cloudflare CI/CD` (`validate` + `deploy-production`).
- Deploy manual somente com alvo explícito:
 - Preview: `npx wrangler deploy --env preview --minify`
 - Produção: `npm run deploy`
- Não executar deploy manual em produção quando o usuário não pedir produção explicitamente.
- Após cada deploy, executar smoke test e validar ambiente retornado:
 - Preview: `curl https://martech-viral-system-preview.bkpdsf.workers.dev/` deve retornar `"env":"preview"`.
 - Produção: `curl https://fluxoia.com/` deve retornar `"env":"production"`.
- Em falha de smoke test, interromper rollout e reportar imediatamente.

### Definição de pronto para evolução contínua
- Código entregue e validado.
- Workflows obrigatórios do GitHub Actions aprovados.
- Documentação atualizada.
- Cronograma de IA atualizado quando aplicável.
- Riscos e próximos passos registrados.
