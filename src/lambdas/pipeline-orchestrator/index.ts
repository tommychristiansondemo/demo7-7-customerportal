import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { createLogger } from '../../shared/logger';
import { selectModel } from '../../shared/model-router';
import {
  IntakeSubmission,
  PipelineStage,
  PipelineStatusMessage,
  Weights,
} from '../../shared/types';

/**
 * Pipeline Orchestrator Lambda
 *
 * Receives the intake submission + submissionId from the Intake Handler
 * (async invocation). Orchestrates the 5-stage diagnostic pipeline sequentially:
 *   1. Triage — Analyze symptoms and select diagnostic approach
 *   2. Diagnostic Research — Retrieve from KB + LLM synthesis
 *   3. Parts & Logistics — Check availability via LLM reasoning
 *   4. Warranty Determination — Apply warranty rules via LLM
 *   5. Summary — Generate final diagnostic report
 *
 * Uses Bedrock InvokeModel API directly (NOT InvokeAgent).
 * For "Diagnostic Research" stage, calls bedrock-agent-runtime Retrieve API
 * against the Knowledge Base and incorporates results into the prompt.
 *
 * After each stage, publishes status via the WebSocket Publisher Lambda.
 * On failure of any stage, publishes error status and halts execution.
 * Uses the Model Router to select the appropriate foundation model.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 14.2, 14.5
 */

// --- Types ---

export interface PipelineOrchestratorEvent {
  submissionId: string;
  submission: IntakeSubmission;
  syntheticMileage: number;
  websocketUrl: string;
}

interface StageDefinition {
  stage: PipelineStage;
  buildPrompt: (context: PipelineContext) => Promise<string>;
}

interface PipelineContext {
  submission: IntakeSubmission;
  syntheticMileage: number;
  submissionId: string;
  stageOutputs: Record<string, string>;
}

// --- Environment Variables ---

const WEBSOCKET_PUBLISHER_FUNCTION_NAME = process.env.WEBSOCKET_PUBLISHER_FUNCTION_NAME!;
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || '';

// --- Clients ---

const lambdaClient = new LambdaClient({});
const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region: 'us-east-1' });

// --- Default weights (used when AppConfig is unavailable) ---

const DEFAULT_WEIGHTS: Weights = {
  cost_priority: 15,
  latency_priority: 15,
  quality_priority: 70,
};

// --- Stage Definitions ---

