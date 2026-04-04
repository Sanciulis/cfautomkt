
    // Mobile Sidebar Logic
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const responsiveSidebarBreakpoint = window.matchMedia('(max-width: 1100px)');

    function closeSidebar() {
      if (!sidebar || !overlay) return;
      document.body.classList.remove('sidebar-open');
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    function openSidebar() {
      if (!sidebar || !overlay) return;
      document.body.classList.add('sidebar-open');
      sidebar.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function toggleSidebar() {
      if (!sidebar || !overlay) return;
      if (document.body.classList.contains('sidebar-open') || sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    }

    if (mobileBtn && sidebar && overlay) {
      mobileBtn.addEventListener('click', toggleSidebar);
      overlay.addEventListener('click', closeSidebar);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeSidebar();
      });

      window.addEventListener('resize', () => {
        if (!responsiveSidebarBreakpoint.matches) {
          closeSidebar();
        }
      });
    }

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
      'control-room': { title: 'Control Room', subtitle: 'Selecione campanha ou jornada, visualize diagrama e execute ações em tempo real.' },
      'newsletter-agent': { title: 'Agente Newsletter', subtitle: 'Inicie abordagens por contato e audite histórico, sentimento e feedback em uma única tela.' },
      'service-agent': { title: 'Agente de Servicos', subtitle: 'Gerencie conversas de agendamento, orcamento e duvidas com rastreabilidade completa.' },
      'journeys': { title: 'Jornadas AI', subtitle: 'Crie e gerencie jornadas conversacionais com persona AI inteligente.' },
      'ai-prompts': { title: 'Engenharia de Prompt', subtitle: 'Versionamento, Rollback e Auditoria Oficial.' },
      'playground': { title: 'Playground AI', subtitle: 'Ambiente seguro para simular e calibrar o funil de IA.' },
      'ai-agent': { title: 'Agente Autônomo', subtitle: 'Supervisão das decisões tomadas pela IA na Edge.' }
    };

    function formatPct(value) {
      return (Number(value || 0) * 100).toFixed(1) + '%';
    }

    function formatMs(value) {
      return Math.round(Number(value || 0)) + ' ms';
    }

    function renderSeverityBadge(severity) {
      const level = String(severity || '').toLowerCase();
      if (level === 'critical') {
        return '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">critical</span>';
      }
      if (level === 'warning') {
        return '<span class="badge badge-warn">warning</span>';
      }
      return '<span class="badge badge-glass">unknown</span>';
    }

    async function loadAIMetrics() {
      const rangeSelect = document.getElementById('ai-metrics-range');
      const refreshBtn = document.getElementById('btn-refresh-ai-metrics');
      const rowsEl = document.getElementById('ai-metrics-rows');
      const totalEl = document.getElementById('ai-total');
      const errEl = document.getElementById('ai-error-rate');
      const fbEl = document.getElementById('ai-fallback-rate');
      const p95El = document.getElementById('ai-latency-p95');
      const updatedAtEl = document.getElementById('ai-metrics-updated-at');
      const alertEl = document.getElementById('ai-metrics-alert');

      if (!rangeSelect || !refreshBtn || !rowsEl) return;

      const hours = rangeSelect.value || '24';
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Atualizando...';

      try {
        const response = await fetch('/admin/api/ai/metrics?hours=' + encodeURIComponent(hours));
        const data = await response.json();

        if (!response.ok || !data || data.error) {
          throw new Error((data && data.error) || 'Falha ao carregar métricas de IA');
        }

        if (totalEl) totalEl.textContent = String(data.totals?.total ?? 0);
        if (errEl) errEl.textContent = formatPct(data.totals?.errorRate);
        if (fbEl) fbEl.textContent = formatPct(data.totals?.fallbackRate);
        if (p95El) p95El.textContent = formatMs(data.totals?.latencyP95Ms);

        const errRate = Number(data.totals?.errorRate || 0);
        const fallbackRate = Number(data.totals?.fallbackRate || 0);
        const p95 = Number(data.totals?.latencyP95Ms || 0);
        let healthBadge = '<span class="badge badge-success">Status: saudável</span>';
        let healthText = 'Operação de IA dentro do esperado.';

        if (errRate > 0.05 || fallbackRate > 0.15 || p95 > 2500) {
          healthBadge = '<span class="badge badge-warn">Status: atenção</span>';
          healthText = 'Há degradação moderada. Revisar fluxos com maior erro/fallback.';
        }
        if (errRate > 0.1 || fallbackRate > 0.25 || p95 > 4000) {
          healthBadge = '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Status: crítico</span>';
          healthText = 'Degradação crítica detectada. Priorizar mitigação imediata.';
        }

        if (alertEl) {
          alertEl.innerHTML =
            '<div class="flex justify-between items-center" style="gap: 12px; flex-wrap: wrap;">' +
              healthBadge +
              '<span class="text-xs opacity-60">Limiares: erro > 5%, fallback > 15%, p95 > 2500ms</span>' +
            '</div>' +
            '<p class="text-sm opacity-80" style="margin-top:8px;">' + healthText + '</p>';
        }

        const flows = Array.isArray(data.flows) ? data.flows : [];
        if (!flows.length) {
          rowsEl.innerHTML = '<tr><td colspan="7" class="opacity-40 text-center py-8">Sem dados de inferência no período selecionado.</td></tr>';
        } else {
          rowsEl.innerHTML = flows.map((flow) => {
            const lastSeen = flow.lastSeenAt ? new Date(flow.lastSeenAt).toLocaleString('pt-BR') : '-';
            return '<tr>' +
              '<td><span class="font-bold">' + String(flow.flow || '-') + '</span></td>' +
              '<td>' + String(flow.total || 0) + '</td>' +
              '<td>' + formatPct(flow.errorRate) + '</td>' +
              '<td>' + formatPct(flow.fallbackRate) + '</td>' +
              '<td>' + Math.round(Number(flow.latencyP50Ms || 0)) + '</td>' +
              '<td>' + Math.round(Number(flow.latencyP95Ms || 0)) + '</td>' +
              '<td><span class="text-xs opacity-60">' + lastSeen + '</span></td>' +
            '</tr>';
          }).join('');
        }

        if (updatedAtEl) {
          const generatedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString('pt-BR') : '-';
          updatedAtEl.textContent = 'Atualizado em ' + generatedAt + ' • Janela: ' + String(data.rangeHours || hours) + 'h';
        }
      } catch (error) {
        rowsEl.innerHTML = '<tr><td colspan="7" class="text-center py-8" style="color:#f87171;">Erro ao carregar métricas de IA.</td></tr>';
        if (updatedAtEl) updatedAtEl.textContent = 'Falha na atualização: ' + String(error);
        if (alertEl) {
          alertEl.innerHTML = '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Status: indisponível</span><p class="text-sm opacity-80" style="margin-top:8px;">Não foi possível carregar as métricas operacionais de IA.</p>';
        }
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Atualizar';
      }
    }

    async function loadAIOpsAlerts() {
      const rangeSelect = document.getElementById('ai-alerts-range');
      const refreshBtn = document.getElementById('btn-refresh-ai-alerts');
      const rowsEl = document.getElementById('ai-alerts-rows');
      const updatedAtEl = document.getElementById('ai-alerts-updated-at');
      const trendRowsEl = document.getElementById('ai-alerts-trend-rows');
      const trendSummaryEl = document.getElementById('ai-alerts-trend-summary');
      const warningCountEl = document.getElementById('ai-alerts-warning-count');
      const criticalCountEl = document.getElementById('ai-alerts-critical-count');

      if (!rangeSelect || !refreshBtn || !rowsEl) return;

      const hours = rangeSelect.value || '168';
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Atualizando...';

      try {
        const response = await fetch('/admin/api/ai/alerts?hours=' + encodeURIComponent(hours));
        const data = await response.json();

        if (!response.ok || !data || data.error) {
          throw new Error((data && data.error) || 'Falha ao carregar alertas operacionais');
        }

        const alerts = Array.isArray(data.alerts) ? data.alerts : [];
        const trendByDay = Array.isArray(data.trendByDay) ? data.trendByDay : [];

        const warningCount = alerts.filter((a) => String(a.severity || '').toLowerCase() === 'warning').length;
        const criticalCount = alerts.filter((a) => String(a.severity || '').toLowerCase() === 'critical').length;

        if (warningCountEl) warningCountEl.textContent = String(warningCount);
        if (criticalCountEl) criticalCountEl.textContent = String(criticalCount);
        if (trendSummaryEl) {
          if (criticalCount > 0) {
            trendSummaryEl.textContent = 'piorando';
            trendSummaryEl.style.color = '#f87171';
          } else if (warningCount > 0) {
            trendSummaryEl.textContent = 'atenção';
            trendSummaryEl.style.color = '#f59e0b';
          } else {
            trendSummaryEl.textContent = 'estável';
            trendSummaryEl.style.color = '#10b981';
          }
        }

        if (!alerts.length) {
          rowsEl.innerHTML = '<tr><td colspan="6" class="opacity-40 text-center py-8">Sem alertas no período selecionado.</td></tr>';
        } else {
          rowsEl.innerHTML = alerts.map((alert) => {
            const severity = String(alert.severity || 'unknown');
            const reason = String(alert.reason || '-');
            const errorRate = formatPct(alert.errorRate || 0);
            const fallbackRate = formatPct(alert.fallbackRate || 0);
            const p95 = Math.round(Number(alert.latencyP95Ms || 0));
            const createdAt = alert.createdAt ? new Date(alert.createdAt).toLocaleString('pt-BR') : '-';

            return '<tr>' +
              '<td>' + renderSeverityBadge(severity) + '</td>' +
              '<td><span class="text-sm opacity-80">' + reason + '</span></td>' +
              '<td>' + errorRate + '</td>' +
              '<td>' + fallbackRate + '</td>' +
              '<td>' + p95 + '</td>' +
              '<td><span class="text-xs opacity-60">' + createdAt + '</span></td>' +
            '</tr>';
          }).join('');
        }

        if (trendRowsEl) {
          if (!trendByDay.length) {
            trendRowsEl.innerHTML = '<tr><td colspan="4" class="opacity-40 text-center py-8">Sem tendência no período selecionado.</td></tr>';
          } else {
            trendRowsEl.innerHTML = trendByDay.map((item) => {
              const day = item.day ? new Date(item.day + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
              const warning = Number(item.warning || 0);
              const critical = Number(item.critical || 0);
              const total = Number(item.total || 0);
              return '<tr>' +
                '<td><span class="text-sm opacity-80">' + day + '</span></td>' +
                '<td><span class="badge badge-warn">' + warning + '</span></td>' +
                '<td><span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">' + critical + '</span></td>' +
                '<td>' + total + '</td>' +
              '</tr>';
            }).join('');
          }
        }

        if (updatedAtEl) {
          const generatedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString('pt-BR') : '-';
          updatedAtEl.textContent = 'Atualizado em ' + generatedAt + ' • Janela: ' + String(data.rangeHours || hours) + 'h';
        }
      } catch (error) {
        rowsEl.innerHTML = '<tr><td colspan="6" class="text-center py-8" style="color:#f87171;">Erro ao carregar alertas operacionais de IA.</td></tr>';
        if (trendRowsEl) {
          trendRowsEl.innerHTML = '<tr><td colspan="4" class="text-center py-8" style="color:#f87171;">Erro ao carregar tendência de alertas.</td></tr>';
        }
        if (updatedAtEl) updatedAtEl.textContent = 'Falha na atualização: ' + String(error);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Atualizar';
      }
    }

    const aiRangeSelect = document.getElementById('ai-metrics-range');
    const aiRefreshBtn = document.getElementById('btn-refresh-ai-metrics');
    if (aiRangeSelect) aiRangeSelect.addEventListener('change', loadAIMetrics);
    if (aiRefreshBtn) aiRefreshBtn.addEventListener('click', loadAIMetrics);
    loadAIMetrics();

    const aiAlertsRangeSelect = document.getElementById('ai-alerts-range');
    const aiAlertsRefreshBtn = document.getElementById('btn-refresh-ai-alerts');
    const aiAlertsExportBtn = document.getElementById('btn-export-ai-alerts');
    if (aiAlertsRangeSelect) aiAlertsRangeSelect.addEventListener('change', loadAIOpsAlerts);
    if (aiAlertsRefreshBtn) aiAlertsRefreshBtn.addEventListener('click', loadAIOpsAlerts);
    if (aiAlertsExportBtn) {
      aiAlertsExportBtn.addEventListener('click', () => {
        const rangeValue = aiAlertsRangeSelect ? aiAlertsRangeSelect.value : '168';
        const url = '/admin/api/ai/alerts/export.csv?hours=' + encodeURIComponent(rangeValue || '168');
        window.open(url, '_blank');
      });
    }
    loadAIOpsAlerts();

    // AI Eval Dataset Flow
    const aiEvalLimitSelect = document.getElementById('ai-eval-limit');
    const aiEvalCsvBtn = document.getElementById('btn-export-eval-csv');
    const aiEvalJsonBtn = document.getElementById('btn-export-eval-json');

    if (aiEvalCsvBtn) {
      aiEvalCsvBtn.addEventListener('click', () => {
        const limit = aiEvalLimitSelect ? aiEvalLimitSelect.value : '500';
        window.open('/admin/api/ai/eval-dataset/export?format=csv&limit=' + encodeURIComponent(limit), '_blank');
      });
    }
    if (aiEvalJsonBtn) {
      aiEvalJsonBtn.addEventListener('click', () => {
        const limit = aiEvalLimitSelect ? aiEvalLimitSelect.value : '500';
        window.open('/admin/api/ai/eval-dataset/export?format=json&limit=' + encodeURIComponent(limit), '_blank');
      });
    }

    // AI Prompt Manager / Versioning Logic
    const btnPromptLoad = document.getElementById('btn-prompt-load');
    const btnPromptPreview = document.getElementById('btn-prompt-preview');
    const btnPromptPublish = document.getElementById('btn-prompt-publish');
    const promptTargetSelect = document.getElementById('prompt-target-select');
    const promptEditorArea = document.getElementById('prompt-editor-area');
    const promptHistoryRows = document.getElementById('prompt-history-rows');
    const promptPreviewBox = document.getElementById('prompt-preview-box');
    const promptPreviewMeta = document.getElementById('prompt-preview-meta');
    const promptPreviewOutput = document.getElementById('prompt-preview-output');
    const promptPreviewRunInference = document.getElementById('prompt-preview-run-inference');
    const promptPreviewUserMessageInput = document.getElementById('prompt-preview-user-message');

    function hidePromptPreview() {
      if (promptPreviewBox) promptPreviewBox.classList.add('hidden');
      if (promptPreviewMeta) promptPreviewMeta.textContent = '';
      if (promptPreviewOutput) promptPreviewOutput.textContent = '';
    }

    function showPromptPreview(preview, dryRunInference) {
      if (!promptPreviewBox || !promptPreviewMeta || !promptPreviewOutput) return;

      const warnings = Array.isArray(preview?.validation?.warnings) ? preview.validation.warnings : [];
      const unresolved = Array.isArray(preview?.unresolvedPlaceholders) ? preview.unresolvedPlaceholders : [];
      const statusParts = [
        'Target: ' + String(preview?.validation?.normalizedTargetId || '-'),
        'Placeholders detectados: ' + String((preview?.validation?.detectedPlaceholders || []).length || 0),
      ];

      if (warnings.length) {
        statusParts.push('Avisos: ' + warnings.join(' | '));
      }
      if (unresolved.length) {
        statusParts.push('Nao resolvidos: ' + unresolved.join(', '));
      }

      if (dryRunInference?.requested) {
        if (dryRunInference.error) {
          statusParts.push('Dry-run: erro na inferencia');
        } else if (dryRunInference.executed) {
          statusParts.push('Dry-run: inferencia executada');
        }
      }

      promptPreviewMeta.textContent = statusParts.join(' • ');

      const renderedPromptText = String(preview?.renderedPrompt || '');
      const outputBlocks = ['=== Prompt Renderizado ===\n' + renderedPromptText];

      if (dryRunInference?.requested) {
        const dryRunLines = [
          '=== Dry-run de Inferencia ===',
          'Modelo: ' + String(dryRunInference.model || '-'),
          'Mensagem de teste: ' + String(dryRunInference.userMessage || '-'),
        ];

        if (dryRunInference.error) {
          dryRunLines.push('Erro: ' + String(dryRunInference.error));
        } else {
          dryRunLines.push('Resposta: ' + String(dryRunInference.responseText || '[vazio]'));
          dryRunLines.push('Fallback usado: ' + (dryRunInference.fallbackUsed ? 'sim' : 'nao'));
        }

        outputBlocks.push(dryRunLines.join('\n'));
      }

      promptPreviewOutput.textContent = outputBlocks.join('\n\n');
      promptPreviewBox.classList.remove('hidden');
    }

    async function loadPromptData() {
      const targetId = promptTargetSelect.value;
      if (!targetId) return;
      
      btnPromptLoad.disabled = true;
      btnPromptLoad.innerText = '...';
      promptEditorArea.style.opacity = '0.3';
      promptEditorArea.style.pointerEvents = 'none';

      try {
        const res = await fetch('/admin/api/ai/prompts/' + encodeURIComponent(targetId));
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        // Preencher editor (Ativo)
        document.getElementById('prompt-editor-text').value = data.active.text || '';
        document.getElementById('prompt-editor-model').value = data.active.model || '@cf/meta/llama-3-8b-instruct';
        document.getElementById('prompt-editor-reason').value = '';

        // Habilitar área
        promptEditorArea.style.opacity = '1';
        promptEditorArea.style.pointerEvents = 'auto';
        hidePromptPreview();

        // Preencher Histórico
        const history = data.history || [];
        document.getElementById('prompt-history-badge').innerText = history.length + ' deploys';
        if (history.length === 0) {
          promptHistoryRows.innerHTML = '<tr><td colspan="3" class="opacity-40 text-center py-8">Nenhum deploy para este target ainda.</td></tr>';
        } else {
          promptHistoryRows.innerHTML = history.map((v, i) => {
            const isCurrent = i === 0;
            const date = new Date(v.created_at).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
            return '<tr>' +
              '<td>' +
                 '<span class="font-bold">v' + v.id + '</span> ' + (isCurrent ? '<span class="badge badge-success text-[0.6rem] py-0 px-1 ml-1">Prod</span>' : '') + '<br/>' +
                 '<span class="text-xs opacity-60">' + date + '</span>' +
              '</td>' +
              '<td>' +
                 '<span class="text-sm opacity-80 block truncate max-w-[200px]" title="' + v.change_reason + '">' + v.change_reason + '</span>' +
                 '<span class="text-xs opacity-60 block truncate max-w-[150px]">' + v.model + '</span>' +
              '</td>' +
              '<td>' +
                (!isCurrent ? '<button class="btn btn-outline" style="font-size:0.7rem; padding: 4px 8px;" onclick="rollbackPrompt(' + v.id + ')">Rever / Rollback</button>' : '<span class="opacity-40 text-xs">Atual</span>') + 
              '</td>' +
            '</tr>';
          }).join('');

          // Bind cache pro rollback
          window.__promptHistoryCache = history;
        }

      } catch(e) {
        alert('Erro ao carregar prompts: ' + e.message);
      } finally {
        btnPromptLoad.disabled = false;
        btnPromptLoad.innerText = 'Carregar';
      }
    }

    if (btnPromptLoad) {
      btnPromptLoad.addEventListener('click', loadPromptData);
    }

    if (btnPromptPreview) {
      btnPromptPreview.addEventListener('click', async () => {
        const targetId = promptTargetSelect.value;
        const promptText = document.getElementById('prompt-editor-text').value;
        const model = document.getElementById('prompt-editor-model').value;
        const runInference = Boolean(promptPreviewRunInference && promptPreviewRunInference.checked);
        const userMessage = promptPreviewUserMessageInput ? promptPreviewUserMessageInput.value : '';

        if (!promptText) return alert('Prompt base é obrigatório.');

        btnPromptPreview.disabled = true;
        const previousLabel = btnPromptPreview.innerText;
        btnPromptPreview.innerText = 'Validando...';

        try {
          const res = await fetch('/admin/api/ai/prompts/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId, promptText, model, runInference, userMessage })
          });

          const data = await res.json();
          const preview = data.preview;
          const dryRunInference = data.dryRunInference;
          if (!res.ok || data.error || !preview) {
            const validationErrors = Array.isArray(data?.preview?.validation?.errors)
              ? data.preview.validation.errors
              : [];
            const messageParts = [data.error || 'Falha ao validar prompt.'];
            if (validationErrors.length) {
              messageParts.push('Erros: ' + validationErrors.join(' | '));
            }
            throw new Error(messageParts.join('\n'));
          }

          showPromptPreview(preview, dryRunInference);
        } catch (e) {
          hidePromptPreview();
          alert('Falha no preview: ' + e.message);
        } finally {
          btnPromptPreview.disabled = false;
          btnPromptPreview.innerText = previousLabel;
        }
      });
    }

    if (btnPromptPublish) {
      btnPromptPublish.addEventListener('click', async () => {
         const targetId = promptTargetSelect.value;
         const promptText = document.getElementById('prompt-editor-text').value;
         const model = document.getElementById('prompt-editor-model').value;
         const changeReason = document.getElementById('prompt-editor-reason').value || 'Ajustes via Painel Admin';

         if(!promptText) return alert('Prompt base é obrigatório.');
         if(confirm('Isso atualizará o comportamento AI de TODOS os usuários deste Target em Produção. Tem certeza?')) {
            btnPromptPublish.disabled = true;
            btnPromptPublish.innerText = 'Publicando...';

            try {
               const res = await fetch('/admin/api/ai/prompts', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ targetId, promptText, model, changeReason })
               });
               const data = await res.json();
               if(!res.ok || data.error) {
                 const validationErrors = Array.isArray(data?.validation?.errors) ? data.validation.errors : [];
                 const validationWarnings = Array.isArray(data?.validation?.warnings) ? data.validation.warnings : [];
                 const messageParts = [data.error || 'Falha ao publicar prompt.'];
                 if (validationErrors.length) {
                   messageParts.push('Erros: ' + validationErrors.join(' | '));
                 }
                 if (validationWarnings.length) {
                   messageParts.push('Avisos: ' + validationWarnings.join(' | '));
                 }
                 throw new Error(messageParts.join('\n'));
               }

               const warnings = Array.isArray(data.warnings) ? data.warnings : [];
               const successMessage = warnings.length
                 ? 'Publicado com sucesso!\n\nAvisos: ' + warnings.join(' | ')
                 : 'Publicado com sucesso!';
               alert(successMessage);
               await loadPromptData(); // refresh UI
            } catch (e) {
               alert('Falha ao publicar: ' + e.message);
            } finally {
               btnPromptPublish.disabled = false;
               btnPromptPublish.innerText = 'Publicar Nova Versão (Ir para Prod)';
            }
         }
      });
    }

    window.rollbackPrompt = function(id) {
       const v = window.__promptHistoryCache?.find(x => x.id === id);
       if(v) {
         document.getElementById('prompt-editor-text').value = v.prompt_text;
         document.getElementById('prompt-editor-model').value = v.model;
         document.getElementById('prompt-editor-reason').value = 'Rollback (Restaurado da v' + v.id + ') - ' + v.change_reason;
         alert('Prompt V' + id + ' foi carregado no Editor! Revise o texto à esquerda e clique em "Publicar Nova Versão" se desejar jogar para Produção.');
       }
    };

    // A/B Test Runner Logic
    const btnRunEval = document.getElementById('btn-run-eval');
    if (btnRunEval) {
      btnRunEval.addEventListener('click', async () => {
        const transcript = document.getElementById('eval-transcript').value.trim();
        const promptA = document.getElementById('eval-prompt-a').value.trim();
        const promptB = document.getElementById('eval-prompt-b').value.trim();

        if (!transcript || !promptA) return alert('Transcript e Prompt A são obrigatórios.');

        btnRunEval.disabled = true;
        btnRunEval.textContent = 'Avaliando...';
        
        document.getElementById('eval-loading').classList.remove('hidden');
        document.getElementById('eval-res-a').classList.add('hidden');
        document.getElementById('eval-res-b').classList.add('hidden');

        try {
          const response = await fetch('/admin/api/ai/eval/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, promptA, promptB })
          });
          const res = await response.json();

          if (res.error) throw new Error(res.error);

          // Populate A
          if (res.resultA) {
            document.getElementById('eval-res-a').classList.remove('hidden');
            document.getElementById('eval-txt-a').textContent = '"' + res.resultA.response + '"';
            document.getElementById('eval-tone-a').textContent = res.resultA.scorecard.tone;
            document.getElementById('eval-cta-a').textContent = res.resultA.scorecard.cta;
            document.getElementById('eval-safe-a').textContent = (res.resultA.scorecard.safety === 1 ? 'Sim' : 'Não');
            const colorA = res.resultA.scorecard.safety === 0 ? '#f87171' : 'inherit';
            document.getElementById('eval-safe-a').style.color = colorA;
            document.getElementById('eval-rsn-a').textContent = res.resultA.scorecard.reasoning;
          }

          // Populate B
          if (res.resultB && promptB) {
            document.getElementById('eval-res-b').classList.remove('hidden');
            document.getElementById('eval-txt-b').textContent = '"' + res.resultB.response + '"';
            document.getElementById('eval-tone-b').textContent = res.resultB.scorecard.tone;
            document.getElementById('eval-cta-b').textContent = res.resultB.scorecard.cta;
            document.getElementById('eval-safe-b').textContent = (res.resultB.scorecard.safety === 1 ? 'Sim' : 'Não');
            const colorB = res.resultB.scorecard.safety === 0 ? '#f87171' : 'inherit';
            document.getElementById('eval-safe-b').style.color = colorB;
            document.getElementById('eval-rsn-b').textContent = res.resultB.scorecard.reasoning;
          }

        } catch (e) {
          alert('Erro na avaliação: ' + e);
        } finally {
          document.getElementById('eval-loading').classList.add('hidden');
          btnRunEval.disabled = false;
          btnRunEval.textContent = 'Rodar Avaliação A/B';
        }
      });
    }

    function activateView(targetView) {
      if (!targetView) return;

      const viewElement = document.getElementById('view-' + targetView);
      const metadata = viewMeta[targetView];
      if (!viewElement || !metadata) {
        console.warn('Unknown admin view:', targetView);
        return;
      }

      // Update Nav
      navItems.forEach(i => i.classList.remove('active'));
      const activeNav = document.querySelector('[data-view="' + targetView + '"]');
      if (activeNav) activeNav.classList.add('active');

      // Update Content
      views.forEach(v => v.classList.remove('active'));
      viewElement.classList.add('active');

      // Close sidebar on mobile if open
      if (responsiveSidebarBreakpoint.matches) {
        closeSidebar();
      }

      // Update Headers
      if (viewTitle) viewTitle.innerText = metadata.title;
      if (viewSubtitle) viewSubtitle.innerText = metadata.subtitle;

      // Remember state
      history.replaceState(null, null, '#' + targetView);
    }

    navItems.forEach(item => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        activateView(item.getAttribute('data-view'));
      });
    });

    // Handle initial hash and fallback
    const initialView = window.location.hash.substring(1);
    if (initialView && document.querySelector('[data-view="' + initialView + '"]')) {
      activateView(initialView);
    } else {
      activateView('dashboard');
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

    function resolveParticipantContact(participantId) {
      if (typeof participantId !== 'string') return null;
      const normalizedId = participantId.trim().toLowerCase();
      if (!normalizedId) return null;

      const atIndex = normalizedId.indexOf('@');
      if (atIndex > 0) {
        const localPart = normalizedId.slice(0, atIndex).trim();
        const domainPart = normalizedId.slice(atIndex + 1).trim();
        if (!localPart || !domainPart) return null;

        const canonicalId = localPart + '@' + domainPart;

        if (domainPart === 's.whatsapp.net' || domainPart === 'c.us') {
          const userPart = localPart.split(':')[0];
          const digits = userPart.replace(/[^0-9]/g, '');
          if (digits.length >= 10 && digits.length <= 15) {
            return {
              value: digits,
              display: '+' + digits,
              kind: 'phone',
              dedupeKey: 'phone:' + digits,
              domain: domainPart,
            };
          }
          return {
            value: canonicalId,
            display: canonicalId,
            kind: 'jid',
            dedupeKey: 'jid:' + canonicalId,
            domain: domainPart,
          };
        }

        if (domainPart === 'lid') {
          return {
            value: canonicalId,
            display: canonicalId,
            kind: 'jid',
            dedupeKey: 'jid:' + canonicalId,
            domain: domainPart,
          };
        }

        return { ignoredDomain: domainPart };
      }

      const digits = normalizedId.replace(/[^0-9]/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        return {
          value: digits,
          display: '+' + digits,
          kind: 'phone',
          dedupeKey: 'phone:' + digits,
          domain: 'digits',
        };
      }

      return { ignoredDomain: 'sem-dominio' };
    }

    async function loadGroup(g) {
       document.getElementById('selected-group-name').innerText = 'Extraindo contatos de: ' + g.name;
       participantsContainer.innerHTML = '<tr><td colspan="2" class="opacity-40 text-center py-8">Consultando API de protocolo...</td></tr>';
       formImport.style.display = 'none';
       
       try {
           const response = await fetch('/admin/api/gateway/groups/' + encodeURIComponent(g.id) + '/participants');
           const data = await response.json();
           
            if (data.status === 'success' && Array.isArray(data.participants)) {
              const contacts = [];
              const seenContacts = new Set();
              let ignoredParticipants = 0;
              let duplicatedParticipants = 0;
              let jidFallbackParticipants = 0;
              const ignoredByDomain = {};

              data.participants.forEach((participant) => {
                const participantId = participant && typeof participant.id === 'string' ? participant.id : '';
                const resolvedContact = resolveParticipantContact(participantId);

                if (!resolvedContact || !resolvedContact.value) {
                  const domain = resolvedContact && resolvedContact.ignoredDomain
                    ? resolvedContact.ignoredDomain
                    : participantId.includes('@')
                      ? participantId.split('@').pop().toLowerCase()
                      : 'sem-dominio';
                  ignoredByDomain[domain] = (ignoredByDomain[domain] || 0) + 1;
                  ignoredParticipants += 1;
                  return;
                }

                if (seenContacts.has(resolvedContact.dedupeKey)) {
                  duplicatedParticipants += 1;
                  return;
                }

                seenContacts.add(resolvedContact.dedupeKey);
                if (resolvedContact.kind === 'jid') {
                  jidFallbackParticipants += 1;
                }
                contacts.push(resolvedContact);
              });
               
              participantsContainer.innerHTML = '';

              if (contacts.length === 0) {
                const ignoredDomainDetails = Object.entries(ignoredByDomain)
                  .map(([domain, count]) => domain + ': ' + count)
                  .join(' | ');
                participantsContainer.innerHTML = '<tr><td colspan="2" class="text-error text-center py-8">Nenhum contato valido encontrado neste grupo.</td></tr>';
                if (ignoredDomainDetails) {
                  const tr = document.createElement('tr');
                  tr.innerHTML = '<td colspan="2" class="opacity-60 text-center py-4">Dominios ignorados -> ' + ignoredDomainDetails + '</td>';
                  participantsContainer.appendChild(tr);
                }
                document.getElementById('selected-group-name').innerText = 'Extraindo contatos de: ' + g.name + ' (0 contatos validos)';
                return;
              }

              contacts.slice(0, 50).forEach((contact) => {
                const tr = document.createElement('tr');
                const badge = contact.kind === 'phone' ? 'Telefone' : 'ID WhatsApp';
                const badgeClass = contact.kind === 'phone' ? 'badge-success' : 'badge-outline';
                tr.innerHTML = '<td><code class="compact-code">' + contact.display + '</code></td><td><span class="badge ' + badgeClass + '">' + badge + '</span></td>';
                participantsContainer.appendChild(tr);
              });
               
              if(contacts.length > 50) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="2" class="opacity-40 text-center py-4">+ ' + (contacts.length - 50) + ' adicionais carregados</td>';
                participantsContainer.appendChild(tr);
              }

              if (ignoredParticipants > 0 || duplicatedParticipants > 0 || jidFallbackParticipants > 0) {
                const ignoredDomainDetails = Object.entries(ignoredByDomain)
                  .map(([domain, count]) => domain + ': ' + count)
                  .join(' | ');
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="2" class="opacity-60 text-center py-4">Fallback por ID WhatsApp: ' + jidFallbackParticipants + '. Ignorados: ' + ignoredParticipants + '. Duplicados removidos: ' + duplicatedParticipants + '.' + (ignoredDomainDetails ? ' Dominios ignorados -> ' + ignoredDomainDetails : '') + '</td>';
                participantsContainer.appendChild(tr);
              }

              document.getElementById('selected-group-name').innerText = 'Extraindo contatos de: ' + g.name + ' (' + contacts.length + ' contatos validos)';

               document.getElementById('import-group-id').value = g.id;
               document.getElementById('import-group-name').value = g.name;
               document.getElementById('import-payload').value = JSON.stringify(contacts.map((contact) => contact.value));
               
               btnImportCount.innerText = contacts.length;
               formImport.style.display = 'block';
           }
       } catch (e) {
           participantsContainer.innerHTML = '<tr><td colspan="2" class="text-error text-center py-8">Erro ao extrair participantes.</td></tr>';
       }
    }

    // Playground AI Chat Logic
    let pgChatHistory = [];
    const chatContainer = document.getElementById('pg-chat-history');
    const pgInput = document.getElementById('pg-chat-input');
    const btnPgSend = document.getElementById('btn-pg-send');
    const phaseDisplay = document.getElementById('pg-current-phase-display');

    function appendPgMessage(role, text) {
      if (chatContainer.querySelector('.text-center.opacity-40')) {
        chatContainer.innerHTML = '';
      }
      const isUser = role === 'user';
      const div = document.createElement('div');
      div.style.alignSelf = isUser ? 'flex-end' : 'flex-start';
      div.style.background = isUser ? 'var(--primary)' : 'rgba(255,255,255,0.05)';
      div.style.color = isUser ? '#000' : 'var(--text)';
      div.style.padding = '12px 16px';
      div.style.borderRadius = '12px';
      div.style.maxWidth = '80%';
      div.style.border = isUser ? 'none' : '1px solid var(--border)';
      div.style.lineHeight = '1.4';
      div.innerText = text;
      chatContainer.appendChild(div);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      pgChatHistory.push({ role, content: text });
    }

    async function sendPgMessage() {
      const msg = pgInput.value.trim();
      if (!msg) return;
      
      appendPgMessage('user', msg);
      pgInput.value = '';
      btnPgSend.disabled = true;
      btnPgSend.innerText = '...';

      const payload = {
        message: msg,
        systemPrompt: document.getElementById('pg-sys-prompt').value,
        objective: document.getElementById('pg-objective').value,
        currentPhase: document.getElementById('pg-phase').value,
        userProfile: {
          name: 'Lead Simulado',
          psychologicalProfile: document.getElementById('pg-profile').value,
          preferredChannel: 'whatsapp'
        },
        chatHistory: pgChatHistory.slice(0, -1) // remove the one we just added to send as current
      };

      try {
        const response = await fetch('/admin/api/playground/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (data.status === 'success') {
           appendPgMessage('assistant', data.response);
           
           if (data.phaseAdvanced) {
              const notice = document.createElement('div');
              notice.className = 'text-center text-xs font-mono mb-2 mt-2';
              notice.style.color = 'var(--success)';
              notice.innerText = '⚡ SINAL DETECTADO: Funil Avançou para -> ' + data.currentPhase.toUpperCase();
              chatContainer.appendChild(notice);
              
              document.getElementById('pg-phase').value = data.currentPhase;
              phaseDisplay.innerText = 'Fase: ' + data.currentPhase;
           }
        } else {
           appendPgMessage('assistant', '[Erro da API] ' + (data.error || 'Falha no playground'));
        }
      } catch (err) {
        appendPgMessage('assistant', '[Exceção] Falha de comunicação de rede');
      } finally {
        btnPgSend.disabled = false;
        btnPgSend.innerText = 'Enviar';
        pgInput.focus();
      }
    }

    if(btnPgSend) {
      btnPgSend.addEventListener('click', sendPgMessage);
      pgInput.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') sendPgMessage(); 
      });

      document.getElementById('btn-pg-reset').addEventListener('click', () => {
        pgChatHistory = [];
        chatContainer.innerHTML = '<div class="text-center opacity-40 text-sm mt-8">Histórico resetado. Nova simulação.</div>';
        phaseDisplay.innerText = 'Fase: ' + document.getElementById('pg-phase').value;
      });
      
      document.getElementById('pg-phase').addEventListener('change', (e) => {
        phaseDisplay.innerText = 'Fase: ' + e.target.value;
      });
    }

  
