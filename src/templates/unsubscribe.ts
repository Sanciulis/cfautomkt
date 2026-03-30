import { escapeHtml } from '../utils'

export function renderUnsubscribePage(data: {
  title: string
  message: string
  success: boolean
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root {
      --bg: #f4f7f9;
      --panel: #ffffff;
      --ink: #1a2228;
      --ok-bg: #e7f7ef;
      --ok-ink: #16653f;
      --err-bg: #fde9e9;
      --err-ink: #9f1c1c;
      --line: #d8e0e8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, sans-serif;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    main {
      width: min(520px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 22px;
    }
    h1 { margin: 0 0 10px 0; font-size: 1.4rem; }
    p {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: ${data.success ? 'var(--ok-bg)' : 'var(--err-bg)'};
      color: ${data.success ? 'var(--ok-ink)' : 'var(--err-ink)'};
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(data.title)}</h1>
    <p>${escapeHtml(data.message)}</p>
  </main>
</body>
</html>`
}
