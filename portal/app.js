/**
 * Vehicle Service Intelligence - Portal Application
 *
 * Handles cascading model/year/trim dropdowns, intake form validation,
 * submission to HTTP API, and section transitions.
 */

(function () {
  'use strict';

  // --- Configuration ---
  const API_BASE_URL = window.VSI_CONFIG?.apiBaseUrl || '';

  // --- DOM References ---
  const intakeForm = document.getElementById('intake-form');
  const submitBtn = document.getElementById('submit-btn');
  const loadingIndicator = document.getElementById('loading-indicator');
  const submissionError = document.getElementById('submission-error');
  const intakeSection = document.getElementById('intake-section');
  const progressSection = document.getElementById('progress-section');
  const resultsSection = document.getElementById('results-section');
  const newSubmissionBtn = document.getElementById('new-submission-btn');

  const modelSelect = document.getElementById('vehicleModel');
  const yearSelect = document.getElementById('modelYear');
  const trimSelect = document.getElementById('vehicleTrim');

  // --- Cascading Dropdown Logic ---

  /**
   * Populates the model dropdown from NISSAN_VEHICLE_DATA.
   */
  function populateModels() {
    var data = window.NISSAN_VEHICLE_DATA || {};
    var models = Object.keys(data).sort();

    modelSelect.innerHTML = '<option value="">— Select Model —</option>';
    models.forEach(function (model) {
      var opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    });
  }

  /**
   * Populates the year dropdown based on selected model.
   */
  function populateYears(modelName) {
    yearSelect.innerHTML = '<option value="">— Select Year —</option>';
    trimSelect.innerHTML = '<option value="">— Select Trim —</option>';
    yearSelect.disabled = true;
    trimSelect.disabled = true;

    if (!modelName) return;

    var data = window.NISSAN_VEHICLE_DATA || {};
    var modelData = data[modelName];
    if (!modelData) return;

    var startYear = modelData.years[0];
    var endYear = modelData.years[1];

    // Populate years in descending order (newest first)
    for (var y = endYear; y >= startYear; y--) {
      var opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    }

    yearSelect.disabled = false;
  }

  /**
   * Populates the trim dropdown based on selected model and year.
   */
  function populateTrims(modelName, year) {
    trimSelect.innerHTML = '<option value="">— Select Trim —</option>';
    trimSelect.disabled = true;

    if (!modelName || !year) return;

    var data = window.NISSAN_VEHICLE_DATA || {};
    var modelData = data[modelName];
    if (!modelData || !modelData.trims) return;

    var yearNum = parseInt(year, 10);
    var trims = null;

    // Find the matching year range in the trims object
    var ranges = Object.keys(modelData.trims);
    for (var i = 0; i < ranges.length; i++) {
      var range = ranges[i];
      var parts = range.split('-');
      var rangeStart = parseInt(parts[0], 10);
      var rangeEnd = parts.length > 1 ? parseInt(parts[1], 10) : rangeStart;

      if (yearNum >= rangeStart && yearNum <= rangeEnd) {
        trims = modelData.trims[range];
        break;
      }
    }

    if (!trims || trims.length === 0) return;

    trims.forEach(function (trim) {
      var opt = document.createElement('option');
      opt.value = trim;
      opt.textContent = trim;
      trimSelect.appendChild(opt);
    });

    trimSelect.disabled = false;
  }

  // Event listeners for cascading
  modelSelect.addEventListener('change', function () {
    populateYears(this.value);
  });

  yearSelect.addEventListener('change', function () {
    populateTrims(modelSelect.value, this.value);
  });

  // Initialize models on page load
  populateModels();

  // --- Validation ---

  function validateForm() {
    let isValid = true;
    clearValidationErrors();

    var symptomDescription = document.getElementById('symptomDescription');

    // Vehicle Model - required
    if (!modelSelect.value) {
      showFieldError('vehicleModel', 'Please select a model');
      isValid = false;
    }

    // Model Year - required
    if (!yearSelect.value) {
      showFieldError('modelYear', 'Please select a year');
      isValid = false;
    }

    // Trim - required
    if (!trimSelect.value) {
      showFieldError('vehicleTrim', 'Please select a trim');
      isValid = false;
    }

    // Symptom Description - required, 1-2000 chars
    if (!symptomDescription.value.trim()) {
      showFieldError('symptomDescription', 'Symptom description is required');
      isValid = false;
    } else if (symptomDescription.value.trim().length > 2000) {
      showFieldError('symptomDescription', 'Must be 2000 characters or fewer');
      isValid = false;
    }

    return isValid;
  }

  function showFieldError(fieldId, message) {
    var errorEl = document.getElementById(fieldId + '-error');
    var inputEl = document.getElementById(fieldId);
    if (errorEl) errorEl.textContent = message;
    if (inputEl) inputEl.classList.add('invalid');
  }

  function clearValidationErrors() {
    document.querySelectorAll('.error-message').forEach(function (el) { el.textContent = ''; });
    document.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
  }

  // --- Form Submission ---

  function getFormPayload() {
    var model = modelSelect.value;
    var year = parseInt(yearSelect.value, 10);
    var trim = trimSelect.value;
    var symptomDescription = document.getElementById('symptomDescription').value.trim();

    // Combine model + trim for the vehicleModel field sent to the API
    var vehicleModel = model + ' ' + trim;

    var dtcSelect = document.getElementById('dtcCodes');
    var dtcCodes = Array.from(dtcSelect.selectedOptions).map(function (opt) { return opt.value; });

    var payload = {
      vehicleModel: vehicleModel,
      modelYear: year,
      symptomDescription: symptomDescription,
    };

    if (dtcCodes.length > 0) {
      payload.dtcCodes = dtcCodes;
    }

    return payload;
  }

  async function submitForm() {
    var payload = getFormPayload();

    showLoading(true);
    hideSubmissionError();
    submitBtn.disabled = true;

    try {
      var response = await fetch(API_BASE_URL + '/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        var errorData = await response.json().catch(function () {
          return { message: 'Submission failed. Please try again.' };
        });
        throw new Error(errorData.message || 'Submission failed with status ' + response.status);
      }

      var data = await response.json();
      handleSubmissionSuccess(data);
    } catch (error) {
      handleSubmissionError(error.message);
    }
  }

  function handleSubmissionSuccess(data) {
    showLoading(false);

    var formPayload = getFormPayload();

    window.VSI_SUBMISSION = {
      submissionId: data.submissionId,
      websocketUrl: data.websocketUrl,
      timestamp: data.timestamp,
      vehicleModel: formPayload.vehicleModel,
      modelYear: formPayload.modelYear,
      symptomDescription: formPayload.symptomDescription,
      dtcCodes: formPayload.dtcCodes,
    };

    intakeSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    if (typeof window.initWebSocket === 'function') {
      window.initWebSocket(data.submissionId, data.websocketUrl);
    }
  }

  function handleSubmissionError(message) {
    showLoading(false);
    submitBtn.disabled = false;
    showSubmissionError(message);
  }

  // --- UI Helpers ---

  function showLoading(show) {
    if (show) {
      loadingIndicator.classList.remove('hidden');
      submitBtn.classList.add('hidden');
    } else {
      loadingIndicator.classList.add('hidden');
      submitBtn.classList.remove('hidden');
    }
  }

  function showSubmissionError(message) {
    submissionError.textContent = message;
    submissionError.classList.remove('hidden');
  }

  function hideSubmissionError() {
    submissionError.textContent = '';
    submissionError.classList.add('hidden');
  }

  function resetPortal() {
    intakeForm.reset();
    clearValidationErrors();
    hideSubmissionError();
    submitBtn.disabled = false;

    // Reset cascading dropdowns
    yearSelect.innerHTML = '<option value="">— Select Year —</option>';
    yearSelect.disabled = true;
    trimSelect.innerHTML = '<option value="">— Select Trim —</option>';
    trimSelect.disabled = true;

    intakeSection.classList.remove('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');

    var stages = document.querySelectorAll('.stage');
    stages.forEach(function (stage) {
      stage.classList.remove('in-progress', 'completed', 'error');
      var statusEl = stage.querySelector('.stage-status');
      if (statusEl) statusEl.textContent = '';
    });

    var stageOutput = document.getElementById('stage-output');
    if (stageOutput) stageOutput.innerHTML = '';

    var reportContent = document.getElementById('report-content');
    if (reportContent) reportContent.innerHTML = '';

    window.VSI_SUBMISSION = null;
    if (window.VSI_WS) window.VSI_WS.reset();
    if (window.VSI_PROGRESS) window.VSI_PROGRESS.resetProgress();
    if (window.VSI_REPORT) window.VSI_REPORT.clearReport();
    if (window.VSI_OBSERVABILITY) window.VSI_OBSERVABILITY.clear();
  }

  // --- Results Tabs ---

  function initResultsTabs() {
    var tabs = document.querySelectorAll('.results-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchResultsTab(tab.getAttribute('data-tab'));
      });
    });
  }

  function switchResultsTab(targetId) {
    var tabs = document.querySelectorAll('.results-tab');
    var contents = document.querySelectorAll('.results-tab-content');

    tabs.forEach(function (t) { t.classList.remove('active'); });
    contents.forEach(function (c) { c.classList.add('hidden'); });

    var selectedTab = document.querySelector('.results-tab[data-tab="' + targetId + '"]');
    var selectedContent = document.getElementById(targetId);

    if (selectedTab) selectedTab.classList.add('active');
    if (selectedContent) selectedContent.classList.remove('hidden');

    if (targetId === 'observability-tab' && window.VSI_OBSERVABILITY) {
      window.VSI_OBSERVABILITY.render();
    }
  }

  initResultsTabs();

  // --- Event Listeners ---

  intakeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (validateForm()) submitForm();
  });

  if (newSubmissionBtn) {
    newSubmissionBtn.addEventListener('click', function () { resetPortal(); });
  }

  // --- Exports ---
  window.VSI_APP = {
    showProgressSection: function () {
      intakeSection.classList.add('hidden');
      progressSection.classList.remove('hidden');
    },
    showResultsSection: function () {
      progressSection.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      if (window.VSI_OBSERVABILITY) window.VSI_OBSERVABILITY.render();
    },
    showSubmissionError: showSubmissionError,
    resetPortal: resetPortal,
  };
})();
