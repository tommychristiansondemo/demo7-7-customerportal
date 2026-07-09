/**
 * Vehicle Service Intelligence - WebSocket Connection Management
 *
 * Manages WebSocket connection to the pipeline status API,
 * parses incoming status messages, updates the progress indicator,
 * and transitions to the results screen on pipeline completion.
 *
 * Requirements: 3.7, 4.1, 4.5, 4.6, 4.7, 4.8
 */

(function () {
  'use strict';

  // --- Constants ---
  var CONNECTION_TIMEOUT_MS = 10000;
  var HEARTBEAT_INTERVAL_MS = 30000; // Send ping every 30 seconds
  var STAGES = [
    'Triage',
    'Diagnostic Research',
    'Parts & Logistics',
    'Warranty Determination',
    'Summary'
  ];

  // --- State ---
  var ws = null;
  var connectionTimeoutId = null;
  var heartbeatIntervalId = null;
  var hasReconnected = false;
  var stageStatuses = {};
  var stageOutputs = {};
  var submissionId = null;
  var websocketUrl = null;

  // --- DOM Helpers ---

  function getStageElement(stageName) {
    return document.querySelector('.stage[data-stage="' + stageName + '"]');
  }

  function getStageOutputContainer() {
    return document.getElementById('stage-output');
  }

  function getReconnectionNotice() {
    var notice = document.getElementById('reconnection-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'reconnection-notice';
      notice.className = 'reconnection-notice hidden';
      var progressSection = document.getElementById('progress-section');
      if (progressSection) {
        progressSection.insertBefore(notice, progressSection.firstChild.nextSibling);
      }
    }
    return notice;
  }

  // --- Heartbeat / Ping ---

  /**
   * Starts heartbeat interval to keep the WebSocket connection alive.
   * Sends a ping message every HEARTBEAT_INTERVAL_MS.
   */
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatIntervalId = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
        } catch (e) {
          console.warn('[VSI WebSocket] Heartbeat ping failed:', e.message);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stops the heartbeat interval.
   */
  function stopHeartbeat() {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
  }

  // --- Progress Indicator Updates ---

  /**
   * Updates the visual state of a stage in the progress indicator.
   */
  function updateStageUI(stageName, status) {
    var stageEl = getStageElement(stageName);
    if (!stageEl) return;

    // Remove previous status classes
    stageEl.classList.remove('in-progress', 'completed', 'error');

    // Apply new status class
    if (status === 'in_progress') {
      stageEl.classList.add('in-progress');
    } else if (status === 'completed') {
      stageEl.classList.add('completed');
    } else if (status === 'error') {
      stageEl.classList.add('error');
    }

    // Update status text
    var statusEl = stageEl.querySelector('.stage-status');
    if (statusEl) {
      if (status === 'in_progress') {
        statusEl.textContent = 'Processing...';
      } else if (status === 'completed') {
        statusEl.textContent = 'Complete';
      } else if (status === 'error') {
        statusEl.textContent = 'Error';
      }
    }
  }

  /**
   * Appends an agent output summary to the stage output area.
   */
  function appendStageOutput(stageName, summary) {
    var container = getStageOutputContainer();
    if (!container || !summary) return;

    var p = document.createElement('p');
    p.innerHTML = '<strong>' + escapeHtml(stageName) + ':</strong> ' + escapeHtml(summary);
    container.appendChild(p);
  }

  /**
   * Displays an error for a specific stage in the output area.
   */
  function appendStageError(stageName, reason) {
    var container = getStageOutputContainer();
    if (!container) return;

    var p = document.createElement('p');
    p.style.color = 'var(--color-error)';
    p.innerHTML = '<strong>' + escapeHtml(stageName) + ' Error:</strong> ' + escapeHtml(reason || 'Unknown error');
    container.appendChild(p);
  }

  /**
   * Checks if all 5 stages have completed and transitions to results screen.
   */
  function checkPipelineCompletion() {
    var allCompleted = STAGES.every(function (stage) {
      return stageStatuses[stage] === 'completed';
    });

    if (allCompleted && window.VSI_APP) {
      // Short delay for visual feedback before transitioning
      setTimeout(function () {
        window.VSI_APP.showResultsSection();
      }, 800);
    }
  }

  // --- Message Dispatch ---

  /**
   * Handles a pipeline_status message (stage progress update).
   * Payload: { submissionId, stage, status, agentOutputSummary?, errorReason?, timestamp, metadata? }
   */
  function handlePipelineStatus(payload) {
    if (!payload.stage || !payload.status) {
      console.warn('[VSI WebSocket] pipeline_status missing required fields:', payload);
      return;
    }

    if (STAGES.indexOf(payload.stage) === -1) {
      console.warn('[VSI WebSocket] Unknown stage:', payload.stage);
      return;
    }

    // Track stage status
    stageStatuses[payload.stage] = payload.status;

    // Store agent output for results screen
    if (payload.agentOutputSummary) {
      stageOutputs[payload.stage] = payload.agentOutputSummary;
    }

    // Store metadata if present
    if (payload.metadata) {
      if (!window.VSI_METADATA) {
        window.VSI_METADATA = {};
      }
      window.VSI_METADATA[payload.stage] = payload.metadata;
    }

    // Delegate to progress.js for rich UI updates (if available)
    if (window.VSI_PROGRESS && typeof window.VSI_PROGRESS.handleProgressUpdate === 'function') {
      window.VSI_PROGRESS.handleProgressUpdate(payload);
    } else {
      // Fallback: basic UI update
      updateStageUI(payload.stage, payload.status);

      if (payload.status === 'completed' && payload.agentOutputSummary) {
        appendStageOutput(payload.stage, payload.agentOutputSummary);
      } else if (payload.status === 'error') {
        appendStageError(payload.stage, payload.errorReason);
      }

      // Check if pipeline is complete
      if (payload.status === 'completed') {
        checkPipelineCompletion();
      }
    }
  }

  /**
   * Handles a stage_result message (detailed stage output data).
   * Payload: { submissionId, stage, result }
   */
  function handleStageResult(payload) {
    if (!payload.stage || !payload.result) {
      console.warn('[VSI WebSocket] stage_result missing required fields:', payload);
      return;
    }

    // Store detailed result for the results screen
    if (!window.VSI_STAGE_RESULTS) {
      window.VSI_STAGE_RESULTS = {};
    }
    window.VSI_STAGE_RESULTS[payload.stage] = payload.result;
  }

  /**
   * Handles a final_report message (complete pipeline output).
   * Payload: { submissionId, report }
   */
  function handleFinalReport(payload) {
    if (!payload.report) {
      console.warn('[VSI WebSocket] final_report missing report data:', payload);
      return;
    }

    // Store the final report for display
    window.VSI_FINAL_REPORT = payload.report;

    // Mark all stages as completed if they aren't already
    STAGES.forEach(function (stage) {
      if (stageStatuses[stage] !== 'completed') {
        stageStatuses[stage] = 'completed';
        if (window.VSI_PROGRESS && typeof window.VSI_PROGRESS.handleProgressUpdate === 'function') {
          window.VSI_PROGRESS.handleProgressUpdate({ stage: stage, status: 'completed' });
        } else {
          updateStageUI(stage, 'completed');
        }
      }
    });

    // Transition to results
    if (window.VSI_APP) {
      setTimeout(function () {
        window.VSI_APP.showResultsSection();
      }, 400);
    }
  }

  /**
   * Handles an error message (pipeline-level error).
   * Payload: { submissionId, stage?, errorReason, timestamp }
   */
  function handleErrorMessage(payload) {
    var stage = payload.stage || 'Pipeline';
    var reason = payload.errorReason || payload.message || 'Unknown error';

    if (payload.stage && STAGES.indexOf(payload.stage) !== -1) {
      stageStatuses[payload.stage] = 'error';
      if (window.VSI_PROGRESS && typeof window.VSI_PROGRESS.handleProgressUpdate === 'function') {
        window.VSI_PROGRESS.handleProgressUpdate({ stage: payload.stage, status: 'error', errorReason: reason });
      } else {
        updateStageUI(payload.stage, 'error');
        appendStageError(stage, reason);
      }
    } else {
      appendStageError(stage, reason);
    }
  }

  // --- Main Message Handler ---

  /**
   * Parses and dispatches incoming WebSocket messages.
   *
   * Supports two formats:
   * 1. Envelope: { type: "PIPELINE_STATUS" | "STAGE_RESULT" | "FINAL_REPORT" | "ERROR" | "pong", payload: {...} }
   * 2. Flat (PipelineStatusMessage): { submissionId, stage, status, ... }
   */
  function handleMessage(event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.warn('[VSI WebSocket] Failed to parse message:', event.data);
      return;
    }

    // Handle pong responses to our heartbeat pings (no-op, just confirms connection alive)
    if (data.type === 'pong' || data.type === 'PONG') {
      return;
    }

    // Determine message type and payload
    var messageType;
    var payload;

    if (data.type && data.payload) {
      // Envelope format: { type, payload }
      messageType = data.type.toLowerCase().replace(/_/g, '_');
      payload = data.payload;
    } else if (data.stage && data.status) {
      // Flat format (PipelineStatusMessage directly)
      messageType = 'pipeline_status';
      payload = data;
    } else if (data.type && !data.payload) {
      // Envelope without explicit payload field — treat remaining fields as payload
      messageType = data.type.toLowerCase().replace(/_/g, '_');
      payload = data;
    } else {
      console.warn('[VSI WebSocket] Unrecognized message format:', data);
      return;
    }

    // Normalize type names (handle both PIPELINE_STATUS and pipeline_status formats)
    var normalizedType = messageType.toLowerCase();

    // Dispatch to appropriate handler
    switch (normalizedType) {
      case 'pipeline_status':
        handlePipelineStatus(payload);
        break;
      case 'stage_result':
        handleStageResult(payload);
        break;
      case 'final_report':
        handleFinalReport(payload);
        break;
      case 'error':
        handleErrorMessage(payload);
        break;
      default:
        console.warn('[VSI WebSocket] Unknown message type:', normalizedType, data);
    }
  }

  // --- WebSocket Connection ---

  /**
   * Establishes a WebSocket connection with the given URL and submissionId.
   */
  function connect(id, url) {
    submissionId = id;
    websocketUrl = url;

    // Build connection URL with submissionId query param
    var connectUrl = url;
    if (connectUrl.indexOf('submissionId') === -1) {
      if (connectUrl.indexOf('?') === -1) {
        connectUrl += '?submissionId=' + encodeURIComponent(id);
      } else {
        connectUrl += '&submissionId=' + encodeURIComponent(id);
      }
    }

    try {
      ws = new WebSocket(connectUrl);
    } catch (e) {
      handleConnectionError('Failed to create WebSocket connection');
      return;
    }

    // Set connection timeout (10 seconds per Requirement 3.7)
    connectionTimeoutId = setTimeout(function () {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        ws.close();
        handleConnectionError('WebSocket connection timed out after 10 seconds');
      }
    }, CONNECTION_TIMEOUT_MS);

    ws.onopen = function () {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
      hideReconnectionNotice();
      startHeartbeat();
      console.log('[VSI WebSocket] Connected for submission:', submissionId);
    };

    ws.onmessage = handleMessage;

    ws.onclose = function (event) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
      stopHeartbeat();

      // Check if pipeline is already complete — if so, no need to reconnect
      var allCompleted = STAGES.every(function (stage) {
        return stageStatuses[stage] === 'completed';
      });

      if (allCompleted) {
        console.log('[VSI WebSocket] Connection closed after pipeline completion');
        return;
      }

      // Check if we have any error stages
      var hasError = STAGES.some(function (stage) {
        return stageStatuses[stage] === 'error';
      });

      if (hasError) {
        console.log('[VSI WebSocket] Connection closed after pipeline error');
        return;
      }

      // Unexpected disconnect before completion — attempt one reconnection (Requirement 4.8)
      if (!hasReconnected) {
        hasReconnected = true;
        showReconnectionNotice('Connection lost. Attempting to reconnect...');
        console.log('[VSI WebSocket] Unexpected disconnect, attempting reconnection');
        setTimeout(function () {
          connect(submissionId, websocketUrl);
        }, 1000);
      } else {
        showReconnectionNotice('Connection lost. Unable to reconnect. Please refresh the page.');
        console.log('[VSI WebSocket] Reconnection failed, giving up');
      }
    };

    ws.onerror = function () {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
      console.error('[VSI WebSocket] Connection error');
    };
  }

  /**
   * Handles a connection error (timeout or failure to establish).
   */
  function handleConnectionError(message) {
    if (window.VSI_APP) {
      window.VSI_APP.showSubmissionError(message);
    }
  }

  /**
   * Shows the reconnection notification banner.
   */
  function showReconnectionNotice(message) {
    var notice = getReconnectionNotice();
    notice.textContent = message;
    notice.classList.remove('hidden');
  }

  /**
   * Hides the reconnection notification banner.
   */
  function hideReconnectionNotice() {
    var notice = document.getElementById('reconnection-notice');
    if (notice) {
      notice.classList.add('hidden');
    }
  }

  /**
   * Closes the WebSocket connection cleanly.
   */
  function disconnect() {
    stopHeartbeat();
    if (ws) {
      ws.onclose = null; // Prevent reconnection on intentional close
      ws.close();
      ws = null;
    }
    if (connectionTimeoutId) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }
  }

  /**
   * Resets WebSocket state for a new submission.
   */
  function reset() {
    disconnect();
    hasReconnected = false;
    stageStatuses = {};
    stageOutputs = {};
    submissionId = null;
    websocketUrl = null;
    window.VSI_METADATA = null;
    window.VSI_STAGE_RESULTS = null;
    window.VSI_FINAL_REPORT = null;
    hideReconnectionNotice();

    // Reset progress UI if progress.js is loaded
    if (window.VSI_PROGRESS && typeof window.VSI_PROGRESS.resetProgress === 'function') {
      window.VSI_PROGRESS.resetProgress();
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

  /**
   * Initializes WebSocket connection. Called by app.js after successful form submission.
   * @param {string} id - The submission ID
   * @param {string} url - The WebSocket URL
   */
  window.initWebSocket = function (id, url) {
    reset();
    connect(id, url);
  };

  /**
   * Expose WebSocket utilities for other modules.
   */
  window.VSI_WS = {
    connect: function (id, url) { reset(); connect(id, url); },
    disconnect: disconnect,
    reset: reset,
    getStageStatuses: function () { return Object.assign({}, stageStatuses); },
    getStageOutputs: function () { return Object.assign({}, stageOutputs); },
    isConnected: function () { return ws && ws.readyState === WebSocket.OPEN; }
  };
})();