function buildStages(): StageDefinition[] {
  return [
    {
      stage: 'Triage',
      buildPrompt: async (ctx) => {
        const dtcInfo = ctx.submission.dtcCodes?.length
          ? `DTC Codes: ${ctx.submission.dtcCodes.join(', ')}`
          : 'No DTC codes provided.';
        return [
          'You are an expert vehicle diagnostic triage agent for Nissan vehicles.',
          'Analyze the following vehicle symptoms and classify the vehicle system and severity.',
          '',
          `Vehicle: ${ctx.submission.vehicleModel} (${ctx.submission.modelYear})`,
          `Telematics ID: TELEM-${ctx.submissionId.slice(0, 8)}`,
          `Symptom Description: ${ctx.submission.symptomDescription}`,
          dtcInfo,
          '',
          'Respond with a JSON object containing:',
          '- vehicleSystem: one of "powertrain", "ev_battery", "adas", "infotainment", "other"',
          '- severity: one of "low", "medium", "high", "critical"',
          '- dtcCodes: array of relevant DTC codes',
          '- classificationReasoning: brief explanation of your classification',
        ].join('\n');
      },
    },
    {
      stage: 'Diagnostic Research',
      buildPrompt: async (ctx) => {
        const triageOutput = ctx.stageOutputs['Triage'] || 'No triage data available.';

        // Retrieve relevant documents from the Knowledge Base
        const kbResults = await retrieveFromKnowledgeBase(ctx);

        const kbContext = kbResults.length > 0
          ? kbResults.map((r, i) => `[TSB ${i + 1}] (Score: ${r.score.toFixed(2)})\n${r.content}`).join('\n\n')
          : 'No relevant TSBs found in the Knowledge Base.';

        return [
          'You are a diagnostic research agent specializing in Technical Service Bulletins (TSBs) for Nissan vehicles.',
          'Based on the triage classification and the Knowledge Base retrieval results below, synthesize the most relevant TSB information.',
          '',
          `Vehicle: ${ctx.submission.vehicleModel} (${ctx.submission.modelYear})`,
          `Symptom: ${ctx.submission.symptomDescription}`,
          `Triage Output: ${triageOutput}`,
          '',
          '--- KNOWLEDGE BASE RETRIEVAL RESULTS ---',
          kbContext,
          '--- END KB RESULTS ---',
          '',
          'Based on the above TSB excerpts, provide:',
          '- A summary of the most relevant TSBs found',
          '- Key diagnostic steps recommended',
          '- Any part numbers referenced in the TSBs',
          '- Relevance assessment of each TSB to the current symptoms',
        ].join('\n');
      },
    },
    {
      stage: 'Parts & Logistics',
      buildPrompt: async (ctx) => {
        const researchOutput = ctx.stageOutputs['Diagnostic Research'] || 'No research data available.';
        return [
          'You are a parts and logistics agent for Nissan vehicle service.',
          'Based on the diagnostic research output, identify any parts that may be needed and assess logistics.',
          '',
          `Vehicle: ${ctx.submission.vehicleModel} (${ctx.submission.modelYear})`,
          `Diagnostic Research Output: ${researchOutput}`,
          '',
          'Provide a JSON response containing:',
          '- parts: array of objects with partNumber, description, availabilityStatus (in_stock/backordered/discontinued), estimatedLeadTimeDays',
          '- If no specific parts are identified, provide general recommendations based on the diagnostic findings.',
        ].join('\n');
      },
    },
    {
      stage: 'Warranty Determination',
      buildPrompt: async (ctx) => {
        return [
          'You are a warranty determination agent for Nissan vehicles.',
          'Evaluate warranty coverage based on the vehicle details and mileage.',
          '',
          `Vehicle: ${ctx.submission.vehicleModel} (${ctx.submission.modelYear})`,
          `Telematics ID: TELEM-${ctx.submissionId.slice(0, 8)}`,
          `Synthetic Mileage: ${ctx.syntheticMileage} miles`,
          '',
          'Nissan warranty rules:',
          '- New Vehicle Limited Warranty: 3 years / 36,000 miles (whichever comes first)',
          '- Powertrain Warranty: 5 years / 60,000 miles (whichever comes first)',
          '- EV Battery Warranty: 8 years / 100,000 miles',
          '',
          'Respond with a JSON object containing:',
          '- warrantyStatus: "covered", "partially_covered", or "not_covered"',
          '- applicableWarrantyType: "new_vehicle_limited", "powertrain", or "none"',
          '- coverageDetails: explanation of coverage determination',
          '- syntheticMileage: the mileage value used',
        ].join('\n');
      },
    },
    {
      stage: 'Summary',
      buildPrompt: async (ctx) => {
        return [
          'You are a summary orchestrator producing a technician-facing diagnostic report for Nissan vehicle service.',
          'Synthesize all prior stage outputs into a comprehensive, actionable report.',
          '',
          `Vehicle: ${ctx.submission.vehicleModel} (${ctx.submission.modelYear})`,
          `Telematics ID: TELEM-${ctx.submissionId.slice(0, 8)}`,
          `Mileage: ${ctx.syntheticMileage} miles`,
          '',
          '--- STAGE OUTPUTS ---',
          `Triage: ${ctx.stageOutputs['Triage'] || 'N/A'}`,
          '',
          `Diagnostic Research: ${ctx.stageOutputs['Diagnostic Research'] || 'N/A'}`,
          '',
          `Parts & Logistics: ${ctx.stageOutputs['Parts & Logistics'] || 'N/A'}`,
          '',
          `Warranty Determination: ${ctx.stageOutputs['Warranty Determination'] || 'N/A'}`,
          '--- END STAGE OUTPUTS ---',
          '',
          'Compose a structured technician-facing report including:',
          '1. Vehicle classification and severity assessment',
          '2. Relevant TSB excerpts and diagnostic recommendations',
          '3. Parts availability summary with lead times',
          '4. Warranty status and coverage details',
          '5. A clear technician narrative synthesizing all findings into actionable next steps',
        ].join('\n');
      },
    },
  ];
}

