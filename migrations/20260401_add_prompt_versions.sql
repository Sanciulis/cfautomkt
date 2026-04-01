-- Criação da tabela para auditoria e versionamento de Prompts (Etapa 3 do Roadmap de IA)
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL, -- Ex: 'flow:personalized_message', 'persona:uuid'
  prompt_text TEXT NOT NULL,
  model TEXT DEFAULT '@cf/meta/llama-3-8b-instruct',
  updated_by TEXT DEFAULT 'admin',
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_target ON ai_prompt_versions(target_id, created_at DESC);
