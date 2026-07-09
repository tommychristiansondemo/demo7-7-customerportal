/**
 * PrivateLink Service Lambda — MCP tool
 *
 * Makes an HTTP GET request to a mock dealer parts service running on ECS Fargate
 * via a VPC Endpoint (PrivateLink). Returns the dealer parts inventory JSON.
 *
 * Environment variables:
 *   DEALER_SERVICE_ENDPOINT — base URL of the ECS mock service (e.g., http://vpce-xxx.vpce-svc-xxx.us-east-1.vpce.amazonaws.com)
 *
 * Requirements: 10.3, 10.4
 */

import { createLogger } from '../../shared/logger';

interface PrivateLinkEvent {
  submissionId?: string;
  [key: string]: unknown;
}

interface PrivateLinkSuccessResponse {
  statusCode: number;
  body: unknown;
}

interface PrivateLinkErrorResponse {
  statusCode: number;
  error: string;
  message: string;
}

export async function handler(
  event: PrivateLinkEvent
): Promise<PrivateLinkSuccessResponse | PrivateLinkErrorResponse> {
  const submissionId = event.submissionId ?? 'unknown';
  const logger = createLogger(submissionId);

  const endpoint = process.env.DEALER_SERVICE_ENDPOINT;
  if (!endpoint) {
    logger.error('error', {
      message: 'DEALER_SERVICE_ENDPOINT environment variable is not set',
    });
    return {
      statusCode: 500,
      error: 'CONFIGURATION_ERROR',
      message: 'Dealer service endpoint is not configured',
    };
  }

  const url = `${endpoint}/dealer-parts`;

  logger.info('mcp_tool_call_initiated', {
    tool_name: 'privatelink_service',
    url,
  });

  // 10-second timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.error('error', {
        tool_name: 'privatelink_service',
        message: `Dealer service returned non-2xx status: ${response.status}`,
        http_status: response.status,
        response_body: errorBody,
      });
      return {
        statusCode: response.status,
        error: 'DEALER_SERVICE_ERROR',
        message: `Dealer service returned HTTP ${response.status}`,
      };
    }

    const body = await response.json();

    logger.info('mcp_tool_call_completed', {
      tool_name: 'privatelink_service',
      http_status: response.status,
    });

    return {
      statusCode: 200,
      body,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isTimeout =
      err instanceof Error && err.name === 'AbortError';

    const message = isTimeout
      ? 'Dealer service request timed out after 10 seconds'
      : `Dealer service request failed: ${err instanceof Error ? err.message : String(err)}`;

    logger.error('error', {
      tool_name: 'privatelink_service',
      message,
      is_timeout: isTimeout,
    });

    return {
      statusCode: isTimeout ? 504 : 502,
      error: isTimeout ? 'TIMEOUT_ERROR' : 'CONNECTION_ERROR',
      message,
    };
  }
}