// --- Handler ---

export async function handler(event: PipelineOrchestratorEvent): Promise<void> {
  const { submissionId, submission, syntheticMileage } = event;
  const logger = createLogger(submissionId);

  logger.info('agent_stage_started', {
    message: 'Pipeline Orchestrator started',
    vehicleModel: submission.vehicleModel,
    modelYear: submission.modelYear,
    syntheticMileage,
  });

  // Load weights from AppConfig extension (falls back to defaults)
  const weights = await loadWeights(logger);

  // Build pipeline context
  const context: PipelineContext = {
    submission,
    syntheticMileage,
    submissionId,
    stageOutputs: {},
  };

  const stages = buildStages();

  // Execute each stage sequentially
  for (const stageDef of stages) {
    const stageStart = Date.now();

    try {
      // Step 1: Select model via Model Router
      const routerDecision = selectModel(weights, submissionId);

      logger.info('model_routing_decision', {
        stage: stageDef.stage,
        selectedModelId: routerDecision.selectedModelId,
      });

      // Step 2: Publish in_progress status
      await publishStatus(submissionId, {
        submissionId,
        stage: stageDef.stage,
        status: 'in_progress',
        timestamp: new Date().toISOString(),
        metadata: {
          modelId: routerDecision.selectedModelId,
          latencyMs: 0,
        },
      });

      logger.info('agent_stage_started', {
        stage: stageDef.stage,
        model_id: routerDecision.selectedModelId,
      });

      // Step 3: Build prompt (may include KB retrieval for Diagnostic Research)
      const prompt = await stageDef.buildPrompt(context);

      // Step 4: Call Bedrock InvokeModel directly
      const modelOutput = await invokeModel(routerDecision.selectedModelId, prompt);

      // Store output for subsequent stages
      context.stageOutputs[stageDef.stage] = modelOutput;

      const latencyMs = Date.now() - stageStart;

      // Step 5: Publish completed status
      await publishStatus(submissionId, {
        submissionId,
        stage: stageDef.stage,
        status: 'completed',
        agentOutputSummary: truncateOutput(modelOutput, 500),
        timestamp: new Date().toISOString(),
        metadata: {
          modelId: routerDecision.selectedModelId,
          latencyMs,
        },
      });

      logger.info('agent_stage_completed', {
        stage: stageDef.stage,
        model_id: routerDecision.selectedModelId,
        latency_ms: latencyMs,
        output_length: modelOutput.length,
      });
    } catch (error) {
      const latencyMs = Date.now() - stageStart;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Publish error status
      await publishStatus(submissionId, {
        submissionId,
        stage: stageDef.stage,
        status: 'error',
        errorReason: errorMessage,
        timestamp: new Date().toISOString(),
        metadata: {
          modelId: 'unknown',
          latencyMs,
        },
      });

      logger.error('error', {
        stage: stageDef.stage,
        error: errorMessage,
        latency_ms: latencyMs,
      });

      // Halt pipeline on error (Req 5.8)
      return;
    }
  }

  logger.info('agent_stage_completed', {
    message: 'Pipeline completed successfully — all 5 stages done',
  });
}

// --- Helper Functions ---

/**
 * Load model routing weights from the AppConfig Lambda extension.
 * Falls back to default weights if the extension is unavailable.
 */
