/**
 * VSI Demo Mode — Simulates pipeline execution when no real backend pipeline is available.
 *
 * Activates automatically when the WebSocket connection fails or when
 * window.VSI_DEMO_MODE is set to true. Produces realistic staged output
 * with delays to demonstrate the progress UI and report rendering.
 */

(function () {
  'use strict';

  var DEMO_STAGES = [
    {
      stage: 'Triage',
      delayMs: 2000,
      output: function (submission) {
        return JSON.stringify({
          vehicleSystem: 'other',
          severity: 'low',
          dtcCodes: submission.dtcCodes || [],
          classificationReasoning: 'Brake squeak on humid mornings is typically a surface-level issue caused by moisture accumulation on rotor surfaces overnight. Classified as low severity — common wear pattern, no safety concern unless accompanied by grinding or reduced stopping power.'
        });
      },
      metadata: { modelId: 'amazon.nova-micro-v1:0', latencyMs: 1850 }
    },
    {
      stage: 'Diagnostic Research',
      delayMs: 3500,
      output: function () {
        return JSON.stringify({
          excerpts: [
            {
              title: 'TSB-DEMO-014: Front Suspension and Brake Noise',
              content: 'Owners report noise from front brakes during first application after overnight parking. Root cause: stabilizer bar end link ball joints and brake rotor surface oxidation in humid environments.',
              relevanceScore: 0.87
            },
            {
              title: 'TSB-DEMO-008: Brake Pad Material Specification Update',
              content: 'Revised brake pad compound (semi-metallic to ceramic) reduces morning squeak in high-humidity climates. Applicable to vehicles with >30,000 miles on original pads.',
              relevanceScore: 0.79
            }
          ],
          resultCount: 2
        });
      },
      metadata: { modelId: 'amazon.nova-pro-v1:0', latencyMs: 3200 }
    },
    {
      stage: 'Parts & Logistics',
      delayMs: 2500,
      output: function () {
        return JSON.stringify({
          parts: [
            { part_number: 'NIS-BRK-PAD-001', availability_status: 'in_stock', estimated_lead_time_days: 0 },
            { part_number: 'NIS-BRK-ROT-001', availability_status: 'in_stock', estimated_lead_time_days: 2 },
            { part_number: 'NIS-BRK-KIT-001', availability_status: 'backordered', estimated_lead_time_days: 7 }
          ]
        });
      },
      metadata: { modelId: 'amazon.nova-lite-v1:0', latencyMs: 2100 }
    },
    {
      stage: 'Warranty Determination',
      delayMs: 1500,
      output: function (submission) {
        var year = submission.modelYear || 2013;
        var currentYear = new Date().getFullYear();
        var age = currentYear - year;
        if (age > 5) {
          return JSON.stringify({
            warrantyStatus: 'not_covered',
            applicableWarrantyType: 'none',
            coverageDetails: 'Vehicle is ' + age + ' years old and exceeds both the 3-year/36,000-mile basic warranty and 5-year/60,000-mile powertrain warranty limits.',
            syntheticMileage: 95000 + Math.floor(age * 3000)
          });
        }
        return JSON.stringify({
          warrantyStatus: 'covered',
          applicableWarrantyType: 'new_vehicle_limited',
          coverageDetails: 'Vehicle is within warranty coverage period.',
          syntheticMileage: 25000
        });
      },
      metadata: { modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0', latencyMs: 1200 }
    },
    {
      stage: 'Summary',
      delayMs: 4000,
      output: function (submission) {
        var model = submission.vehicleModel || 'Vehicle';
        var year = submission.modelYear || 2013;
        return 'Diagnostic Summary for ' + year + ' Nissan ' + model + ':\n\n' +
          'The reported brake squeak on humid mornings is a common condition caused by light surface oxidation (rust) forming on brake rotor surfaces during overnight parking in humid conditions. ' +
          'This is not indicative of a brake system failure and does not affect stopping performance.\n\n' +
          'Recommended actions:\n' +
          '1. Inspect brake pads for remaining thickness (minimum 3mm)\n' +
          '2. Check rotors for scoring or uneven wear patterns\n' +
          '3. If pads are below 5mm, consider replacement with ceramic compound pads (NIS-BRK-PAD-001) which are more resistant to moisture-induced noise\n' +
          '4. Apply anti-squeal compound (disc brake quiet) to pad backing plates during next brake service\n\n' +
          'This is considered normal brake behavior and is not covered under warranty for vehicles outside the basic coverage period.';
      },
      metadata: { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0', latencyMs: 3800 }
    }
  ];

  /**
   * Runs the simulated pipeline, publishing status messages to the progress UI.
   */
  function runDemoPipeline(submission) {
    var stageIndex = 0;

    function runNextStage() {
      if (stageIndex >= DEMO_STAGES.length) return;

      var stageDef = DEMO_STAGES[stageIndex];
      stageIndex++;

      // Publish in_progress
      if (window.VSI_PROGRESS) {
        window.VSI_PROGRESS.handleProgressUpdate({
          stage: stageDef.stage,
          status: 'in_progress',
          metadata: { modelId: stageDef.metadata.modelId, latencyMs: 0 }
        });
      }

      // After delay, publish completed
      setTimeout(function () {
        var output = typeof stageDef.output === 'function' ? stageDef.output(submission) : stageDef.output;

        // Store stage result for report rendering
        if (!window.VSI_STAGE_RESULTS) window.VSI_STAGE_RESULTS = {};
        try {
          window.VSI_STAGE_RESULTS[stageDef.stage] = JSON.parse(output);
        } catch (e) {
          window.VSI_STAGE_RESULTS[stageDef.stage] = output;
        }

        // Store metadata for observability
        if (!window.VSI_METADATA) window.VSI_METADATA = {};
        window.VSI_METADATA[stageDef.stage] = stageDef.metadata;

        if (window.VSI_PROGRESS) {
          window.VSI_PROGRESS.handleProgressUpdate({
            stage: stageDef.stage,
            status: 'completed',
            agentOutputSummary: output.substring(0, 200),
            metadata: stageDef.metadata
          });
        }

        // Run next stage
        runNextStage();
      }, stageDef.delayMs);
    }

    // Start first stage after a brief delay
    setTimeout(runNextStage, 500);
  }

  // --- Auto-activate demo mode when WebSocket fails ---

  // Override initWebSocket to detect connection failure and start demo
  var originalInitWebSocket = window.initWebSocket;

  window.initWebSocket = function (submissionId, url) {
    // If URL contains 'placeholder' or demo mode is forced, go straight to demo
    if (url.indexOf('placeholder') !== -1 || window.VSI_DEMO_MODE) {
      console.log('[VSI Demo] Activating demo mode (no live pipeline)');
      startDemoAfterDelay();
      return;
    }

    // Try real WebSocket first
    if (originalInitWebSocket) {
      originalInitWebSocket(submissionId, url);
    }

    // Set a timeout — if no progress updates arrive within 5 seconds, start demo
    var demoTimeout = setTimeout(function () {
      var statuses = window.VSI_PROGRESS ? window.VSI_PROGRESS.getStageMetadata() : {};
      if (Object.keys(statuses).length === 0) {
        console.log('[VSI Demo] No pipeline activity detected, activating demo mode');
        startDemoAfterDelay();
      }
    }, 5000);

    // Cancel demo timeout if real updates arrive
    var checkInterval = setInterval(function () {
      var statuses = window.VSI_PROGRESS ? window.VSI_PROGRESS.getStageMetadata() : {};
      if (Object.keys(statuses).length > 0) {
        clearTimeout(demoTimeout);
        clearInterval(checkInterval);
      }
    }, 1000);
  };

  function startDemoAfterDelay() {
    // Hide reconnection notice if showing
    var notice = document.getElementById('reconnection-notice');
    if (notice) notice.classList.add('hidden');

    var submission = window.VSI_SUBMISSION || {};
    runDemoPipeline(submission);
  }
})();
