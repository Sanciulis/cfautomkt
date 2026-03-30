import { escapeHtml } from '../utils'

export function renderAdminLoginPage(message?: string): string {
  const messageHtml = message
    ? `<div class="alert alert-error">${escapeHtml(message)}</div>`
    : '<div class="alert alert-info">Identifique-se para acessar o console de rádio.</div>'
    
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Cloud | Autenticação</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #10b981;
      --primary-glow: rgba(16, 185, 129, 0.2);
      --bg-dark: #0f172a;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border: rgba(255, 255, 255, 0.08);
      --glass: rgba(30, 41, 59, 0.7);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(at 0% 0%, rgba(16, 185, 129, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(99, 102, 241, 0.1) 0px, transparent 50%);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .login-card {
      width: min(440px, 100%);
      background: var(--glass);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      animation: appear 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes appear {
      from { opacity: 0; transform: scale(0.9) translateY(20px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-bottom: 32px;
    }
    .brand-logo {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--primary), #6366f1);
      border-radius: 12px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 1.5rem;
      color: white;
      margin-bottom: 16px;
      box-shadow: 0 8px 16px var(--primary-glow);
    }
    .brand-name { font-size: 1.5rem; font-weight: 700; color: white; letter-spacing: -0.02em; }
    .brand-name span { color: var(--primary); }

    .alert {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 0.85rem;
      margin-bottom: 24px;
      text-align: center;
      border: 1px solid transparent;
    }
    .alert-info { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border-color: var(--border); }
    .alert-error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2); }

    .form-group { margin-bottom: 24px; }
    .label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 8px; color: var(--text-muted); }
    .input {
      width: 100%;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: white;
      padding: 14px 16px;
      font-family: inherit;
      font-size: 1rem;
      transition: all 0.2s;
    }
    .input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px var(--primary-glow); }

    .btn {
      width: 100%;
      background: var(--primary);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 12px;
      font-family: inherit;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px var(--primary-glow);
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px var(--primary-glow); }
    .btn:active { transform: translateY(0); }

    .footer-text {
      margin-top: 32px;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="brand">
      <div class="brand-logo">M</div>
      <div class="brand-name">Martech<span>Cloud</span></div>
    </div>

    ${messageHtml}

    <form method="post" action="/admin/login">
      <div class="form-group">
        <label class="label" for="password">Chave de Acesso Administrativa</label>
        <input class="input" id="password" name="password" type="password" placeholder="••••••••" autocomplete="current-password" required autofocus />
      </div>
      <button class="btn" type="submit">Entrar no Console</button>
    </form>

    <div class="footer-text">
      &copy; 2026 AI Viral Strategy. Autenticação Edge-Protected.
    </div>
  </div>
</body>
</html>`
}