async function loadWeights(logger: ReturnType<typeof createLogger>): Promise<Weights> {
  try {
    const appConfigUrl =
      'http://localhost:2772/applications/9f423wc/environments/production/configurations/model-weights';

    const response = await fetch(appConfigUrl, {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const config = await response.json() as Record<string, unknown>;
      // AppConfig stores weights as quality/latency/cost (0-100 scale summing to 100)
      const quality = Number(config.quality ?? config.quality_priority ?? 70);
      const latency = Number(config.latency ?? config.latency_priority ?? 15);
      const cost = Number(config.cost ?? config.cost_priority ?? 15);

      const weights: Weights = {
        quality_priority: quality,
        latency_priority: latency,
        cost_priority: cost,
      };

      // Validate before using
      const sum = weights.quality_priority + weights.latency_priority + weights.cost_priority;
      if (Math.abs(sum - 100) <= 1) {
        logger.info('model_routing_decision', {
          message: 'Loaded weights from AppConfig',
          weights,
        });
        return weights;
      }
    }
  } catch {
    logger.info('model_routing_decision', {
      message: 'AppConfig extension unavailable, using default weights',
    });
  }

  return DEFAULT_WEIGHTS;
}

/**
 * Call Bedrock InvokeModel API directly with the selected model.
 * Handles both Anthropic Claude and Amazon Nova model families.
 * Supports inference profile IDs (e.g., us.anthropic.claude-..., us.amazon.nova-...)
 */
async function invokeModel(modelId: string, prompt: string): Promise<string> {
  // Determine model family from the model/profile ID
  const isAnthropic = modelId.includes('anthropic.');
  const isNova = modelId.includes('nova');

  let requestBody: string;

  if (isAnthropic) {
    // Anthropic Claude models use Messages API format
    requestBody = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
  } else if (isNova) {
    // Amazon Nova models use their own format
    requestBody = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
      },
    });
  } else {
    // Fallback - use a generic messages format
    requestBody = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 4096,
    });
  }

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(requestBody),
  });

  const response = await bedrockRuntime.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Extract text based on model family
  if (isAnthropic) {
    // Claude response: { content: [{ type: "text", text: "..." }] }
    if (responseBody.content && Array.isArray(responseBody.content)) {
      return responseBody.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join('\n');
    }
    return JSON.stringify(responseBody);
  } else if (isNova) {
    // Nova response: { output: { message: { content: [{ text: "..." }] } } }
    if (responseBody.output?.message?.content) {
      return responseBody.output.message.content
        .map((block: { text: string }) => block.text)
        .join('\n');
    }
    return JSON.stringify(responseBody);
  }

  // Fallback: return raw JSON
  return JSON.stringify(responseBody);
}

/**
 * Retrieve relevant documents from the Bedrock Knowledge Base.
 * Uses the bedrock-agent-runtime Retrieve API.
 */
async function retrieveFromKnowledgeBase(
  ctx: PipelineContext
): Promise<Array<{ content: string; score: number }>> {
  if (!KNOWLEDGE_BASE_ID) {
    return [];
  }

  // Build a retrieval query based on vehicle + symptoms
  const query = [
    ctx.submission.vehicleModel,
    ctx.submission.modelYear.toString(),
    ctx.submission.symptomDescription,
    ctx.submission.dtcCodes?.join(' ') || '',
  ].join(' ').trim();

  try {
    const command = new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5,
        },
      },
    });

    const response = await bedrockAgentRuntime.send(command);

    if (!response.retrievalResults || response.retrievalResults.length === 0) {
      return [];
    }

    return response.retrievalResults
      .filter((result) => result.content?.text)
      .map((result) => ({
        content: result.content!.text!,
        score: result.score ?? 0,
      }));
  } catch (error) {
    // Log but don't fail the stage - continue with empty KB results
    console.error('Knowledge Base retrieval failed:', error);
    return [];
  }
}

/**
 * Publish a pipeline status message via the WebSocket Publisher Lambda.
 */
async function publishStatus(
  submissionId: string,
  message: PipelineStatusMessage,
): Promise<void> {
  if (!WEBSOCKET_PUBLISHER_FUNCTION_NAME) {
    return;
  }

  const payload = {
    submissionId,
    message,
  };

  const command = new InvokeCommand({
    FunctionName: WEBSOCKET_PUBLISHER_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  try {
    await lambdaClient.send(command);
  } catch (error) {
    // Log but don't halt pipeline for WebSocket failures
    console.error('Failed to publish status via WebSocket Publisher:', error);
  }
}

/**
 * Truncate output to a maximum length for status messages.
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) {
    return output;
  }
  return output.substring(0, maxLength - 3) + '...';
}
