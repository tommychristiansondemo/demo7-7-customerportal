import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { PipelineStatusMessage } from '../../shared/types';
import { createLogger } from '../../shared/logger';

/**
 * WebSocket Publisher Lambda
 *
 * Receives a pipeline status event (submissionId + PipelineStatusMessage),
 * queries the DynamoDB connections table GSI by submissionId to find all
 * connected WebSocket clients, and fans out the status message to each.
 *
 * On GoneException (410), deletes the stale connection record.
 *
 * Requirements: 4.3, 4.4
 */

export interface WebSocketPublisherEvent {
  submissionId: string;
  message: PipelineStatusMessage;
}

export interface WebSocketPublisherResult {
  deliveredCount: number;
  staleCount: number;
  failedCount: number;
}

const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;

const ddbClient = new DynamoDBClient({});

function createApiGwClient(): ApiGatewayManagementApiClient {
  return new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_ENDPOINT,
  });
}

export async function handler(event: WebSocketPublisherEvent): Promise<WebSocketPublisherResult> {
  const { submissionId, message } = event;
  const logger = createLogger(submissionId);

  logger.info('websocket_publish', {
    message: 'Publishing status update to WebSocket connections',
    stage: message.stage,
    status: message.status,
  });

  // Query all connections for this submissionId using the GSI
  const connectionIds = await queryConnectionsBySubmissionId(submissionId);

  if (connectionIds.length === 0) {
    logger.info('websocket_publish', {
      message: 'No active connections for submission',
    });
    return { deliveredCount: 0, staleCount: 0, failedCount: 0 };
  }

  logger.info('websocket_publish', {
    message: `Found ${connectionIds.length} connection(s) for submission`,
    connectionCount: connectionIds.length,
  });

  const apiGwClient = createApiGwClient();

  // Wrap the message in the expected WebSocket message envelope
  const payload = JSON.stringify({
    type: 'PIPELINE_STATUS',
    payload: message,
  });

  let deliveredCount = 0;
  let staleCount = 0;
  let failedCount = 0;

  // Fan out to all connections
  const results = await Promise.allSettled(
    connectionIds.map(async (connectionId) => {
      try {
        const command = new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(payload),
        });

        await apiGwClient.send(command);
        deliveredCount++;
      } catch (error) {
        if (error instanceof GoneException) {
          // Connection is stale — delete from DDB
          await deleteStaleConnection(connectionId);
          staleCount++;
          logger.info('websocket_publish', {
            message: 'Deleted stale connection',
            connectionId,
          });
        } else {
          failedCount++;
          logger.error('error', {
            message: 'Failed to post to connection',
            connectionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })
  );

  logger.info('websocket_publish', {
    message: 'WebSocket fan-out complete',
    deliveredCount,
    staleCount,
    failedCount,
    totalConnections: connectionIds.length,
  });

  return { deliveredCount, staleCount, failedCount };
}

/**
 * Query the connections table GSI (submissionId-index) to find all
 * connectionIds associated with a given submissionId.
 */
async function queryConnectionsBySubmissionId(submissionId: string): Promise<string[]> {
  const connectionIds: string[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const command = new QueryCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      IndexName: 'submissionId-index',
      KeyConditionExpression: 'submissionId = :sid',
      ExpressionAttributeValues: marshall({ ':sid': submissionId }),
      ProjectionExpression: 'connectionId',
      ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await ddbClient.send(command);

    if (result.Items) {
      for (const item of result.Items) {
        const record = unmarshall(item);
        if (record.connectionId) {
          connectionIds.push(record.connectionId as string);
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return connectionIds;
}

/**
 * Delete a stale connection record from the connections table.
 * Called when postToConnection throws a GoneException (410).
 */
async function deleteStaleConnection(connectionId: string): Promise<void> {
  const command = new DeleteItemCommand({
    TableName: CONNECTIONS_TABLE_NAME,
    Key: marshall({ connectionId }),
  });

  await ddbClient.send(command);
}
