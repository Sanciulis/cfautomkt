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
