import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createLogger } from '../../shared/logger';

/**
 * WebSocket $connect route handler.
 *
 * Extracts submissionId from query string parameters and stores the
 * connection record in the connections DynamoDB table with a 24-hour TTL.
 *
 * Requirement 4.2: WebSocket_API SHALL support $connect route key.
 */

interface APIGatewayWebSocketEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
    eventType: string;
    requestTimeEpoch: number;
  };
  queryStringParameters?: Record<string, string>;
}

interface APIGatewayProxyResult {
  statusCode: number;
  body: string;
}

const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME!;
const TTL_HOURS = 24;

const client = new DynamoDBClient({});

export async function handler(event: APIGatewayWebSocketEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId;
  const submissionId = event.queryStringParameters?.submissionId;

  const logger = createLogger(submissionId ?? 'unknown');

  if (!submissionId) {
    logger.warn('error', { message: 'Missing submissionId query parameter', connectionId });
    return { statusCode: 400, body: 'Missing submissionId query parameter' };
  }

  const connectedAt = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + TTL_HOURS * 60 * 60;

  const item = {
    connectionId,
    submissionId,
    connectedAt,
    ttl,
  };

  try {
    const command = new PutItemCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      Item: marshall(item),
    });

    await client.send(command);

    logger.info('websocket_publish', {
      message: 'WebSocket connection established',
      connectionId,
    });

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    logger.error('error', {
      message: 'Failed to store connection record',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return { statusCode: 500, body: 'Internal server error' };
  }
}
