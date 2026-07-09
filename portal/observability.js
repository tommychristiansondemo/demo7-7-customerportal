/**
 * Vehicle Service Intelligence - Observability Dashboard
 *
 * Displays pipeline execution metrics alongside the diagnostic report:
 * - Per-stage latency metrics (from WebSocket metadata)
 * - Model selection decisions (which model was used per stage)
 * - Token count / estimated cost per stage (if available)
 * - Summary table showing pipeline execution timeline
 *
 * Data is sourced from window.VSI_METADATA populated by websocket.js
 *
 * Requirements: 13.2
 */

(function () {
  'use strict';

  // --- Constants ---
  var STAGES = [
    'Triage',
    'Diagnostic Research',
    'Parts & Logistics',
    'Warranty Determination',
    'Summary'
  ];

  // --- Rendering ---

  /**
   * Renders the full observability dashboard into the provided container element.
   * Called when the pipeline completes and results are displayed.
   */
  function renderDashboard(containerEl) {
    if (!containerEl) return;

    var metadata = window.VSI_METADATA || {};
    var hasAnyData = Object.keys(metadata).length > 0;

    if (!hasAnyData) {
      containerEl.innerHTML =
        '<div class="obs-empty">' +
          '<p>No observability data available for this pipeline run.</p>' +
        '</div>';
      return;
    }

    var html = '';

    // Pipeline summary metrics
    html += renderPipelineSummary(metadata);

    // Execution timeline table
    html += renderTimelineTable(metadata);

    // Model selection breakdown
    html += renderModelSelections(metadata);

    // Cost breakdown (if token/cost data available)
    html += renderCostBreakdown(metadata);

    containerEl.innerHTML = html;
  }

  /**
   * Renders the pipeline summary metrics bar (total duration, stages completed, total cost).
   */
  function renderPipelineSummary(metadata) {
    var totalLatency = 0;
    var totalTokens = 0;
    var totalCost = 0;
    var stagesWithData = 0;

    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      if (meta) {
        stagesWithData++;
        if (meta.latencyMs) totalLatency += meta.latencyMs;
        if (meta.tokenCount) totalTokens += meta.tokenCount;
        if (meta.estimatedCostUsd) totalCost += meta.estimatedCostUsd;
      }
    });

    var html = '<div class="obs-summary">';

    // Total duration
    html += '<div class="obs-metric">';
    html += '<div class="obs-metric-value">' + formatDuration(totalLatency) + '</div>';
    html += '<div class="obs-metric-label">Total Pipeline Duration</div>';
    html += '</div>';

    // Stages completed
    html += '<div class="obs-metric">';
    html += '<div class="obs-metric-value">' + stagesWithData + ' / ' + STAGES.length + '</div>';
    html += '<div class="obs-metric-label">Stages Completed</div>';
    html += '</div>';

    // Total tokens (if available)
    if (totalTokens > 0) {
      html += '<div class="obs-metric">';
      html += '<div class="obs-metric-value">' + totalTokens.toLocaleString() + '</div>';
      html += '<div class="obs-metric-label">Total Tokens</div>';
      html += '</div>';
    }

    // Total cost (if available)
    if (totalCost > 0) {
      html += '<div class="obs-metric">';
      html += '<div class="obs-metric-value">$' + totalCost.toFixed(4) + '</div>';
      html += '<div class="obs-metric-label">Estimated Total Cost</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Renders the execution timeline table showing per-stage metrics.
   */
  function renderTimelineTable(metadata) {
    var html = '<div class="obs-section">';
    html += '<h4 class="obs-section-title">Execution Timeline</h4>';
    html += '<table class="obs-table">';
    html += '<thead><tr>';
    html += '<th>Stage</th>';
    html += '<th>Model</th>';
    html += '<th>Latency</th>';
    html += '<th>Tokens</th>';
    html += '<th>Est. Cost</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    var cumulativeMs = 0;

    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      html += '<tr>';
      html += '<td class="obs-stage-name">' + escapeHtml(stage) + '</td>';

      if (meta) {
        html += '<td><span class="obs-model-badge">' + escapeHtml(formatModelId(meta.modelId)) + '</span></td>';
        html += '<td class="obs-mono">' + (meta.latencyMs ? formatDuration(meta.latencyMs) : '—') + '</td>';
        html += '<td class="obs-mono">' + (meta.tokenCount ? meta.tokenCount.toLocaleString() : '—') + '</td>';
        html += '<td class="obs-mono">' + (meta.estimatedCostUsd ? '$' + meta.estimatedCostUsd.toFixed(4) : '—') + '</td>';
        if (meta.latencyMs) cumulativeMs += meta.latencyMs;
      } else {
        html += '<td>—</td>';
        html += '<td class="obs-mono">—</td>';
        html += '<td class="obs-mono">—</td>';
        html += '<td class="obs-mono">—</td>';
      }

      html += '</tr>';
    });

    // Total row
    var totalTokens = 0;
    var totalCost = 0;
    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      if (meta) {
        if (meta.tokenCount) totalTokens += meta.tokenCount;
        if (meta.estimatedCostUsd) totalCost += meta.estimatedCostUsd;
      }
    });

    html += '<tr class="obs-total-row">';
    html += '<td><strong>Total</strong></td>';
    html += '<td></td>';
    html += '<td class="obs-mono"><strong>' + formatDuration(cumulativeMs) + '</strong></td>';
    html += '<td class="obs-mono"><strong>' + (totalTokens > 0 ? totalTokens.toLocaleString() : '—') + '</strong></td>';
    html += '<td class="obs-mono"><strong>' + (totalCost > 0 ? '$' + totalCost.toFixed(4) : '—') + '</strong></td>';
    html += '</tr>';

    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  /**
   * Renders model selection decisions as a visual breakdown.
   */
  function renderModelSelections(metadata) {
    var modelCounts = {};

    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      if (meta && meta.modelId) {
        var name = formatModelId(meta.modelId);
        if (!modelCounts[name]) {
          modelCounts[name] = { count: 0, stages: [] };
        }
        modelCounts[name].count++;
        modelCounts[name].stages.push(stage);
      }
    });

    var modelNames = Object.keys(modelCounts);
    if (modelNames.length === 0) return '';

    var html = '<div class="obs-section">';
    html += '<h4 class="obs-section-title">Model Selection Decisions</h4>';
    html += '<div class="obs-model-grid">';

    modelNames.forEach(function (name) {
      var info = modelCounts[name];
      var percentage = Math.round((info.count / STAGES.length) * 100);

      html += '<div class="obs-model-card">';
      html += '<div class="obs-model-card-header">';
      html += '<span class="obs-model-badge obs-model-badge-lg">' + escapeHtml(name) + '</span>';
      html += '<span class="obs-model-count">' + info.count + '/' + STAGES.length + ' stages</span>';
      html += '</div>';
      html += '<div class="obs-model-bar">';
      html += '<div class="obs-model-bar-fill" style="width: ' + percentage + '%;"></div>';
      html += '</div>';
      html += '<div class="obs-model-stages">' + info.stages.map(escapeHtml).join(', ') + '</div>';
      html += '</div>';
    });

    html += '</div>';
    html += '</div>';
    return html;
  }

  /**
   * Renders cost breakdown per stage with a bar chart visualization.
   */
  function renderCostBreakdown(metadata) {
    var hasCostData = false;
    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      if (meta && (meta.tokenCount || meta.estimatedCostUsd)) {
        hasCostData = true;
      }
    });

    if (!hasCostData) return '';

    // Find max latency for bar scaling
    var maxLatency = 0;
    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      if (meta && meta.latencyMs && meta.latencyMs > maxLatency) {
        maxLatency = meta.latencyMs;
      }
    });

    var html = '<div class="obs-section">';
    html += '<h4 class="obs-section-title">Latency Breakdown</h4>';
    html += '<div class="obs-latency-bars">';

    STAGES.forEach(function (stage) {
      var meta = metadata[stage];
      var latency = (meta && meta.latencyMs) ? meta.latencyMs : 0;
      var percentage = maxLatency > 0 ? Math.round((latency / maxLatency) * 100) : 0;

      html += '<div class="obs-latency-row">';
      html += '<div class="obs-latency-label">' + escapeHtml(shortenStageName(stage)) + '</div>';
      html += '<div class="obs-latency-bar-wrapper">';
      html += '<div class="obs-latency-bar-bg">';
      html += '<div class="obs-latency-bar-fill" style="width: ' + percentage + '%;"></div>';
      html += '</div>';
      html += '<span class="obs-latency-value">' + formatDuration(latency) + '</span>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
    html += '</div>';
    return html;
  }

  // --- Utility Functions ---

  /**
   * Formats milliseconds into a human-readable duration string.
   */
  function formatDuration(ms) {
    if (!ms || ms === 0) return '0ms';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    var mins = Math.floor(ms / 60000);
    var secs = Math.round((ms % 60000) / 1000);
    return mins + 'm ' + secs + 's';
  }

  /**
   * Formats a model ID for compact display.
   */
  function formatModelId(modelId) {
    if (!modelId) return 'Unknown';
    var lower = modelId.toLowerCase();
    if (lower.indexOf('nova-lite') !== -1) return 'Nova Lite';
    if (lower.indexOf('nova-pro') !== -1) return 'Nova Pro';
    if (lower.indexOf('claude') !== -1 && lower.indexOf('sonnet') !== -1) return 'Claude Sonnet';
    // Fallback: extract last meaningful segment
    var segments = modelId.split(/[/:]/);
    return segments[segments.length - 2] || modelId;
  }

  /**
   * Shortens stage names for compact display in charts.
   */
  function shortenStageName(stage) {
    switch (stage) {
      case 'Triage': return 'Triage';
      case 'Diagnostic Research': return 'Diagnostic';
      case 'Parts & Logistics': return 'Parts';
      case 'Warranty Determination': return 'Warranty';
      case 'Summary': return 'Summary';
      default: return stage;
    }
  }

  /**
   * Escapes HTML special characters to prevent XSS.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Public API ---

  window.VSI_OBSERVABILITY = {
    /**
     * Renders the observability dashboard into the target element.
     * Should be called when the results section becomes visible.
     */
    render: function () {
      var container = document.getElementById('observability-content');
      if (container) {
        renderDashboard(container);
      }
    },

    /**
     * Clears the observability dashboard.
     */
    clear: function () {
      var container = document.getElementById('observability-content');
      if (container) {
        container.innerHTML = '';
      }
    }
  };
})();
