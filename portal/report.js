/**
 * Vehicle Service Intelligence - Final Diagnostic Report Rendering
 *
 * Renders the final diagnostic report in the portal after pipeline completion.
 * Displays: Triage Classification, Relevant TSBs, Parts Availability,
 * Warranty Status, and Technician Narrative.
 *
 * Data sources:
 * - window.VSI_FINAL_REPORT (final_report message)
 * - window.VSI_STAGE_RESULTS (per-stage result data)
 * - window.VSI_SUBMISSION (original submission info)
 *
 * Requirements: 13.1, 13.3, 13.4
 */

(function () {
  'use strict';

  // --- DOM References ---

  function getReportContainer() {
    return document.getElementById('report-content');
  }

  // --- Utility ---

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Resolves report data from available sources.
   * Prefers VSI_FINAL_REPORT, falls back to VSI_STAGE_RESULTS.
   */
  function resolveReportData() {
    var report = window.VSI_FINAL_REPORT || {};
    var stageResults = window.VSI_STAGE_RESULTS || {};
    var submission = window.VSI_SUBMISSION || {};

    return {
      vehicleInfo: report.vehicleInfo || {
        model: submission.vehicleModel || '',
        year: submission.modelYear || '',
        telematicsId: submission.telematicsId || ''
      },
      triage: report.triage || stageResults['Triage'] || null,
      diagnosticResearch: report.diagnosticResearch || stageResults['Diagnostic Research'] || null,
      partsLogistics: report.partsLogistics || stageResults['Parts & Logistics'] || null,
      warranty: report.warranty || stageResults['Warranty Determination'] || null,
      technicianNarrative: report.technicianNarrative || stageResults['Summary'] || null
    };
  }

  // --- Section Renderers ---

  /**
   * Renders the Vehicle Information section header.
   */
  function renderVehicleInfo(data) {
    var info = data.vehicleInfo;
    if (!info || (!info.model && !info.year && !info.telematicsId)) {
      return '';
    }

    var html = '<div class="report-section">';
    html += '<h3>Vehicle Information</h3>';
    html += '<ul>';
    if (info.model) {
      html += '<li><strong>Model:</strong> ' + escapeHtml(info.model) + '</li>';
    }
    if (info.year) {
      html += '<li><strong>Year:</strong> ' + escapeHtml(String(info.year)) + '</li>';
    }
    if (info.telematicsId) {
      html += '<li><strong>Telematics ID:</strong> ' + escapeHtml(info.telematicsId) + '</li>';
    }
    html += '</ul>';
    html += '</div>';
    return html;
  }

  /**
   * Renders the Triage Classification section.
   */
  function renderTriageClassification(data) {
    var triage = data.triage;

    var html = '<div class="report-section">';
    html += '<h3>Triage Classification</h3>';

    if (!triage) {
      html += '<p class="placeholder">No data returned by Intake Triage Agent</p>';
      html += '</div>';
      return html;
    }

    // Handle both object format and string format
    if (typeof triage === 'string') {
      html += '<p>' + escapeHtml(triage) + '</p>';
      html += '</div>';
      return html;
    }

    html += '<ul>';
    if (triage.vehicleSystem) {
      html += '<li><strong>Vehicle System:</strong> ' + escapeHtml(formatSystemName(triage.vehicleSystem)) + '</li>';
    }
    if (triage.severity) {
      html += '<li><strong>Severity:</strong> ' + renderSeverityBadge(triage.severity) + '</li>';
    }
    if (triage.dtcCodes && triage.dtcCodes.length > 0) {
      html += '<li><strong>DTC Codes:</strong> ' + triage.dtcCodes.map(escapeHtml).join(', ') + '</li>';
    }
    if (triage.classificationReasoning) {
      html += '<li><strong>Reasoning:</strong> ' + escapeHtml(triage.classificationReasoning) + '</li>';
    }
    html += '</ul>';
    html += '</div>';
    return html;
  }

  /**
   * Renders the Relevant TSBs section.
   */
  function renderTSBs(data) {
    var research = data.diagnosticResearch;

    var html = '<div class="report-section">';
    html += '<h3>Relevant Technical Service Bulletins</h3>';

    if (!research) {
      html += '<p class="placeholder">No data returned by Diagnostic Research Agent</p>';
      html += '</div>';
      return html;
    }

    // Handle string format
    if (typeof research === 'string') {
      html += '<p>' + escapeHtml(research) + '</p>';
      html += '</div>';
      return html;
    }

    var excerpts = research.excerpts || research.results || [];

    if (excerpts.length === 0) {
      html += '<p class="placeholder">No relevant TSBs found for this vehicle and symptom</p>';
      html += '</div>';
      return html;
    }

    // Show top 3 excerpts
    var displayExcerpts = excerpts.slice(0, 3);

    displayExcerpts.forEach(function (item, index) {
      html += '<div class="tsb-entry">';
      html += '<h4>' + escapeHtml(item.title || item.tsbNumber || ('TSB #' + (index + 1))) + '</h4>';
      if (item.tsbNumber && item.title) {
        html += '<p class="tsb-number">' + escapeHtml(item.tsbNumber) + '</p>';
      }
      if (item.excerpt || item.text || item.content) {
        html += '<p class="tsb-excerpt">' + escapeHtml(item.excerpt || item.text || item.content) + '</p>';
      }
      if (item.relevanceScore !== undefined) {
        html += '<p class="tsb-score">Relevance: ' + (item.relevanceScore * 100).toFixed(0) + '%</p>';
      }
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  /**
   * Renders the Parts Availability section as a styled table.
   */
  function renderPartsAvailability(data) {
    var partsData = data.partsLogistics;

    var html = '<div class="report-section">';
    html += '<h3>Parts Availability</h3>';

    if (!partsData) {
      html += '<p class="placeholder">No data returned by Parts Logistics Agent</p>';
      html += '</div>';
      return html;
    }

    // Handle string format
    if (typeof partsData === 'string') {
      html += '<p>' + escapeHtml(partsData) + '</p>';
      html += '</div>';
      return html;
    }

    var parts = partsData.parts || partsData.results || [];

    if (!Array.isArray(parts) || parts.length === 0) {
      html += '<p class="placeholder">No parts data available</p>';
      html += '</div>';
      return html;
    }

    html += '<table class="report-table">';
    html += '<thead><tr>';
    html += '<th>Part Number</th>';
    html += '<th>Status</th>';
    html += '<th>Lead Time</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    parts.forEach(function (part) {
      var partNumber = part.partNumber || part.part_number || 'Unknown';
      var status = part.availabilityStatus || part.availability_status || 'unknown';
      var leadTime = part.estimatedLeadTimeDays || part.estimated_lead_time_days;

      html += '<tr>';
      html += '<td>' + escapeHtml(partNumber) + '</td>';
      html += '<td>' + renderStatusBadge(status) + '</td>';
      html += '<td>' + formatLeadTime(leadTime, status) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  /**
   * Renders the Warranty Status section.
   */
  function renderWarrantyStatus(data) {
    var warranty = data.warranty;

    var html = '<div class="report-section">';
    html += '<h3>Warranty Status</h3>';

    if (!warranty) {
      html += '<p class="placeholder">No data returned by Warranty Determination Agent</p>';
      html += '</div>';
      return html;
    }

    // Handle string format
    if (typeof warranty === 'string') {
      html += '<p>' + escapeHtml(warranty) + '</p>';
      html += '</div>';
      return html;
    }

    html += '<ul>';

    if (warranty.warrantyStatus || warranty.warranty_status) {
      var status = warranty.warrantyStatus || warranty.warranty_status;
      html += '<li><strong>Status:</strong> ' + renderWarrantyBadge(status) + '</li>';
    }

    if (warranty.applicableWarrantyType || warranty.applicable_warranty_type) {
      var type = warranty.applicableWarrantyType || warranty.applicable_warranty_type;
      html += '<li><strong>Warranty Type:</strong> ' + escapeHtml(formatWarrantyType(type)) + '</li>';
    }

    if (warranty.coverageDetails || warranty.coverage_details) {
      var details = warranty.coverageDetails || warranty.coverage_details;
      html += '<li><strong>Coverage Details:</strong> ' + escapeHtml(details) + '</li>';
    }

    if (warranty.syntheticMileage !== undefined || warranty.synthetic_mileage !== undefined) {
      var mileage = warranty.syntheticMileage || warranty.synthetic_mileage;
      html += '<li><strong>Mileage (Synthetic):</strong> ' + Number(mileage).toLocaleString() + ' mi</li>';
    }

    html += '</ul>';
    html += '</div>';
    return html;
  }

  /**
   * Renders the Technician Narrative section.
   */
  function renderTechnicianNarrative(data) {
    var narrative = data.technicianNarrative;

    var html = '<div class="report-section">';
    html += '<h3>Technician Narrative</h3>';

    if (!narrative) {
      html += '<p class="placeholder">No data returned by Summary Orchestrator Agent</p>';
      html += '</div>';
      return html;
    }

    // Handle object format (may have narrative field)
    if (typeof narrative === 'object' && narrative.narrative) {
      narrative = narrative.narrative;
    } else if (typeof narrative === 'object' && narrative.technicianNarrative) {
      narrative = narrative.technicianNarrative;
    } else if (typeof narrative === 'object') {
      // Try to extract text from common fields
      narrative = narrative.text || narrative.summary || narrative.content || JSON.stringify(narrative);
    }

    // Render as paragraphs (split by double newlines)
    var paragraphs = String(narrative).split(/\n\n+/);
    paragraphs.forEach(function (para) {
      if (para.trim()) {
        html += '<p>' + escapeHtml(para.trim()).replace(/\n/g, '<br>') + '</p>';
      }
    });

    html += '</div>';
    return html;
  }

  // --- Badge / Format Helpers ---

  /**
   * Renders a status badge for parts availability.
   */
  function renderStatusBadge(status) {
    var normalized = String(status).toLowerCase().replace(/_/g, '-');
    var label = formatStatusLabel(status);
    return '<span class="status-badge ' + escapeHtml(normalized) + '">' + escapeHtml(label) + '</span>';
  }

  /**
   * Renders a severity badge.
   */
  function renderSeverityBadge(severity) {
    var cls = 'severity-' + String(severity).toLowerCase();
    return '<span class="status-badge ' + escapeHtml(cls) + '">' + escapeHtml(capitalize(severity)) + '</span>';
  }

  /**
   * Renders a warranty status badge.
   */
  function renderWarrantyBadge(status) {
    var map = {
      'covered': 'in-stock',
      'partially_covered': 'backordered',
      'not_covered': 'discontinued'
    };
    var badgeClass = map[status] || 'not-found';
    var label = formatWarrantyStatus(status);
    return '<span class="status-badge ' + escapeHtml(badgeClass) + '">' + escapeHtml(label) + '</span>';
  }

  /**
   * Formats lead time for display.
   */
  function formatLeadTime(days, status) {
    if (status === 'not_found' || status === 'not-found') {
      return '<span class="text-muted">N/A</span>';
    }
    if (status === 'discontinued') {
      return '<span class="text-muted">N/A</span>';
    }
    if (days === undefined || days === null) {
      return '<span class="text-muted">Unknown</span>';
    }
    if (days === 0) {
      return 'Immediate';
    }
    return days + ' day' + (days === 1 ? '' : 's');
  }

  /**
   * Formats availability status label for display.
   */
  function formatStatusLabel(status) {
    var labels = {
      'in_stock': 'In Stock',
      'in-stock': 'In Stock',
      'backordered': 'Backordered',
      'discontinued': 'Discontinued',
      'not_found': 'Not Found',
      'not-found': 'Not Found'
    };
    return labels[String(status).toLowerCase()] || capitalize(status);
  }

  /**
   * Formats vehicle system name for display.
   */
  function formatSystemName(system) {
    var names = {
      'powertrain': 'Powertrain',
      'ev_battery': 'EV Battery',
      'adas': 'ADAS (Advanced Driver Assistance)',
      'infotainment': 'Infotainment',
      'other': 'Other'
    };
    return names[String(system).toLowerCase()] || capitalize(system);
  }

  /**
   * Formats warranty type for display.
   */
  function formatWarrantyType(type) {
    var types = {
      'new_vehicle_limited': 'New Vehicle Limited Warranty',
      'powertrain': 'Powertrain Warranty',
      'none': 'None'
    };
    return types[String(type).toLowerCase()] || capitalize(type);
  }

  /**
   * Formats warranty status for display.
   */
  function formatWarrantyStatus(status) {
    var statuses = {
      'covered': 'Covered',
      'partially_covered': 'Partially Covered',
      'not_covered': 'Not Covered'
    };
    return statuses[String(status).toLowerCase()] || capitalize(status);
  }

  /**
   * Capitalizes first letter of each word.
   */
  function capitalize(str) {
    if (!str) return '';
    return String(str)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // --- Main Render Function ---

  /**
   * Renders the full diagnostic report into the #report-content container.
   * Called when transitioning to the results section.
   */
  function renderReport() {
    var container = getReportContainer();
    if (!container) return;

    var data = resolveReportData();

    var html = '';
    html += renderVehicleInfo(data);
    html += renderTriageClassification(data);
    html += renderTSBs(data);
    html += renderPartsAvailability(data);
    html += renderWarrantyStatus(data);
    html += renderTechnicianNarrative(data);

    container.innerHTML = html;
  }

  /**
   * Clears the report content.
   */
  function clearReport() {
    var container = getReportContainer();
    if (container) {
      container.innerHTML = '';
    }
  }

  // --- Auto-render on section transition ---

  /**
   * Observes when #results-section becomes visible and triggers report rendering.
   * Uses MutationObserver to detect class changes.
   */
  function setupAutoRender() {
    var resultsSection = document.getElementById('results-section');
    if (!resultsSection) return;

    // Intercept the showResultsSection call to render the report
    var originalShowResults = window.VSI_APP && window.VSI_APP.showResultsSection;

    if (window.VSI_APP) {
      window.VSI_APP.showResultsSection = function () {
        // Call original transition logic
        if (originalShowResults) {
          originalShowResults();
        } else {
          var progressSection = document.getElementById('progress-section');
          if (progressSection) progressSection.classList.add('hidden');
          resultsSection.classList.remove('hidden');
        }
        // Render the report
        renderReport();
      };
    }
  }

  // --- Initialize ---

  // Set up auto-render when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAutoRender);
  } else {
    setupAutoRender();
  }

  // --- Public API ---

  window.VSI_REPORT = {
    renderReport: renderReport,
    clearReport: clearReport
  };
})();
