import { DEFAULT_WHATSAPP_TEST_MESSAGE, DEFAULT_EMAIL_TEST_MESSAGE, DEFAULT_TELEGRAM_TEST_MESSAGE, DEFAULT_AI_MODEL } from '../constants'
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
    gatewayToken: string | null
  }
  emailIntegration: {
    webhookUrl: string | null
    testEmail: string | null
    testSubject: string | null
    testMessage: string | null
    updatedAt: string | null
  }
  telegramIntegration: {
    webhookUrl: string | null
    testChatId: string | null
    testMessage: string | null
    updatedAt: string | null
  }
  users: Array<{ id: string; name: string | null; email: string | null; phone: string | null; preferred_channel: string; created_at: string }>
  campaigns: Array<{ id: string; name: string; channel: string; status: string; updated_at: string }>
  decisions: Array<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>
}): string {
  const noticeHtml =
    data.notice && data.noticeKind
      ? `<div class="toast ${data.noticeKind === 'error' ? 'toast-error' : 'toast-success'}">
          <div class="toast-content">${escapeHtml(data.notice)}</div>
          <button onclick="this.parentElement.remove()" class="toast-close">&times;</button>
         </div>`
      : ''

  const campaignsHtml = data.campaigns
    .map(
      (campaign) =>
        `<tr>
          <td><code class="compact-code">${escapeHtml(campaign.id.slice(0, 8))}…</code></td>
          <td><span class="font-bold">${escapeHtml(campaign.name)}</span></td>
          <td><span class="badge badge-outline">${escapeHtml(campaign.channel)}</span></td>
          <td><span class="badge ${campaign.status === 'active' ? 'badge-success' : 'badge-warn'}">${escapeHtml(campaign.status)}</span></td>
          <td><span class="text-xs opacity-60">${escapeHtml(campaign.updated_at ? new Date(campaign.updated_at).toLocaleString('pt-BR') : '-')}</span></td>
        </tr>`
    )
    .join('')

  const usersHtml = data.users
    .map(
      (user) =>
        `<tr>
          <td><code class="compact-code">${escapeHtml(user.id.slice(0, 8))}…</code></td>
          <td><span class="font-bold">${escapeHtml(user.name || '-')}</span></td>
          <td><span class="text-xs opacity-60">${escapeHtml(user.email || user.phone || '-')}</span></td>
          <td><span class="badge badge-outline">${escapeHtml(user.preferred_channel)}</span></td>
          <td><span class="text-xs opacity-60">${escapeHtml(user.created_at ? new Date(user.created_at).toLocaleString('pt-BR') : '-')}</span></td>
        </tr>`
    )
    .join('')

  const decisionsHtml = data.decisions
    .map(
      (decision) =>
        `<div class="timeline-item">
          <div class="timeline-marker"></div>
          <div class="timeline-content">
            <div class="flex justify-between items-center mb-1">
              <span class="badge badge-glass font-bold text-xs uppercase tracking-tighter">${escapeHtml(decision.decision_type)}</span>
              <span class="text-[10px] opacity-40">${escapeHtml(decision.created_at)}</span>
            </div>
            <p class="text-sm opacity-80 leading-relaxed">${escapeHtml(decision.reason)}</p>
            ${decision.target_id ? `<div class="mt-2 text-[10px] opacity-30 font-mono">TARGET: ${escapeHtml(decision.target_id)}</div>` : ''}
          </div>
        </div>`
    )
    .join('')

  const whatsappWebhookUrl = escapeHtml(data.whatsappIntegration.webhookUrl ?? '')
  const whatsappTestPhone = escapeHtml(data.whatsappIntegration.testPhone ?? '')
  const whatsappTestMessage = escapeHtml(data.whatsappIntegration.testMessage ?? DEFAULT_WHATSAPP_TEST_MESSAGE)
  const whatsappUpdatedAtLabel = data.whatsappIntegration.updatedAt
    ? `Configurado em ${new Date(data.whatsappIntegration.updatedAt).toLocaleDateString()}`
    : 'Aguardando configuração'
  
  const dispatchTokenStatus = data.whatsappIntegration.dispatchTokenConfigured
    ? '<span class="status-indicator status-ready">API Gateway Ativa</span>'
    : '<span class="status-indicator status-pending">API Gateway Offline</span>'

  const emailWebhookUrl = escapeHtml(data.emailIntegration.webhookUrl ?? '')
  const emailTestEmail = escapeHtml(data.emailIntegration.testEmail ?? '')
  const emailTestSubject = escapeHtml(data.emailIntegration.testSubject ?? '')
  const emailTestMessage = escapeHtml(data.emailIntegration.testMessage ?? DEFAULT_EMAIL_TEST_MESSAGE)
  const emailUpdatedAtLabel = data.emailIntegration.updatedAt
    ? `Atualizado: ${new Date(data.emailIntegration.updatedAt).toLocaleString('pt-BR')}`
    : 'Aguardando configuração'

  const telegramWebhookUrl = escapeHtml(data.telegramIntegration.webhookUrl ?? '')
  const telegramTestChatId = escapeHtml(data.telegramIntegration.testChatId ?? '')
  const telegramTestMessage = escapeHtml(data.telegramIntegration.testMessage ?? DEFAULT_TELEGRAM_TEST_MESSAGE)
  const telegramUpdatedAtLabel = data.telegramIntegration.updatedAt
    ? `Atualizado: ${new Date(data.telegramIntegration.updatedAt).toLocaleString('pt-BR')}`
    : 'Aguardando configuração'

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Cloud | Admin Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Palette: Emerald & Slate Premium */
      --primary: #10b981;
      --primary-glow: rgba(16, 185, 129, 0.2);
      --secondary: #6366f1;
      --bg-dark: #0f172a;
      --bg-slate: #1e293b;
      --bg-slate-light: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border: rgba(255, 255, 255, 0.08);
      --glass: rgba(30, 41, 59, 0.7);
      --glass-bright: rgba(255, 255, 255, 0.03);
      --sidebar-width: 260px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(at 0% 0%, rgba(16, 185, 129, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(99, 102, 241, 0.1) 0px, transparent 50%);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar Layout */
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      border-right: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(20px);
      position: fixed;
      left: 0;
      top: 0;
      display: flex;
      flex-direction: column;
      z-index: 50;
      padding: 0;
    }

    .brand {
      padding: 32px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      border-radius: 8px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 1.2rem;
      color: white;
      box-shadow: 0 4px 12px var(--primary-glow);
    }
    .brand-name { font-weight: 700; letter-spacing: -0.02em; font-size: 1.25rem; }

    .nav-group { padding: 0 12px; flex: 1; }
    .nav-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--text-muted);
      margin: 24px 12px 12px;
      font-weight: 700;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: 12px;
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.95rem;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
      cursor: pointer;
      margin-bottom: 4px;
    }
    .nav-item:hover {
      background: var(--glass-bright);
      color: var(--text-main);
    }
    .nav-item.active {
      background: var(--primary-glow);
      color: var(--primary);
      border-color: rgba(16, 185, 129, 0.1);
    }
    .nav-item svg { width: 18px; height: 18px; opacity: 0.7; }
    .nav-item.active svg { opacity: 1; }

    .sidebar-footer {
      padding: 24px;
      border-top: 1px solid var(--border);
    }
    .logout-btn {
      width: 100%;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 10px;
      border-radius: 10px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .logout-btn:hover { background: #ef444415; color: #ef4444; border-color: #ef444440; }

    /* Main Content */
    .main-canvas {
      margin-left: var(--sidebar-width);
      width: calc(100% - var(--sidebar-width));
      padding: 32px 48px;
    }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 40px;
    }
    .page-title { margin: 0; font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; }
    .page-subtitle { color: var(--text-muted); margin-top: 4px; font-weight: 400; }

    /* Views */
    .view-content { display: none; animation: fadeIn 0.4s ease-out; }
    .view-content.active { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Cards & Grids */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: var(--glass);
      border: 1px solid var(--border);
      padding: 24px;
      border-radius: 20px;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    .stat-label { font-size: 0.85rem; color: var(--text-muted); font-weight: 500; }
    .stat-value { font-size: 2rem; font-weight: 700; margin-top: 8px; display: block; }
    .stat-accent {
      position: absolute;
      right: -10px;
      bottom: -10px;
      width: 60px;
      height: 60px;
      background: var(--primary);
      opacity: 0.05;
      border-radius: 50%;
    }

    .panel-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 28px;
    }
    @media (min-width: 1200px) { .panel-grid { grid-template-columns: 1.5fr 1fr; } }
    
    .panel {
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px;
      backdrop-filter: blur(10px);
    }
    .panel-header { margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .panel-title { margin: 0; font-size: 1.1rem; font-weight: 700; color: white; display: flex; align-items: center; gap: 10px; }

    /* Tables */
    .table-container { overflow-x: auto; margin: 0 -32px; padding: 0 32px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 12px 16px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
    td { padding: 16px; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
    tr:last-child td { border-bottom: none; }

    /* Forms */
    .form-group { margin-bottom: 24px; }
    .input-label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 8px; color: var(--text-muted); }
    .input-control {
      width: 100%;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
      color: white;
      font-family: inherit;
      font-size: 1rem;
      transition: all 0.2s;
    }
    .input-control:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px var(--primary-glow); }
    .input-control[readonly] { opacity: 0.6; cursor: default; }
    textarea.input-control { min-height: 100px; resize: vertical; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 12px;
      font-family: inherit;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      width: 100%;
    }
    .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3); }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4); }
    .btn-glass { background: var(--glass-bright); color: white; border: 1px solid var(--border); }
    .btn-glass:hover { background: rgba(255, 255, 255, 0.08); }

    /* Badges & Indicators */
    .badge { padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
    .badge-outline { border: 1px solid var(--border); color: var(--text-muted); }
    .badge-success { background: rgba(16, 185, 129, 0.1); color: var(--primary); }
    .badge-warn { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
    .badge-glass { background: rgba(255, 255, 255, 0.08); color: white; }

    .status-indicator { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 600; margin-bottom: 20px; }
    .status-indicator::before { content: ''; width: 8px; height: 8px; border-radius: 50%; display: block; }
    .status-ready { color: var(--primary); }
    .status-ready::before { background: var(--primary); box-shadow: 0 0 10px var(--primary); }
    .status-pending { color: #f59e0b; }
    .status-pending::before { background: #f59e0b; box-shadow: 0 0 10px #f59e0b; }

    /* Timeline */
    .timeline { padding-left: 10px; border-left: 1px solid var(--border); margin-left: 10px; }
    .timeline-item { position: relative; padding-bottom: 24px; padding-left: 32px; }
    .timeline-item:last-child { padding-bottom: 0; }
    .timeline-marker { position: absolute; left: -16px; top: 4px; width: 11px; height: 11px; border-radius: 50%; background: var(--primary); border: 2px solid var(--bg-dark); }
    .timeline-content { background: var(--glass-bright); padding: 16px; border-radius: 16px; border: 1px solid var(--border); }

    /* Toasts */
    .toast {
      position: fixed;
      top: 32px;
      right: 32px;
      z-index: 1000;
      padding: 16px 24px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      backdrop-filter: blur(20px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .toast-success { background: rgba(16, 185, 129, 0.9); color: white; }
    .toast-error { background: rgba(239, 68, 68, 0.9); color: white; }
    .toast-close { border: none; background: transparent; color: white; font-size: 1.5rem; cursor: pointer; opacity: 0.6; }

    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    .compact-code { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; color: var(--primary); }

    /* Utility */
    .font-bold { font-weight: 700; }
    .text-xs { font-size: 0.75rem; }
    .opacity-60 { opacity: 0.6; }
    .opacity-40 { opacity: 0.4; }
    .opacity-30 { opacity: 0.3; }
    .flex { display: flex; }
    .justify-between { justify-content: space-between; }
    .items-center { align-items: center; }
    .mb-1 { margin-bottom: 4px; }
    .mt-2 { margin-top: 8px; }
    .uppercase { text-transform: uppercase; }
    .tracking-tighter { letter-spacing: -0.05em; }

    @media (max-width: 900px) {
      .sidebar { width: 80px; }
      .brand-name, .nav-label, .nav-item span { display: none; }
      .brand { padding: 20px; justify-content: center; }
      .nav-item { justify-content: center; padding: 16px; }
      .main-canvas { margin-left: 80px; width: calc(100% - 80px); padding: 24px; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  ${noticeHtml}
  
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-logo">M</div>
      <span class="brand-name">Martech<span style="color:var(--primary)">Cloud</span></span>
    </div>

    <nav class="nav-group">
      <div class="nav-label">Monitoramento</div>
      <a class="nav-item active" data-view="dashboard">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"></path></svg>
        <span>Insights</span>
      </a>
      
      <div class="nav-label">Comunicação</div>
      <a class="nav-item" data-view="campaigns">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"></path></svg>
        <span>Campanhas</span>
      </a>
      <a class="nav-item" data-view="dispatch">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path></svg>
        <span>Laboratório Envios</span>
      </a>

      <div class="nav-label">Crescimento & Audiência</div>
      <a class="nav-item" data-view="wa-groups">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path></svg>
        <span>Grupos e Extração</span>
      </a>
      <a class="nav-item" data-view="users">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a7 7 0 017 7v1H1v-1a7 7 0 017-7z"></path></svg>
        <span>Base de Leads</span>
      </a>
      <a class="nav-item" data-view="integrations">
        <svg fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
        <span>Integrações</span>
      </a>

      <div class="nav-label">Configuração</div>
      <a class="nav-item" data-view="ai-agent">
        <svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
        <span>Agente Autônomo</span>
      </a>
    </nav>

    <div class="sidebar-footer">
      <form method="post" action="/admin/logout">
        <button class="logout-btn" type="submit">Encerrar Sessão</button>
      </form>
    </div>
  </aside>

  <main class="main-canvas">
    <!-- Header -->
    <header class="header-bar">
      <div>
        <h2 id="view-title" class="page-title">Dashboard Operacional</h2>
        <p id="view-subtitle" class="page-subtitle">Visão 360º de interações e métricas virais.</p>
      </div>
      <div class="flex items-center gap-4">
        <span class="badge badge-glass font-mono text-[10px] uppercase tracking-widest">v2.1.0 AI-Ready</span>
      </div>
    </header>

    <!-- VIEW: Dashboard -->
    <div id="view-dashboard" class="view-content active">
      <section class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Leads Totais</span>
          <span class="stat-value">${data.totals.users}</span>
          <div class="stat-accent"></div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Interações</span>
          <span class="stat-value">${data.totals.interactions}</span>
          <div class="stat-accent" style="background:var(--secondary)"></div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Conversão Média</span>
          <span class="stat-value">${(data.metrics.conversionRate * 100).toFixed(1)}%</span>
          <div class="stat-accent"></div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Viral Factor (K)</span>
          <span class="stat-value">${data.metrics.kFactor.toFixed(2)}</span>
          <div class="stat-accent" style="background:var(--secondary)"></div>
        </div>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <div class="panel-header">
            <h3 class="panel-title">Campanhas Recentes</h3>
            <a onclick="document.querySelector('[data-view=campaigns]').click()" class="text-xs uppercase font-bold text-primary cursor-pointer">Ver Tudo</a>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>ID</th><th>Campanha</th><th>Canal</th><th>Status</th><th>Última Ação</th></tr>
              </thead>
              <tbody>
                ${campaignsHtml || '<tr><td colspan="5" class="opacity-40 text-center py-8">Nenhuma campanha registrada</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h3 class="panel-title">Logs do Agente</h3>
            <span class="badge badge-success text-[9px]">Live AI</span>
          </div>
          <div class="timeline">
            ${decisionsHtml || '<div class="opacity-30 text-sm">Aguardando primeiras decisões autônomas...</div>'}
          </div>
        </section>
      </div>
    </div>

    <!-- VIEW: Campaigns -->
    <div id="view-campaigns" class="view-content">
      <div class="panel-grid" style="grid-template-columns: 1fr;">
        <section class="panel">
          <h3 class="panel-title">Injetar Nova Campanha</h3>
          <form method="post" action="/admin/actions/campaign/create" style="margin-top:24px">
            <div class="panel-grid">
              <div>
                <div class="form-group"><label class="input-label">Nome da Campanha</label><input class="input-control" name="name" placeholder="Ex: Onboarding Especial Setembro" required /></div>
                <div class="form-group"><label class="input-label">Base Copy (IA será aplicada sobre este texto)</label><textarea class="input-control" name="baseCopy" placeholder="Olá {{name}}, temos uma oferta..." required></textarea></div>
              </div>
              <div>
                <div class="form-group"><label class="input-label">Identificador Customizado (Opcional)</label><input class="input-control" name="id" placeholder="onboarding-2026" /></div>
                <div class="form-group"><label class="input-label">Incentivo / Offer Code</label><input class="input-control" name="incentiveOffer" placeholder="BLACKFRIDAY50" /></div>
                <div class="form-group">
                  <label class="input-label">Canal de Entrega</label>
                  <select class="input-control" name="channel">
                    <option value="whatsapp">WhatsApp Gateway</option>
                    <option value="email">Resend API (Email)</option>
                    <option value="telegram">Telegram Bot</option>
                  </select>
                </div>
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end;"><button type="submit" class="btn btn-primary" style="width:auto">Publicar Campanha</button></div>
          </form>
        </section>
      </div>
    </div>

    <!-- VIEW: Dispatch -->
    <div id="view-dispatch" class="view-content">
      <div class="panel-grid" style="grid-template-columns: 1fr;">
        <section class="panel">
          <h3 class="panel-title">Módulo de Disparo em Lote</h3>
          <p class="text-sm opacity-60 mb-8">Execute ações massivas com personalização em tempo real (Llama 3).</p>
          <form method="post" action="/admin/actions/campaign/dispatch">
            <div class="panel-grid">
              <div>
                <div class="form-group"><label class="input-label">ID da Campanha</label><input class="input-control" name="campaignId" required /></div>
                <div class="form-group"><label class="input-label">Limite de Usuários</label><input class="input-control" name="limit" type="number" value="100" min="1" max="500" /></div>
                <div class="form-group">
                  <label class="input-label">Estratégia de Segmentação</label>
                  <select class="input-control" name="includeInactive">
                    <option value="false">Base Ativa (Engajados 30d)</option>
                    <option value="true">Full Base (Deep Reactivation)</option>
                  </select>
                </div>
              </div>
              <div>
                <div class="form-group"><label class="input-label">Capa de Personalização IA</label>
                  <select class="input-control" name="personalize">
                    <option value="true">Ativar (Llama 3 Dynamic)</option>
                    <option value="false">Base Copy Original</option>
                  </select>
                </div>
                <div class="form-group"><label class="input-label">Modo de Segurança</label>
                  <select class="input-control" name="dryRun">
                    <option value="true">Dry Run (Simulação sem envio)</option>
                    <option value="false">LIVE (Envio Real)</option>
                  </select>
                </div>
                <div class="form-group"><label class="input-label">Webhook Override (Labs)</label><input class="input-control" name="webhookUrlOverride" placeholder="https://httpbin.org/post" /></div>
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Iniciar Orquestração de Disparo</button>
          </form>
        </section>
      </div>
    </div>

    <!-- VIEW: Users -->
    <div id="view-users" class="view-content">
      <div class="panel-grid">
        <section class="panel">
          <h3 class="panel-title">Injetar Novo Lead</h3>
          <form method="post" action="/admin/actions/user/create" style="margin-top:20px">
            <div class="panel-grid" style="grid-template-columns: 1fr 1fr;">
              <div class="form-group"><label class="input-label">Nome Completo</label><input class="input-control" name="name" required /></div>
              <div class="form-group"><label class="input-label">Telefone (E.164)</label><input class="input-control" name="phone" placeholder="+55..." /></div>
              <div class="form-group"><label class="input-label">E-mail</label><input class="input-control" name="email" type="email" /></div>
              <div class="form-group">
                <label class="input-label">Canal Preferencial</label>
                <select class="input-control" name="preferredChannel">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="telegram">Telegram</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Salvar Perfil</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="panel-title">Gestão de Opt-out (LGPD)</h3>
          <form method="post" action="/admin/actions/user/optout" style="margin-top:20px">
            <div class="form-group"><label class="input-label">Lead ID</label><input class="input-control" name="userId" required /></div>
            <div class="form-group"><label class="input-label">Motivo / Origem</label><input class="input-control" name="source" value="manual_admin_intervention" /></div>
            <button type="submit" class="btn btn-glass" style="color:#ef4444">Revogar Consentimento</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="panel-title">Injeção em Massa (CSV)</h3>
          <p class="text-sm opacity-60 mb-6">Importe lotes de leads via CSV. Colunas Suportadas: <code>name</code>, <code>email</code>, <code>phone</code>, <code>channel</code>.</p>
          <form method="post" action="/admin/actions/user/upload" enctype="multipart/form-data">
            <div class="form-group">
              <input class="input-control" type="file" name="csvFile" accept=".csv" required style="padding: 10px; background: rgba(0,0,0,0.1);" />
            </div>
            <button type="submit" class="btn btn-glass">Processar Ingestão</button>
          </form>
        </section>
      </div>
      
      <div class="panel-grid" style="margin-top:24px; grid-template-columns: 1fr;">
        <section class="panel">
          <div class="panel-header">
            <h3 class="panel-title">Últimos Leads Registrados</h3>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>ID</th><th>Nome</th><th>Contato</th><th>Canal</th><th>Data</th></tr>
              </thead>
              <tbody>
                ${usersHtml || '<tr><td colspan="5" class="opacity-40 text-center py-8">Nenhum lead encontrado</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <!-- VIEW: WA Groups -->
    <div id="view-wa-groups" class="view-content">
      <div class="panel-grid" style="grid-template-columns: 1fr 1.5fr;">
        <section class="panel">
          <div class="panel-header">
            <h3 class="panel-title">Comunidades e Grupos</h3>
            <button id="btn-fetch-groups" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; width: auto;">Buscar Grupos</button>
          </div>
          <p class="text-sm opacity-60 mb-4">Selecione um grupo do WhatsApp conectado para mapear seus participantes.</p>
          <div id="groups-list-container" class="space-y-4 max-h-[400px] overflow-y-auto pr-2">
            <div class="opacity-40 text-sm text-center py-8">Clique em Buscar Grupos para iniciar a sincronização com seu Gateway.</div>
          </div>
        </section>

        <section class="panel" style="display:flex; flex-direction:column;">
          <h3 class="panel-title">Participantes Identificados</h3>
          <p id="selected-group-name" class="text-sm opacity-60 mb-6">Nenhum grupo selecionado.</p>
          
          <div class="table-container" style="flex:1;">
            <table>
              <thead>
                <tr><th>Número Identificado</th><th>Status</th></tr>
              </thead>
              <tbody id="participants-list-container">
                <tr><td colspan="2" class="opacity-40 text-center py-8">-</td></tr>
              </tbody>
            </table>
          </div>

          <form method="post" action="/admin/actions/groups/import" id="form-import-participants" style="display:none; margin-top:16px;">
            <input type="hidden" name="groupId" id="import-group-id" />
            <input type="hidden" name="groupName" id="import-group-name" />
            <input type="hidden" name="participants" id="import-payload" />
            <div class="flex items-center gap-4">
               <button type="submit" class="btn btn-primary" style="flex:1;">Salvar <span id="import-count">0</span> Leads na Base Mestra</button>
            </div>
          </form>
        </section>
      </div>
    </div>

    <!-- VIEW: Integrations -->
    <div id="view-integrations" class="view-content">
      <div class="panel-grid">
        <section class="panel">
          <h3 class="panel-title">Configurador WhatsApp Gateway</h3>
          ${dispatchTokenStatus}
          <form method="post" action="/admin/actions/integration/save" style="margin-top:24px">
            <div class="form-group"><label class="input-label">Endpoint de Entrega (JSON Webhook)</label><input class="input-control" name="webhookUrl" value="${whatsappWebhookUrl}" placeholder="https://gw.dominio.com/send" required /></div>
            <div class="panel-grid" style="grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group"><label class="input-label">Phone de Teste</label><input class="input-control" name="testPhone" value="${whatsappTestPhone}" /></div>
              <div class="form-group"><label class="input-label">Status Link</label><input class="input-control" value="${escapeHtml(whatsappUpdatedAtLabel)}" readonly /></div>
            </div>
            <div class="form-group"><label class="input-label">Payload de Boas-vindas (Teste)</label><textarea class="input-control" name="testMessage">${whatsappTestMessage}</textarea></div>
            <div class="form-group"><label class="input-label">Administrative Gateway Token (Para extração de grupos)</label><input class="input-control" name="gatewayToken" type="password" value="${escapeHtml(data.whatsappIntegration.gatewayToken || '')}" placeholder="Insira o Token de Admin do Gateway" /></div>
            <button type="submit" class="btn btn-primary">Atualizar Infraestrutura</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="panel-title">Configurador Resend API (Email)</h3>
          <form method="post" action="/admin/actions/integration/email/save" style="margin-top:24px">
            <div class="form-group"><label class="input-label">Endpoint de Entrega (JSON Webhook)</label><input class="input-control" name="webhookUrl" value="${emailWebhookUrl}" placeholder="https://gw.dominio.com/send/email" required /></div>
            <div class="panel-grid" style="grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group"><label class="input-label">E-mail de Teste</label><input class="input-control" type="email" name="testEmail" value="${emailTestEmail}" /></div>
              <div class="form-group"><label class="input-label">Status Link</label><input class="input-control" value="${escapeHtml(emailUpdatedAtLabel)}" readonly /></div>
            </div>
            <div class="form-group"><label class="input-label">Assunto de Boas-vindas (Teste)</label><input class="input-control" name="testSubject" value="${emailTestSubject}" /></div>
            <div class="form-group"><label class="input-label">Corpo do E-mail (Teste)</label><textarea class="input-control" name="testMessage">${emailTestMessage}</textarea></div>
            <button type="submit" class="btn btn-primary">Salvar Configuração de E-mail</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="panel-title">Configurador Telegram Bot</h3>
          <form method="post" action="/admin/actions/integration/telegram/save" style="margin-top:24px">
            <div class="form-group"><label class="input-label">Endpoint de Entrega (JSON Webhook)</label><input class="input-control" name="webhookUrl" value="${telegramWebhookUrl}" placeholder="https://gw.dominio.com/send/telegram" required /></div>
            <div class="panel-grid" style="grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group"><label class="input-label">Chat ID de Teste</label><input class="input-control" name="testChatId" value="${telegramTestChatId}" /></div>
              <div class="form-group"><label class="input-label">Status Link</label><input class="input-control" value="${escapeHtml(telegramUpdatedAtLabel)}" readonly /></div>
            </div>
            <div class="form-group"><label class="input-label">Mensagem de Boas-vindas (Teste)</label><textarea class="input-control" name="testMessage">${telegramTestMessage}</textarea></div>
            <button type="submit" class="btn btn-primary">Salvar Configuração do Telegram</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="panel-title">Diagnostic Tool</h3>
          <p class="text-sm opacity-60 mb-6">Teste de integridade enviando token Bearer <code>DISPATCH_BEARER_TOKEN</code>.</p>
          <form method="post" action="/admin/actions/integration/test">
            <div class="form-group"><label class="input-label">Webhook Override</label><input class="input-control" name="webhookUrl" placeholder="https://..." /></div>
            <button type="submit" class="btn btn-glass">Executar Stress Test</button>
          </form>
        </section>
      </div>
    </div>

    <!-- VIEW: AI Agent -->
    <div id="view-ai-agent" class="view-content">
       <div class="panel-grid" style="grid-template-columns: 1.5fr 1fr;">
          <section class="panel">
            <h3 class="panel-title">Comportamento do Agente Central</h3>
            <div class="mt-6 space-y-4">
               <div class="p-4 bg-glass-bright rounded-xl border border-border">
                  <div class="flex justify-between items-start">
                     <div>
                        <span class="text-primary font-bold">Auto-Kill Low Performance</span>
                        <p class="text-xs opacity-60 mt-1">Pausa campanhas com conversão < 2% após 20 disparos.</p>
                     </div>
                     <span class="badge badge-success">Ativo</span>
                  </div>
               </div>
               <div class="p-4 bg-glass-bright rounded-xl border border-border mt-4">
                  <div class="flex justify-between items-start">
                     <div>
                        <span class="text-primary font-bold">Reativação SMS (Cold Users)</span>
                        <p class="text-xs opacity-60 mt-1">Migra canais se usuário estiver offline há +3 dias.</p>
                     </div>
                     <span class="badge badge-success">Ativo</span>
                  </div>
               </div>
               <div class="p-4 bg-glass-bright rounded-xl border border-border mt-4">
                  <div class="flex justify-between items-start">
                     <div>
                        <span class="text-primary font-bold">Incentivo Viral (Milestones)</span>
                        <p class="text-xs opacity-60 mt-1">Identifica power referrers (5+ indicações).</p>
                     </div>
                     <span class="badge badge-success">Ativo</span>
                  </div>
               </div>
            </div>
          </section>
          
          <section class="panel">
            <h3 class="panel-title">Model Stats</h3>
            <div class="mt-6">
               <div class="flex justify-between mb-2"><span class="text-sm opacity-60">LLM Provider</span><span class="font-mono text-xs">Workers AI</span></div>
               <div class="flex justify-between mb-2"><span class="text-sm opacity-60">Model</span><span class="font-mono text-xs">Llama 3 8B</span></div>
               <div class="flex justify-between mb-4"><span class="text-sm opacity-60">Edge Latency</span><span class="font-mono text-xs">< 100ms</span></div>
               <div class="stat-card" style="padding:16px;">
                  <span class="text-xs opacity-60">Custo Tokens (Estimado)</span>
                  <span class="text-lg font-bold block">$0.00 / mo</span>
               </div>
            </div>
          </section>
       </div>
    </div>
  </main>

  <script>
    // Tab System Logic
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-content');
    const viewTitle = document.getElementById('view-title');
    const viewSubtitle = document.getElementById('view-subtitle');

    const viewMeta = {
      'dashboard': { title: 'Dashboard Operacional', subtitle: 'Visão 360º de interações e métricas virais.' },
      'campaigns': { title: 'Gestão de Campanhas', subtitle: 'Crie e gerencie motores de crescimento.' },
      'dispatch': { title: 'Laboratório de Envios', subtitle: 'Orquestração massiva com inteligência artificial.' },
      'users': { title: 'Base de Leads', subtitle: 'Gestão de perfis e conformidade LGPD.' },
      'wa-groups': { title: 'Explorador de Grupos', subtitle: 'Extração e captura de audiência via grupos de WhatsApp.' },
      'integrations': { title: 'Integrações de Canais', subtitle: 'Configure webhooks e gateways de entrega multicanal.' },
      'ai-agent': { title: 'Agente Autônomo', subtitle: 'Supervisão das decisões tomadas pela IA na Edge.' }
    };

    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const targetView = item.getAttribute('data-view');
        
        // Update Nav
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Update Content
        views.forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + targetView).classList.add('active');

        // Update Headers
        viewTitle.innerText = viewMeta[targetView].title;
        viewSubtitle.innerText = viewMeta[targetView].subtitle;

        // Remember state (optional)
        history.replaceState(null, null, '#' + targetView);
      });
    });

    // Handle initial hash
    const initialView = window.location.hash.substring(1);
    if(initialView && document.querySelector('[data-view="' + initialView + '"]')) {
      document.querySelector('[data-view="' + initialView + '"]').click();
    }

    // WA Groups — calls same-origin Worker proxy (no CORS, token stays server-side)
    const btnFetchGroups = document.getElementById('btn-fetch-groups');
    const groupsContainer = document.getElementById('groups-list-container');
    const participantsContainer = document.getElementById('participants-list-container');
    const formImport = document.getElementById('form-import-participants');
    const btnImportCount = document.getElementById('import-count');

    if(btnFetchGroups) {
      btnFetchGroups.addEventListener('click', async () => {
         btnFetchGroups.disabled = true;
         btnFetchGroups.innerText = 'Consultando...';
         groupsContainer.innerHTML = '<div class="opacity-40 text-sm text-center py-4">Sincronizando com gateway...</div>';
         
         try {
            const response = await fetch('/admin/api/gateway/groups');
            const data = await response.json();
            
            if (data.status === 'success' && Array.isArray(data.groups)) {
                groupsContainer.innerHTML = '';
                data.groups.forEach(g => {
                   const div = document.createElement('div');
                   div.className = 'group-item';
                   div.style.padding = '12px';
                   div.style.background = 'rgba(255,255,255,0.03)';
                   div.style.borderRadius = '12px';
                   div.style.border = '1px solid var(--border)';
                   div.style.cursor = 'pointer';
                   div.style.display = 'flex';
                   div.style.justifyContent = 'space-between';
                   div.style.alignItems = 'center';
                   div.style.marginBottom = '8px';
                   div.onclick = () => loadGroup(g);
                   div.innerHTML = '<span class="font-bold text-sm">' + (g.name || 'Sem Nome') + '</span><span class="badge badge-outline">' + g.count + ' membros</span>';
                   groupsContainer.appendChild(div);
                });
            } else {
                groupsContainer.innerHTML = '<div class="text-error text-sm text-center py-4">' + (data.error || 'Erro ao listar grupos.') + '</div>';
            }
         } catch (e) {
            groupsContainer.innerHTML = '<div class="text-error text-sm text-center py-4">Falha na rede ou gateway offline.</div>';
         } finally {
            btnFetchGroups.disabled = false;
            btnFetchGroups.innerText = 'Sincronizar Novamente';
         }
      });
    }

    async function loadGroup(g) {
       document.getElementById('selected-group-name').innerText = 'Extraindo contatos de: ' + g.name;
       participantsContainer.innerHTML = '<tr><td colspan="2" class="opacity-40 text-center py-8">Consultando API de protocolo...</td></tr>';
       formImport.style.display = 'none';
       
       try {
           const response = await fetch('/admin/api/gateway/groups/' + encodeURIComponent(g.id) + '/participants');
           const data = await response.json();
           
           if (data.status === 'success' && Array.isArray(data.participants)) {
               const phones = data.participants.map(p => p.id.split('@')[0]);
               
               participantsContainer.innerHTML = '';
               phones.slice(0, 50).forEach(phone => {
                  const tr = document.createElement('tr');
                  tr.innerHTML = '<td><code class="compact-code">+' + phone + '</code></td><td><span class="badge badge-success">Sincronizado</span></td>';
                  participantsContainer.appendChild(tr);
               });
               
               if(phones.length > 50) {
                  const tr = document.createElement('tr');
                  tr.innerHTML = '<td colspan="2" class="opacity-40 text-center py-4">+ ' + (phones.length - 50) + ' adicionais carregados</td>';
                  participantsContainer.appendChild(tr);
               }

               document.getElementById('import-group-id').value = g.id;
               document.getElementById('import-group-name').value = g.name;
               document.getElementById('import-payload').value = JSON.stringify(phones);
               
               btnImportCount.innerText = phones.length;
               formImport.style.display = 'block';
           }
       } catch (e) {
           participantsContainer.innerHTML = '<tr><td colspan="2" class="text-error text-center py-8">Erro ao extrair participantes.</td></tr>';
       }
    }
  </script>
</body>
</html>`
}
