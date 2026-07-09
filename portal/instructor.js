/**
 * Vehicle Service Intelligence - Instructor Controls
 *
 * Provides slider-based weight configuration for the Model Router.
 * Three sliders (cost, latency, quality) always sum to 100.
 * When one slider changes, the other two auto-adjust to maintain the invariant.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.8
 */

(function () {
  'use strict';

  // --- Configuration ---
  const API_BASE_URL = window.VSI_CONFIG?.apiBaseUrl || '';

  // --- Static model candidates (mirrored from src/shared/model-router.ts) ---
  const MODEL_CANDIDATES = [
    {
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      displayName: 'Claude Sonnet 3.5',
      description: 'Highest quality output',
      qualityScore: 98,
      latencyScore: 25,
      costScore: 10,
    },
    {
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      displayName: 'Claude Haiku 3.5',
      description: 'Fast and affordable',
      qualityScore: 72,
      latencyScore: 80,
      costScore: 65,
    },
    {
      modelId: 'amazon.nova-pro-v1:0',
      displayName: 'Amazon Nova Pro',
      description: 'Balanced cost/quality',
      qualityScore: 70,
      latencyScore: 55,
      costScore: 55,
    },
    {
      modelId: 'amazon.nova-lite-v1:0',
      displayName: 'Amazon Nova Lite',
      description: 'Low-cost, fast inference',
      qualityScore: 45,
      latencyScore: 85,
      costScore: 85,
    },
    {
      modelId: 'amazon.nova-micro-v1:0',
      displayName: 'Amazon Nova Micro',
      description: 'Lowest cost, fastest response',
      qualityScore: 25,
      latencyScore: 95,
      costScore: 95,
    },
  ];

  // --- DOM References ---
  const costSlider = document.getElementById('cost-slider');
  const latencySlider = document.getElementById('latency-slider');
  const qualitySlider = document.getElementById('quality-slider');
  const costValue = document.getElementById('cost-value');
  const latencyValue = document.getElementById('latency-value');
  const qualityValue = document.getElementById('quality-value');
  const weightsSumEl = document.getElementById('weights-sum');
  const saveBtn = document.getElementById('save-btn');
  const notification = document.getElementById('notification');
  const modelScoresContainer = document.getElementById('model-scores');

  // --- Slider Normalization ---

  /**
   * Normalizes slider values so they always sum to 100.
   * The moved slider retains its value; the other two adjust proportionally
   * to their current ratio. If both others are zero, they split evenly.
   *
   * @param {string} movedSlider - Which slider was moved ('cost', 'latency', or 'quality')
   * @param {number} movedValue - The new value of the moved slider (integer 0-100)
   * @returns {{ cost: number, latency: number, quality: number }}
   */
  function normalizeWeights(movedSlider, movedValue) {
    var remaining = 100 - movedValue;
    var currentCost = parseInt(costSlider.value, 10) || 0;
    var currentLatency = parseInt(latencySlider.value, 10) || 0;
    var currentQuality = parseInt(qualitySlider.value, 10) || 0;

    var result = { cost: currentCost, latency: currentLatency, quality: currentQuality };
    result[movedSlider] = movedValue;

    // Get the sum of the other two sliders' current values
    var otherKeys = ['cost', 'latency', 'quality'].filter(function (k) { return k !== movedSlider; });
    var otherSum = result[otherKeys[0]] + result[otherKeys[1]];

    if (otherSum === 0) {
      // Both others are zero — split evenly
      result[otherKeys[0]] = Math.floor(remaining / 2);
      result[otherKeys[1]] = remaining - Math.floor(remaining / 2);
    } else {
      // Distribute proportionally based on current ratio
      var ratio0 = result[otherKeys[0]] / otherSum;
      result[otherKeys[0]] = Math.round(remaining * ratio0);
      result[otherKeys[1]] = remaining - result[otherKeys[0]];
    }

    return result;
  }

  /**
   * Updates all slider positions, displayed values, and the scoring visualization.
   */
  function updateUI(weights) {
    costSlider.value = weights.cost;
    latencySlider.value = weights.latency;
    qualitySlider.value = weights.quality;

    costValue.textContent = weights.cost;
    latencyValue.textContent = weights.latency;
    qualityValue.textContent = weights.quality;

    var sum = weights.cost + weights.latency + weights.quality;
    weightsSumEl.textContent = sum;

    renderModelScores(weights);
  }

  // --- Model Scoring Visualization ---

  /**
   * Computes the weighted score for a model candidate.
   * Formula: (quality_weight × quality_score + latency_weight × latency_score + cost_weight × cost_score) / 100
   */
  function computeScore(candidate, weights) {
    return (
      weights.quality * candidate.qualityScore +
      weights.latency * candidate.latencyScore +
      weights.cost * candidate.costScore
    ) / 100;
  }

  /**
   * Renders the model scoring visualization showing which model wins and why.
   */
  function renderModelScores(weights) {
    // Score all candidates
    var scored = MODEL_CANDIDATES.map(function (candidate) {
      var score = computeScore(candidate, weights);
      return {
        modelId: candidate.modelId,
        displayName: candidate.displayName,
        description: candidate.description,
        costScore: candidate.costScore,
        latencyScore: candidate.latencyScore,
        qualityScore: candidate.qualityScore,
        totalScore: score,
      };
    });

    // Sort by score descending, then by costScore descending for tie-breaking
    scored.sort(function (a, b) {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return b.costScore - a.costScore;
    });

    // Build HTML
    var html = '';
    for (var i = 0; i < scored.length; i++) {
      var model = scored[i];
      var isWinner = i === 0;
      var cardClass = 'model-card' + (isWinner ? ' winner' : '');

      var breakdownParts = [
        '(' + weights.quality + ' × ' + model.qualityScore + ')',
        '(' + weights.latency + ' × ' + model.latencyScore + ')',
        '(' + weights.cost + ' × ' + model.costScore + ')',
      ];

      html += '<div class="' + cardClass + '">';
      html += '  <div class="model-card-rank">' + (i + 1) + '</div>';
      html += '  <div class="model-card-info">';
      html += '    <div class="model-card-name">' + model.displayName;
      if (isWinner) {
        html += '<span class="winner-badge">Selected</span>';
      }
      html += '    </div>';
      html += '    <div class="model-card-details">' + model.description + '</div>';
      html += '    <div class="score-breakdown">Q' + breakdownParts[0] + ' + L' + breakdownParts[1] + ' + C' + breakdownParts[2] + ' / 100</div>';
      html += '  </div>';
      html += '  <div class="model-card-score">' + model.totalScore.toFixed(2) + '</div>';
      html += '</div>';
    }

    modelScoresContainer.innerHTML = html;
  }

  // --- Slider Event Handlers ---

  function onSliderInput(movedSlider) {
    return function () {
      var movedValue = parseInt(this.value, 10);
      var weights = normalizeWeights(movedSlider, movedValue);
      updateUI(weights);
    };
  }

  costSlider.addEventListener('input', onSliderInput('cost'));
  latencySlider.addEventListener('input', onSliderInput('latency'));
  qualitySlider.addEventListener('input', onSliderInput('quality'));

  // --- Save Weights ---

  /**
   * Shows a notification message (success or error).
   */
  function showNotification(message, type) {
    notification.textContent = message;
    notification.className = 'notification ' + type;
  }

  /**
   * Hides the notification.
   */
  function hideNotification() {
    notification.className = 'notification hidden';
  }

  /**
   * Saves the current weights to the API.
   */
  async function saveWeights() {
    var payload = {
      cost_priority: parseInt(costSlider.value, 10),
      latency_priority: parseInt(latencySlider.value, 10),
      quality_priority: parseInt(qualitySlider.value, 10),
    };

    saveBtn.disabled = true;
    hideNotification();

    try {
      var response = await fetch(API_BASE_URL + '/config/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        var errorData = await response.json().catch(function () {
          return { message: 'Failed to save weights. Server returned status ' + response.status };
        });
        throw new Error(errorData.message || 'Failed to save weights');
      }

      var data = await response.json();
      var timestamp = data.timestamp || new Date().toISOString();
      showNotification('Weights saved successfully at ' + timestamp, 'success');
    } catch (error) {
      showNotification('Error: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', saveWeights);

  // --- Load Current Weights on Page Load ---

  /**
   * Fetches the current weights from the API and updates the UI.
   */
  async function loadCurrentWeights() {
    try {
      var response = await fetch(API_BASE_URL + '/config/weights', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        // Fall back to defaults
        return;
      }

      var data = await response.json();
      var weights = {
        cost: data.cost_priority != null ? data.cost_priority : 15,
        latency: data.latency_priority != null ? data.latency_priority : 15,
        quality: data.quality_priority != null ? data.quality_priority : 70,
      };

      updateUI(weights);
    } catch (e) {
      // Silently fall back to default slider values on network errors
      console.warn('Could not load current weights:', e.message);
    }
  }

  // --- Initialize ---
  // Render initial scoring with default values
  updateUI({
    cost: parseInt(costSlider.value, 10),
    latency: parseInt(latencySlider.value, 10),
    quality: parseInt(qualitySlider.value, 10),
  });

  // Attempt to load current weights from API
  loadCurrentWeights();

  // --- Export normalizeWeights for testing ---
  window.VSI_INSTRUCTOR = {
    normalizeWeights: normalizeWeights,
  };
})();
