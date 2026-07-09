import { randomUUID } from 'crypto';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { createLogger } from '../../shared/logger';
import { IntakeSubmission, IntakeResponse } from '../../shared/types';

/**
 * Intake Handler Lambda
 *
 * Receives POST /submissions from the HTTP API, validates the payload,
 * generates a submission ID, derives synthetic mileage from the telematics ID,
 * asynchronously invokes the Pipeline Orchestrator Lambda, and returns
 * the submission ID + WebSocket URL to the client.
 *
 * Requirements: 3.3, 5.2, 9.3
 */

interface APIGatewayProxyEventV2 {
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method: string;
    };
  };
}

interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

interface ValidationError {
  error: string;
  message: string;
  missingFields: string[];
}

const lambdaClient = new LambdaClient({});

const PIPELINE_FUNCTION_NAME = process.env.PIPELINE_FUNCTION_NAME;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

/**
 * Derives a deterministic synthetic mileage value from a telematics ID.
 * Formula: numericHash(telematicsId) % 100_000
 * Produces a value in the range 0–99,999.
 */
function computeSyntheticMileage(telematicsId: string): number {
  let hash = 0;
  for (let i = 0; i < telematicsId.length; i++) {
    const char = telematicsId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 100_000;
}

/**
 * Validates the intake submission payload.
 * Returns an array of missing required field names, or empty if valid.
 */
function validatePayload(payload: unknown): { valid: true; data: IntakeSubmission } | { valid: false; missingFields: string[] } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, missingFields: ['vehicleModel', 'modelYear', 'symptomDescription'] };
  }

  const body = payload as Record<string, unknown>;
  const missingFields: string[] = [];

  if (!body.vehicleModel || typeof body.vehicleModel !== 'string' || body.vehicleModel.trim().length === 0) {
    missingFields.push('vehicleModel');
  } else if (body.vehicleModel.length > 100) {
    missingFields.push('vehicleModel');
  }

  if (body.modelYear === undefined || body.modelYear === null) {
    missingFields.push('modelYear');
  } else {
    const year = Number(body.modelYear);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      missingFields.push('modelYear');
    }
  }

  if (!body.symptomDescription || typeof body.symptomDescription !== 'string' || body.symptomDescription.trim().length === 0) {
    missingFields.push('symptomDescription');
  } else if (body.symptomDescription.length > 2000) {
    missingFields.push('symptomDescription');
  }

  if (missingFields.length > 0) {
    return { valid: false, missingFields };
  }

  const data: IntakeSubmission = {
    vehicleModel: (body.vehicleModel as string).trim(),
    modelYear: Number(body.modelYear),
    symptomDescription: (body.symptomDescription as string).trim(),
    dtcCodes: Array.isArray(body.dtcCodes) ? body.dtcCodes.filter((c): c is string => typeof c === 'string') : undefined,
  };

  return { valid: true, data };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  // Parse request body
  let body: unknown;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : event.body || '';
    body = JSON.parse(rawBody);
  } catch {
    const errorResponse: ValidationError = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid JSON in request body',
      missingFields: [],
    };
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(errorResponse),
    };
  }

  // Validate payload
  const validation = validatePayload(body);
  if (!validation.valid) {
    const errorResponse: ValidationError = {
      error: 'VALIDATION_ERROR',
      message: `Missing required fields: ${validation.missingFields.join(', ')}`,
      missingFields: validation.missingFields,
    };
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(errorResponse),
    };
  }

  const submission = validation.data;

  // Generate submission ID
  const submissionId = randomUUID();

  // Create logger for this submission
  const logger = createLogger(submissionId);

  // Compute synthetic mileage from submission ID
  const syntheticMileage = computeSyntheticMileage(submissionId);

  // Log intake received
  logger.info('intake_submission_received', {
    vehicleModel: submission.vehicleModel,
    modelYear: submission.modelYear,
    syntheticMileage,
    hasDtcCodes: !!submission.dtcCodes && submission.dtcCodes.length > 0,
  });

  // Construct WebSocket URL
  const websocketUrl = WEBSOCKET_ENDPOINT
    ? `${WEBSOCKET_ENDPOINT}?submissionId=${submissionId}`
    : `wss://placeholder.execute-api.us-east-1.amazonaws.com/prod?submissionId=${submissionId}`;

  // Invoke Pipeline Orchestrator asynchronously
  if (PIPELINE_FUNCTION_NAME) {
    try {
      const pipelinePayload = {
        submissionId,
        submission,
        syntheticMileage,
        websocketUrl,
      };

      const invokeCommand = new InvokeCommand({
        FunctionName: PIPELINE_FUNCTION_NAME,
        InvocationType: InvocationType.Event, // Async invocation
        Payload: Buffer.from(JSON.stringify(pipelinePayload)),
      });

      await lambdaClient.send(invokeCommand);

      logger.info('agent_stage_started', {
        message: 'Pipeline Orchestrator invoked asynchronously',
        pipelineFunctionName: PIPELINE_FUNCTION_NAME,
      });
    } catch (error) {
      // Log error but still return success to the client
      // The pipeline can be retried separately
      logger.error('error', {
        message: 'Failed to invoke Pipeline Orchestrator',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build response
  const timestamp = new Date().toISOString();
  const response: IntakeResponse = {
    submissionId,
    websocketUrl,
    timestamp,
  };

  return {
    statusCode: 201,
    headers: corsHeaders,
    body: JSON.stringify(response),
  };
}
