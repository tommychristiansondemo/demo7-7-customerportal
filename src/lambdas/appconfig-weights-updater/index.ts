/**
 * AppConfig Weights Updater Lambda
 *
 * Handles PUT and GET requests for model routing weights via the HTTP API.
 *
 * PUT /config/weights:
 *   - Validates weights sum to 1.0 (±0.001), each in [0.0, 1.0]
 *   - Creates a new AppConfig hosted configuration version
 *   - Starts an immediate deployment to the production environment
 *   - Returns 200 with timestamp on success
 *
 * GET /config/weights:
 *   - Reads current config via the AppConfig Lambda Extension (localhost:2772)
 *   - Returns current weights + lastUpdated timestamp
 *
 * Returns 400 for invalid weights, 500 for AppConfig failures.
 *
 * Requirements: 11.6, 11.8, 12.5, 12.7
 */

import { Weights } from '../../shared/types';
import { validateWeights } from '../../shared/model-router';

// --- Types ---

interface APIGatewayProxyEventV2 {
  requestContext: {
    http: {
      method: string;
    };
  };
  body?: string;
  isBase64Encoded?: boolean;
}

interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// --- Environment Variables ---

const APPLICATION_ID = process.env.APPCONFIG_APPLICATION_ID!;
const ENVIRONMENT_ID = process.env.APPCONFIG_ENVIRONMENT_ID!;
const CONFIGURATION_PROFILE_ID = process.env.APPCONFIG_CONFIGURATION_PROFILE_ID!;
const DEPLOYMENT_STRATEGY_ID = process.env.APPCONFIG_DEPLOYMENT_STRATEGY_ID!;

// AppConfig Extension endpoint for reading current configuration
const APPCONFIG_EXTENSION_URL =
  'http://localhost:2772/applications/vsi-model-routing/environments/production/configurations/model-weights';

// --- Helper: Build JSON response ---

function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

// --- PUT Handler: Update Weights ---

async function handlePut(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // Parse request body
  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
  }

  let requestBody: Record<string, unknown>;
  try {
    requestBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, {
      error: 'VALIDATION_ERROR',
      message: 'Request body must be valid JSON',
    });
  }

  // Extract weights
  const weights: Weights = {
    cost_priority: requestBody.cost_priority as number,
    latency_priority: requestBody.latency_priority as number,
    quality_priority: requestBody.quality_priority as number,
  };

  // Validate that all fields are numbers
  if (
    typeof weights.cost_priority !== 'number' ||
    typeof weights.latency_priority !== 'number' ||
    typeof weights.quality_priority !== 'number'
  ) {
    return jsonResponse(400, {
      error: 'VALIDATION_ERROR',
      message: 'cost_priority, latency_priority, and quality_priority must all be numbers',
    });
  }

  // Check for NaN
  if (isNaN(weights.cost_priority) || isNaN(weights.latency_priority) || isNaN(weights.quality_priority)) {
    return jsonResponse(400, {
      error: 'VALIDATION_ERROR',
      message: 'cost_priority, latency_priority, and quality_priority must not be NaN',
    });
  }

  // Validate weights using shared validation logic
  const validation = validateWeights(weights);
  if (!validation.valid) {
    return jsonResponse(400, {
      error: 'VALIDATION_ERROR',
      message: validation.error!,
    });
  }

  // Create new hosted configuration version and deploy
  try {
    const { AppConfigClient, CreateHostedConfigurationVersionCommand, StartDeploymentCommand } =
      await import('@aws-sdk/client-appconfig');

    const client = new AppConfigClient({});

    // Create new hosted configuration version
    const configContent = JSON.stringify({
      cost_priority: weights.cost_priority,
      latency_priority: weights.latency_priority,
      quality_priority: weights.quality_priority,
    });

    const createVersionResult = await client.send(
      new CreateHostedConfigurationVersionCommand({
        ApplicationId: APPLICATION_ID,
        ConfigurationProfileId: CONFIGURATION_PROFILE_ID,
        Content: new TextEncoder().encode(configContent),
        ContentType: 'application/json',
        Description: `Weight update: cost=${weights.cost_priority}, latency=${weights.latency_priority}, quality=${weights.quality_priority}`,
      })
    );

    const versionNumber = createVersionResult.VersionNumber?.toString();

    // Start deployment to production environment
    await client.send(
      new StartDeploymentCommand({
        ApplicationId: APPLICATION_ID,
        EnvironmentId: ENVIRONMENT_ID,
        ConfigurationProfileId: CONFIGURATION_PROFILE_ID,
        ConfigurationVersion: versionNumber,
        DeploymentStrategyId: DEPLOYMENT_STRATEGY_ID,
        Description: `Deploy weights: cost=${weights.cost_priority}, latency=${weights.latency_priority}, quality=${weights.quality_priority}`,
      })
    );

    const timestamp = new Date().toISOString();

    return jsonResponse(200, {
      message: 'Weights updated successfully',
      weights: {
        cost_priority: weights.cost_priority,
        latency_priority: weights.latency_priority,
        quality_priority: weights.quality_priority,
      },
      timestamp,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown AppConfig error';
    console.error('AppConfig update failed:', errorMessage);
    return jsonResponse(500, {
      error: 'APPCONFIG_ERROR',
      message: `Failed to update AppConfig: ${errorMessage}`,
    });
  }
}

// --- GET Handler: Read Current Weights ---

async function handleGet(): Promise<APIGatewayProxyResultV2> {
  try {
    // Read current configuration from AppConfig Lambda Extension
    const response = await fetch(APPCONFIG_EXTENSION_URL);

    if (!response.ok) {
      throw new Error(`AppConfig extension returned ${response.status}: ${response.statusText}`);
    }

    const config = (await response.json()) as Record<string, unknown>;

    return jsonResponse(200, {
      cost_priority: config.cost_priority,
      latency_priority: config.latency_priority,
      quality_priority: config.quality_priority,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error reading configuration';
    console.error('Failed to read AppConfig:', errorMessage);
    return jsonResponse(500, {
      error: 'APPCONFIG_ERROR',
      message: `Failed to read current weights: ${errorMessage}`,
    });
  }
}

// --- Main Handler ---

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method.toUpperCase();

  switch (method) {
    case 'PUT':
      return handlePut(event);
    case 'GET':
      return handleGet();
    default:
      return jsonResponse(405, {
        error: 'METHOD_NOT_ALLOWED',
        message: `Method ${method} is not supported. Use GET or PUT.`,
      });
  }
}
