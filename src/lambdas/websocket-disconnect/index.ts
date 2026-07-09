import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createLogger } from '../../shared/logger';

/**
 * WebSocket $disconnect route handler.
 *
 * Deletes the connection record from the connections DynamoDB table
 * when a client disconnects.
 *
 * Requirement 4.2: WebSocket_API SHALL support $disconnect route key.
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

const client = new DynamoDBClient({});

export async function handler(event: APIGatewayWebSocketEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId;
  const logger = createLogger('disconnect');

  try {
    const command = new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      Key: marshall({ connectionId }),
    });

    await client.send(command);

    logger.info('websocket_publish', {
      message: 'WebSocket connection removed',
      connectionId,
    });

    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    logger.error('error', {
      message: 'Failed to delete connection record',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return { statusCode: 500, body: 'Internal server error' };
  }
}
