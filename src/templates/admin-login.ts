import { escapeHtml } from '../utils'

export function renderAdminLoginPage(message?: string): string {
  const messageHtml = message
    ? `<p class="notice">${escapeHtml(message)}</p>`
    : '<p class="hint">Use sua senha administrativa para entrar.</p>'
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Admin Login</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
    :root {
      --bg: #f7f4ea;
      --panel: #fffdf6;
      --ink: #192126;
      --muted: #5d666d;
      --accent: #005f5a;
      --accent-soft: #d6f0ee;
      --danger: #b42318;
      --line: #d7d8cf;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 10% 10%, #d6f0ee 0%, transparent 40%),
        radial-gradient(circle at 90% 90%, #f0e7d3 0%, transparent 38%),
        var(--bg);
      color: var(--ink);
      font-family: 'Space Grotesk', sans-serif;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(480px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 20px 55px rgba(0, 0, 0, 0.12);
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 1.55rem;
      letter-spacing: 0.02em;
    }
    .subtitle {
      margin: 0 0 14px 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .notice, .hint {
      margin: 0 0 16px 0;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.92rem;
    }
    .notice {
      background: #fde8e8;
      color: var(--danger);
      border: 1px solid #f9c8c8;
    }
    .hint {
      background: var(--accent-soft);
      color: var(--accent);
      border: 1px solid #b7e2de;
    }
    label {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      font: inherit;
      background: #ffffff;
    }
    button {
      width: 100%;
      margin-top: 14px;
      border: none;
      border-radius: 10px;
      background: var(--accent);
      color: #fff;
      padding: 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Martech Admin</h1>
    <p class="subtitle">Acesso protegido para operacao de campanhas.</p>
    ${messageHtml}
    <form method="post" action="/admin/login">
      <label for="password">Senha administrativa</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>`
}
