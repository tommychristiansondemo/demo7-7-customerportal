/**
 * Vehicle Service Intelligence - Live Pipeline Progress UI
 *
 * Handles real-time progress updates from WebSocket messages,
 * displaying pipeline stages with visual indicators, metadata,
 * elapsed timers, and agent output summaries.
 *
 * Requirements: 4.5, 4.6, 4.7, 4.8
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

  // --- State ---
  var stageTimers = {};       // { stageName: { startTime, intervalId } }
  var stageMetadata = {};     // { stageName: { modelId, latencyMs, tokenCount, estimatedCostUsd } }
  var stageSummaries = {};    // { stageName: summaryText }
  var completedCount = 0;

  // --- DOM Helpers ---

  function getStageElement(stageName) {
    return document.querySelector('.stage[data-stage="' + stageName + '"]');
  }

  function getStageOutputContainer() {
    return document.getElementById('stage-output');
  }

  // --- Elapsed Timer ---

  /**
   * Starts an elapsed timer for a stage, updating the UI every second.
   */
  function startElapsedTimer(stageName) {
    stopElapsedTimer(stageName);

    var startTime = Date.now();
    stageTimers[stageName] = {
      startTime: startTime,
      intervalId: setInterval(function () {
        updateElapsedDisplay(stageName, startTime);
      }, 1000)
    };

    // Show initial 0s
    updateElapsedDisplay(stageName, startTime);
  }

  /**
   * Stops the elapsed timer for a stage.
   */
  function stopElapsedTimer(stageName) {
    if (stageTimers[stageName]) {
      clearInterval(stageTimers[stageName].intervalId);
      delete stageTimers[stageName];
    }
  }

  /**
   * Stops all running elapsed timers.
   */
  function stopAllTimers() {
    Object.keys(stageTimers).forEach(function (stage) {
      stopElapsedTimer(stage);
    });
  }

  /**
   * Updates the elapsed time display for a stage.
   */
  function updateElapsedDisplay(stageName, startTime) {
    var stageEl = getStageElement(stageName);
    if (!stageEl) return;

    var elapsedEl = stageEl.querySelector('.stage-elapsed');
    if (!elapsedEl) return;

    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    elapsedEl.textContent = formatElapsed(elapsed);
  }

  /**
   * Formats elapsed seconds into a human-readable string.
   */
  function formatElapsed(seconds) {
    if (seconds < 60) {
      return seconds + 's';
    }
    var mins = Math.floor(seconds / 60);
    var secs = seconds % 60;
    return mins + 'm ' + secs + 's';
  }

  // --- Stage UI Updates ---

  /**
   * Updates a stage to "in_progress" state with animation and elapsed timer.
   */
  function setStageInProgress(stageName) {
    var stageEl = getStageElement(stageName);
    if (!stageEl) return;

    // Remove previous status classes
    stageEl.classList.remove('pending', 'completed', 'error');
    stageEl.classList.add('in-progress');

    // Update icon to spinner
    var iconEl = stageEl.querySelector('.stage-icon');
    if (iconEl) {
      iconEl.innerHTML = '<span class="icon-spinner"></span>';
    }

    // Update status text
    var statusEl = stageEl.querySelector('.stage-status');
    if (statusEl) {
      statusEl.textContent = 'Processing...';
    }

    // Show elapsed timer
    var elapsedEl = stageEl.querySelector('.stage-elapsed');
    if (elapsedEl) {
      elapsedEl.classList.remove('hidden');
    }

    // Clear metadata display for this stage (in case of retry)
    var metaEl = stageEl.querySelector('.stage-meta');
    if (metaEl) {
      metaEl.innerHTML = '';
      metaEl.classList.add('hidden');
    }

    // Start the elapsed timer
    startElapsedTimer(stageName);
  }

  /**
   * Updates a stage to "completed" state with checkmark and output summary.
   */
  function setStageCompleted(stageName, summary, metadata) {
    var stageEl = getStageElement(stageName);
    if (!stageEl) return;

    // Stop elapsed timer
    stopElapsedTimer(stageName);

    // Remove previous status classes
    stageEl.classList.remove('pending', 'in-progress', 'error');
    stageEl.classList.add('completed');

    // Update icon to checkmark
    var iconEl = stageEl.querySelector('.stage-icon');
    if (iconEl) {
      iconEl.innerHTML = '<span class="icon-check">&#10003;</span>';
    }

    // Update status text
    var statusEl = stageEl.querySelector('.stage-status');
    if (statusEl) {
      statusEl.textContent = 'Complete';
    }

    // Hide elapsed timer, show final time if metadata has latency
    var elapsedEl = stageEl.querySelector('.stage-elapsed');
    if (elapsedEl) {
      if (metadata && metadata.latencyMs) {
        elapsedEl.textContent = formatLatency(metadata.latencyMs);
      } else {
        elapsedEl.classList.add('hidden');
      }
    }

    // Show metadata (model ID + latency)
    if (metadata) {
      stageMetadata[stageName] = metadata;
      displayStageMetadata(stageEl, metadata);
    }

    // Show agent output summary
    if (summary) {
      stageSummaries[stageName] = summary;
      appendOutputSummary(stageName, summary);
    }

    completedCount++;
  }

  /**
   * Updates a stage to "error" state with X icon and error reason.
   */
  function setStageError(stageName, errorReason) {
    var stageEl = getStageElement(stageName);
    if (!stageEl) return;

    // Stop elapsed timer
    stopElapsedTimer(stageName);

    // Remove previous status classes
    stageEl.classList.remove('pending', 'in-progress', 'completed');
    stageEl.classList.add('error');

    // Update icon to X
    var iconEl = stageEl.querySelector('.stage-icon');
    if (iconEl) {
      iconEl.innerHTML = '<span class="icon-error">&#10007;</span>';
    }

    // Update status text
    var statusEl = stageEl.querySelector('.stage-status');
    if (statusEl) {
      statusEl.textContent = 'Error';
    }

    // Hide elapsed timer
    var elapsedEl = stageEl.querySelector('.stage-elapsed');
    if (elapsedEl) {
      elapsedEl.classList.add('hidden');
    }

    // Show error in output
    appendOutputError(stageName, errorReason);
  }

  // --- Metadata Display ---

  /**
   * Displays model ID and latency metadata beneath a stage.
   */
  function displayStageMetadata(stageEl, metadata) {
    var metaEl = stageEl.querySelector('.stage-meta');
    if (!metaEl) return;

    var parts = [];

    if (metadata.modelId) {
      parts.push('<span class="meta-model" title="Model ID">' + escapeHtml(formatModelId(metadata.modelId)) + '</span>');
    }

    if (metadata.latencyMs) {
      parts.push('<span class="meta-latency" title="Latency">' + formatLatency(metadata.latencyMs) + '</span>');
    }

    if (parts.length > 0) {
      metaEl.innerHTML = parts.join(' &middot; ');
      metaEl.classList.remove('hidden');
    }
  }

  /**
   * Formats a model ID for display (shortens long IDs).
   */
  function formatModelId(modelId) {
    if (!modelId) return '';
    // Extract the model name from full ARN or ID
    // e.g. "amazon.nova-lite-v1:0" -> "Nova Lite"
    // e.g. "anthropic.claude-3-5-sonnet-20241022-v2:0" -> "Claude Sonnet"
    var lower = modelId.toLowerCase();
    if (lower.indexOf('nova-lite') !== -1) return 'Nova Lite';
    if (lower.indexOf('nova-pro') !== -1) return 'Nova Pro';
    if (lower.indexOf('claude') !== -1 && lower.indexOf('sonnet') !== -1) return 'Claude Sonnet';
    // Fallback: return last segment
    var segments = modelId.split('/');
    return segments[segments.length - 1];
  }

  /**
   * Formats latency in milliseconds to a readable string.
   */
  function formatLatency(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  // --- Output Summaries ---

  /**
   * Appends an agent output summary to the stage output area.
   */
  function appendOutputSummary(stageName, summary) {
    var container = getStageOutputContainer();
    if (!container || !summary) return;

    var entry = document.createElement('div');
    entry.className = 'output-entry output-entry-success';
    entry.innerHTML =
      '<div class="output-entry-header">' +
        '<span class="output-entry-icon">&#10003;</span>' +
        '<strong>' + escapeHtml(stageName) + '</strong>' +
      '</div>' +
      '<div class="output-entry-body">' + escapeHtml(summary) + '</div>';

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Appends an error entry to the stage output area.
   */
  function appendOutputError(stageName, reason) {
    var container = getStageOutputContainer();
    if (!container) return;

    var entry = document.createElement('div');
    entry.className = 'output-entry output-entry-error';
    entry.innerHTML =
      '<div class="output-entry-header">' +
        '<span class="output-entry-icon">&#10007;</span>' +
        '<strong>' + escapeHtml(stageName) + ' — Error</strong>' +
      '</div>' +
      '<div class="output-entry-body">' + escapeHtml(reason || 'Unknown error occurred') + '</div>';

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  // --- Pipeline Completion Check ---

  /**
   * Checks if all 5 stages are completed and transitions to results view.
   */
  function checkCompletion() {
    if (completedCount >= STAGES.length) {
      stopAllTimers();
      // Allow user to see final state briefly before transition
      setTimeout(function () {
        if (window.VSI_APP) {
          window.VSI_APP.showResultsSection();
        }
      }, 1000);
    }
  }

  // --- Message Handler (called from websocket.js) ---

  /**
   * Processes a pipeline status message and updates the progress UI.
   * @param {object} payload - The parsed WebSocket message payload
   */
  function handleProgressUpdate(payload) {
    if (!payload || !payload.stage || !payload.status) return;
    if (STAGES.indexOf(payload.stage) === -1) return;

    switch (payload.status) {
      case 'in_progress':
        setStageInProgress(payload.stage);
        break;

      case 'completed':
        setStageCompleted(payload.stage, payload.agentOutputSummary, payload.metadata);
        checkCompletion();
        break;

      case 'error':
        setStageError(payload.stage, payload.errorReason);
        break;
    }
  }

  // --- Reset ---

  /**
   * Resets the progress UI to its initial state.
   */
  function resetProgress() {
    stopAllTimers();
    stageMetadata = {};
    stageSummaries = {};
    completedCount = 0;

    // Reset all stage elements
    STAGES.forEach(function (stageName, index) {
      var stageEl = getStageElement(stageName);
      if (!stageEl) return;

      stageEl.classList.remove('in-progress', 'completed', 'error');
      stageEl.classList.add('pending');

      // Reset icon to stage number
      var iconEl = stageEl.querySelector('.stage-icon');
      if (iconEl) {
        iconEl.innerHTML = String(index + 1);
      }

      // Reset status text
      var statusEl = stageEl.querySelector('.stage-status');
      if (statusEl) {
        statusEl.textContent = '';
      }

      // Hide elapsed timer
      var elapsedEl = stageEl.querySelector('.stage-elapsed');
      if (elapsedEl) {
        elapsedEl.textContent = '';
        elapsedEl.classList.add('hidden');
      }

      // Hide metadata
      var metaEl = stageEl.querySelector('.stage-meta');
      if (metaEl) {
        metaEl.innerHTML = '';
        metaEl.classList.add('hidden');
      }
    });

    // Clear output container
    var outputContainer = getStageOutputContainer();
    if (outputContainer) {
      outputContainer.innerHTML = '';
    }
  }

  // --- Utility ---

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

  window.VSI_PROGRESS = {
    handleProgressUpdate: handleProgressUpdate,
    resetProgress: resetProgress,
    getStageMetadata: function () { return Object.assign({}, stageMetadata); },
    getStageSummaries: function () { return Object.assign({}, stageSummaries); }
  };
})();
