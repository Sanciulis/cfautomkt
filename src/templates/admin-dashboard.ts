import { DEFAULT_WHATSAPP_TEST_MESSAGE } from '../constants'
import { escapeHtml } from '../utils'

export function renderAdminDashboardPage(data: {
  notice: string | null
  noticeKind: string | null
  totals: {
    users: number
    interactions: number
    sent: number
    conversions: number
    shares: number
    activeCampaigns: number
  }
  metrics: {
    conversionRate: number
    kFactor: number
  }
  whatsappIntegration: {
    webhookUrl: string | null
    testPhone: string | null
    testMessage: string | null
    updatedAt: string | null
    dispatchTokenConfigured: boolean
  }
  campaigns: Array<{ id: string; name: string; channel: string; status: string; updated_at: string }>
  decisions: Array<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>
}): string {
  const noticeHtml =
    data.notice && data.noticeKind
      ? `<p class="notice ${data.noticeKind === 'error' ? 'error' : 'success'}">${escapeHtml(data.notice)}</p>`
      : ''

  const campaignsHtml = data.campaigns
    .map(
      (campaign) =>
        `<tr><td>${escapeHtml(campaign.id)}</td><td>${escapeHtml(campaign.name)}</td><td>${escapeHtml(campaign.channel)}</td><td>${escapeHtml(campaign.status)}</td><td>${escapeHtml(campaign.updated_at ?? '-')}</td></tr>`
    )
    .join('')

  const decisionsHtml = data.decisions
    .map(
      (decision) =>
        `<li><strong>${escapeHtml(decision.decision_type)}</strong> - ${escapeHtml(decision.reason)} <span>(${escapeHtml(decision.created_at)})</span></li>`
    )
    .join('')

  const whatsappWebhookUrl = escapeHtml(data.whatsappIntegration.webhookUrl ?? '')
  const whatsappTestPhone = escapeHtml(data.whatsappIntegration.testPhone ?? '')
  const whatsappTestMessage = escapeHtml(data.whatsappIntegration.testMessage ?? DEFAULT_WHATSAPP_TEST_MESSAGE)
  const whatsappUpdatedAtLabel = data.whatsappIntegration.updatedAt
    ? `Atualizado em ${data.whatsappIntegration.updatedAt}`
    : 'Sem configuracao salva ainda.'
  const dispatchTokenStatus = data.whatsappIntegration.dispatchTokenConfigured
    ? '<span class="status-pill status-ok">DISPATCH_BEARER_TOKEN configurado</span>'
    : '<span class="status-pill status-warn">DISPATCH_BEARER_TOKEN nao configurado</span>'

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Admin</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
    :root {
      --bg: #f4f7f9;
      --panel: #ffffff;
      --ink: #141b22;
      --muted: #64707b;
      --line: #d8e0e8;
      --accent: #0a7f78;
      --accent-dark: #085e59;
      --ok-bg: #e7f7ef;
      --ok-ink: #17663f;
      --err-bg: #fde9e9;
      --err-ink: #9f1c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 0% 0%, #d6f2f0 0%, transparent 32%),
        radial-gradient(circle at 100% 100%, #e8eef8 0%, transparent 34%),
        var(--bg);
      color: var(--ink);
      font-family: 'Space Grotesk', sans-serif;
      padding: 20px;
    }
    .layout {
      max-width: 1180px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .topbar {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .menu {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      position: sticky;
      top: 12px;
      z-index: 4;
      box-shadow: 0 8px 24px rgba(20, 27, 34, 0.08);
    }
    .menu a {
      text-decoration: none;
      color: var(--accent-dark);
      border: 1px solid #c2d4d3;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 0.86rem;
      font-weight: 700;
      background: #eef8f7;
      transition: all 0.2s ease;
    }
    .menu a:hover {
      background: #d8f1ef;
      border-color: #8dc6c1;
    }
    h1 { margin: 0; font-size: 1.5rem; }
    .muted { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .notice {
      padding: 10px 12px;
      border-radius: 10px;
      margin: 0;
      border: 1px solid transparent;
    }
    .notice.success { background: var(--ok-bg); color: var(--ok-ink); border-color: #b5e7cc; }
    .notice.error { background: var(--err-bg); color: var(--err-ink); border-color: #f7c3c3; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    .card small { color: var(--muted); }
    .card strong { font-size: 1.4rem; display: block; margin-top: 6px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 980px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    form, table, .log {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    form h2, .panel-title { margin: 0 0 10px 0; font-size: 1rem; }
    .field {
      display: grid;
      gap: 5px;
      margin-bottom: 10px;
    }
    .field input, .field select, .field textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
    }
    .field textarea {
      min-height: 88px;
      resize: vertical;
    }
    .row {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 760px) { .row { grid-template-columns: 1fr 1fr; } }
    button {
      border: none;
      border-radius: 9px;
      background: var(--accent);
      color: #fff;
      padding: 10px 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary { background: #5f6b76; }
    .helper { color: var(--muted); font-size: 0.85rem; margin: 0 0 10px 0; line-height: 1.35; }
    .status-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .status-ok { background: #e7f7ef; color: #17663f; border: 1px solid #b5e7cc; }
    .status-warn { background: #fff4e5; color: #8b5d14; border: 1px solid #efd7b2; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .actions button { flex: 1; min-width: 190px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eef2f6; font-size: 0.92rem; }
    th { color: var(--muted); font-weight: 600; }
    ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; }
    .logout { display: inline; }
    .anchor-target { scroll-margin-top: 92px; }
  </style>
</head>
<body>
  <main class="layout">
    <section class="topbar">
      <div>
        <h1>Martech Admin</h1>
        <p class="muted">Painel operacional com autenticacao por sessao segura.</p>
      </div>
      <form class="logout" method="post" action="/admin/logout">
        <button class="secondary" type="submit">Sair</button>
      </form>
    </section>
    ${noticeHtml}
    <nav class="menu" aria-label="Menu admin">
      <a href="#visao-geral">Visao geral</a>
      <a href="#usuarios">Usuarios</a>
      <a href="#campanhas">Campanhas</a>
      <a href="#disparo">Disparo</a>
      <a href="#integracao">Config. integracao</a>
      <a href="#integracao-teste">Teste integracao</a>
      <a href="#agente">Agente</a>
      <a href="#lista-campanhas">Lista de campanhas</a>
    </nav>
    <section id="visao-geral" class="cards anchor-target">
      <article class="card"><small>Usuarios</small><strong>${data.totals.users}</strong></article>
      <article class="card"><small>Interacoes</small><strong>${data.totals.interactions}</strong></article>
      <article class="card"><small>Envios</small><strong>${data.totals.sent}</strong></article>
      <article class="card"><small>Conversoes</small><strong>${data.totals.conversions}</strong></article>
      <article class="card"><small>K-factor</small><strong>${data.metrics.kFactor.toFixed(2)}</strong></article>
      <article class="card"><small>Campanhas ativas</small><strong>${data.totals.activeCampaigns}</strong></article>
    </section>
    <section class="grid">
      <form id="usuarios" class="anchor-target" method="post" action="/admin/actions/user/create">
        <h2>Criar Usuario</h2>
        <div class="row">
          <label class="field"><span>ID (opcional)</span><input name="id" /></label>
          <label class="field"><span>Nome</span><input name="name" required /></label>
        </div>
        <div class="row">
          <label class="field"><span>Email</span><input name="email" type="email" /></label>
          <label class="field"><span>Telefone</span><input name="phone" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Canal preferido</span>
            <select name="preferredChannel">
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="telegram">telegram</option>
              <option value="sms">sms</option>
            </select>
          </label>
          <label class="field"><span>Perfil psicologico</span><input name="psychologicalProfile" value="generic" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Consentimento marketing</span>
            <select name="marketingOptIn">
              <option value="true">opt_in</option>
              <option value="false">opt_out</option>
            </select>
          </label>
          <label class="field"><span>Fonte do consentimento</span><input name="consentSource" value="admin_panel" /></label>
        </div>
        <button type="submit">Criar usuario</button>
      </form>
      <form method="post" action="/admin/actions/user/optout">
        <h2>Opt-out Usuario</h2>
        <div class="row">
          <label class="field"><span>User ID</span><input name="userId" required /></label>
          <label class="field"><span>Fonte</span><input name="source" value="admin_panel_optout" /></label>
        </div>
        <button class="secondary" type="submit">Aplicar opt-out</button>
      </form>
      <form id="campanhas" class="anchor-target" method="post" action="/admin/actions/campaign/create">
        <h2>Criar Campanha</h2>
        <div class="row">
          <label class="field"><span>ID (opcional)</span><input name="id" /></label>
          <label class="field"><span>Nome</span><input name="name" required /></label>
        </div>
        <label class="field"><span>Base copy</span><input name="baseCopy" required /></label>
        <div class="row">
          <label class="field"><span>Incentivo</span><input name="incentiveOffer" /></label>
          <label class="field"><span>Canal</span>
            <select name="channel">
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="telegram">telegram</option>
            </select>
          </label>
        </div>
        <button type="submit">Criar campanha</button>
      </form>
      <form id="disparo" class="anchor-target" method="post" action="/admin/actions/campaign/dispatch">
        <h2>Disparar Campanha</h2>
        <div class="row">
          <label class="field"><span>Campaign ID</span><input name="campaignId" required /></label>
          <label class="field"><span>Limite</span><input name="limit" type="number" value="100" min="1" max="500" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Canal (opcional)</span><input name="channel" placeholder="whatsapp/email/telegram" /></label>
          <label class="field"><span>Webhook override (preview)</span><input name="webhookUrlOverride" placeholder="https://..." /></label>
        </div>
        <div class="row">
          <label class="field"><span>Personalizar</span>
            <select name="personalize"><option value="true">true</option><option value="false">false</option></select>
          </label>
          <label class="field"><span>Dry run</span>
            <select name="dryRun"><option value="true">true</option><option value="false">false</option></select>
          </label>
        </div>
        <div class="row">
          <label class="field"><span>Incluir inativos</span>
            <select name="includeInactive"><option value="false">false</option><option value="true">true</option></select>
          </label>
          <label class="field"><span>Force (campanha pausada)</span>
            <select name="force"><option value="false">false</option><option value="true">true</option></select>
          </label>
        </div>
        <button type="submit">Executar dispatch</button>
      </form>
      <form id="integracao" class="anchor-target" method="post" action="/admin/actions/integration/save">
        <h2>Configuracao WhatsApp</h2>
        ${dispatchTokenStatus}
        <p class="helper">Defina a URL do webhook de entrega WhatsApp (ex.: gateway Baileys). Esta URL sera usada pelo botao de teste e tambem para os dispatches da campanha quando informado override no admin.</p>
        <label class="field"><span>Webhook URL da integracao</span><input name="webhookUrl" value="${whatsappWebhookUrl}" placeholder="https://wa-gateway.seu-dominio.com/dispatch/whatsapp" required /></label>
        <div class="row">
          <label class="field"><span>Telefone padrao de teste (opcional)</span><input name="testPhone" value="${whatsappTestPhone}" placeholder="+5511999990001" /></label>
          <label class="field"><span>Ultima atualizacao</span><input value="${escapeHtml(whatsappUpdatedAtLabel)}" readonly /></label>
        </div>
        <label class="field"><span>Mensagem padrao de teste</span><textarea name="testMessage">${whatsappTestMessage}</textarea></label>
        <button type="submit">Salvar configuracao</button>
      </form>
      <form id="integracao-teste" class="anchor-target" method="post" action="/admin/actions/integration/test">
        <h2>Teste da Integracao WhatsApp</h2>
        <p class="helper">Este teste envia um payload real para o webhook com Authorization Bearer usando o secret <code>DISPATCH_BEARER_TOKEN</code>.</p>
        <div class="row">
          <label class="field"><span>Webhook configurado (somente leitura)</span><input value="${whatsappWebhookUrl || 'Nao configurado'}" readonly /></label>
          <label class="field"><span>Webhook override para este teste (opcional)</span><input name="webhookUrl" placeholder="https://wa-gateway.seu-dominio.com/dispatch/whatsapp" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Telefone de teste</span><input name="testPhone" value="${whatsappTestPhone}" placeholder="+5511999990001" /></label>
          <label class="field"><span>Canal</span><input value="whatsapp" readonly /></label>
        </div>
        <label class="field"><span>Mensagem de teste</span><textarea name="testMessage">${whatsappTestMessage}</textarea></label>
        <button class="secondary" type="submit">Executar teste da integracao</button>
      </form>
      <section id="agente" class="log anchor-target">
        <h2 class="panel-title">Decisoes recentes do agente</h2>
        <ul>${decisionsHtml || '<li>Sem decisoes registradas.</li>'}</ul>
      </section>
    </section>
    <section id="lista-campanhas" class="anchor-target">
      <h2 class="panel-title">Campanhas</h2>
      <table>
        <thead><tr><th>ID</th><th>Nome</th><th>Canal</th><th>Status</th><th>Atualizado em</th></tr></thead>
        <tbody>${campaignsHtml || '<tr><td colspan="5">Sem campanhas.</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`
}
