# Martech Project Instructions

- [x] Verify that the copilot-instructions.md file in the .github directory is created.
- [x] Clarify Project Requirements
-- Cloudflare Workers, Hono, D1, KV, Workers AI.
- [x] Scaffold the Project
-- Manually scaffolded Hono project after create-cloudflare EPERM error.
- [x] Customize the Project
-- Implemented base Viral Marketing API and Autonomous Agent Logic.
- [x] Install Required Extensions
- [x] Compile the Project
-- Dependencies installed via npm.
- [x] Create and Run Task
- [x] Launch the Project
- [x] Ensure Documentation is Complete
-- README.md and .env created.

## System Architecture

- **Backend**: Hono + Cloudflare Workers
- **Database**: D1 (SQLite)
- **AI**: Workers AI (Llama 2)
- **Agent**: Scheduled Cron Agent for reactivation logic.

## Project Overview (Martech Viral Marketing System)

This skill provides a comprehensive overview of the Martech project, including its objectives, architecture, development approach, environments, deployments, integrations, and documentation practices.

### When to Use This Guidance
- Always when working on the Martech project to understand its structure and requirements
- When organizing tasks, planning improvements, or onboarding new team members
- For guidance on environments, deployments, integrations, and documentation

### Project Objective
Martech is a viral marketing platform built on Cloudflare Workers, Hono, D1 (SQLite), KV, and Workers AI. Its goal is to automate campaigns, integrate channels, and enable autonomous agents for user reactivation.

### Key Features
- Backend: Hono + Cloudflare Workers
- Database: D1 (SQLite)
- AI: Workers AI (Llama 2)
- Agent: Cron Worker for autonomous logic
- Integrations: WhatsApp (Baileys), external APIs
- Documentation: docs/ folder (API, Operations, System, Threats)

### Development Approach
- Primary Language: TypeScript
- Modular Structure: src/ for code, docs/ for documentation, tests/ for tests
- Templates for reusable routes and views
- Deployment via Wrangler (Cloudflare)
- Configuration through environment variables (.env)

### Environments and Deployment
- Main Environment: Cloudflare Workers
- Automated Deployment via Wrangler
- Sensitive configuration in .env (tokens, keys)
- D1 database managed by Cloudflare

### Integrations
- WhatsApp via Baileys (integrations/whatsapp-baileys-gateway)
- External APIs can be added in src/integration.ts
- Support for Workers AI tasks

### Documentation
- docs/ contains:
  - API_CONTRACT.md: API contract
  - OPERATIONS_RUNBOOK.md: Operational procedures
  - SYSTEM_MAP.md: System map
  - THREAT_MODEL.md: Threat model
- Always document new routes, integrations, and relevant flows
- Use README.md for overview and quick instructions

### Organization and Efficiency
- Follow the existing folder structure
- Separate integration code in integrations/
- Use templates for reusable views
- Keep .env out of public versioning
- Update documentation whenever relevant changes occur

### Agent Checklist
1. Identify the project's objective and architecture
2. Check environments and sensitive variables
3. Consult docs/ for technical and operational details
4. Document new features and integrations
5. Follow organization and modularity standards

### How to Use This Guidance
- Read and follow the above guidelines when starting tasks in the Martech project
- Use as a reference for onboarding, troubleshooting, and planning
- Consult whenever there are doubts about structure, deployment, or integrations

## Compatibility with Antigravity Skills
For Antigravity agents, refer to the skill located at `.agents/skills/martech-project-info/SKILL.md` for additional workflow guidance and best practices specific to this project.
