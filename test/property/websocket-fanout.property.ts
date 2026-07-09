/**
 * Property-based test: WebSocket fan-out delivers to all connections for a submission.
 *
 * Generates random connection sets (1-20) with random stale positions,
 * mocks DynamoDB Query and API Gateway Management postToConnection,
 * and asserts:
 * 1. Message is delivered to ALL non-stale, non-failed connections.
 * 2. Stale connections (GoneException) are cleaned up via DeleteItem.
 * 3. delivery count + stale count + failed count = total connections.
 *
 * **Validates: Requirements 4.3**
 */

import * as fc from 'fast-check';

// Mock AWS SDK clients before importing the handler
const mockDdbSend = jest.fn();
const mockApiGwSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockDdbSend,
  })),
  QueryCommand: jest.fn().mockImplementation((input) => ({
    ...input,
    _type: 'QueryCommand',
  })),
  DeleteItemCommand: jest.fn().mockImplementation((input) => ({
    ...input,
    _type: 'DeleteItemCommand',
  })),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = { S: value };
      } else if (typeof value === 'number') {
        result[key] = { N: String(value) };
      }
    }
    return result;
  }),
  unmarshall: jest.fn((item: Record<string, any>) => {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(item)) {
      if ((value as any).S !== undefined) {
        result[key] = (value as any).S;
      } else if ((value as any).N !== undefined) {
        result[key] = Number((value as any).N);
      }
    }
    return result;
  }),
}));

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
  class GoneException extends Error {
    name = 'GoneException';
    $metadata = { httpStatusCode: 410 };
    constructor() {
      super('Gone');
      Object.setPrototypeOf(this, GoneException.prototype);
    }
  }

  return {
    ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
      send: mockApiGwSend,
    })),
    PostToConnectionCommand: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: 'PostToConnectionCommand',
    })),
    GoneException,
  };
});

const { GoneException } = jest.requireMock('@aws-sdk/client-apigatewaymanagementapi');

// Set environment variables before importing the handler
process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';
process.env.WEBSOCKET_ENDPOINT = 'https://test-api.execute-api.us-east-1.amazonaws.com/prod';

import { handler, WebSocketPublisherEvent } from '../../src/lambdas/websocket-publisher/index';
import { PipelineStatusMessage } from '../../src/shared/types';

// Suppress stdout during property tests (logger writes to stdout)
beforeAll(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  jest.restoreAllMocks();
});

/**
 * Represents the outcome category for each connection during fan-out.
 * - 'delivered': postToConnection succeeds
 * - 'stale': postToConnection throws GoneException (connection is cleaned up)
 * - 'failed': postToConnection throws a non-Gone error
 */
type ConnectionOutcome = 'delivered' | 'stale' | 'failed';

/**
 * Arbitrary: generates a list of connection outcomes (1-20 connections),
 * where each connection is randomly categorized as delivered, stale, or failed.
 */
const connectionOutcomesArb: fc.Arbitrary<ConnectionOutcome[]> = fc
  .array(
    fc.constantFrom<ConnectionOutcome>('delivered', 'stale', 'failed'),
    { minLength: 1, maxLength: 20 }
  );

/**
 * Arbitrary: generates a valid submissionId (UUID-like string).
 */
const submissionIdArb: fc.Arbitrary<string> = fc
  .uuid()
  .map((uuid) => uuid);

describe('Property 5: WebSocket fan-out delivers to all connections for a submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delivery count + stale count + failed count = total connections', async () => {
    await fc.assert(
      fc.asyncProperty(
        connectionOutcomesArb,
        submissionIdArb,
        async (outcomes: ConnectionOutcome[], submissionId: string) => {
          const totalConnections = outcomes.length;
          const connectionIds = outcomes.map((_, i) => `conn-${i}`);

          // Mock DynamoDB Query to return generated connection IDs
          mockDdbSend.mockImplementation((command: any) => {
            if (command._type === 'QueryCommand') {
              return Promise.resolve({
                Items: connectionIds.map((id) => ({
                  connectionId: { S: id },
                })),
                LastEvaluatedKey: undefined,
              });
            }
            // DeleteItem for stale connections
            if (command._type === 'DeleteItemCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          // Mock postToConnection based on connection outcomes
          let callIndex = 0;
          mockApiGwSend.mockImplementation(() => {
            const outcome = outcomes[callIndex];
            callIndex++;
            if (outcome === 'stale') {
              return Promise.reject(new GoneException());
            } else if (outcome === 'failed') {
              return Promise.reject(new Error('InternalServerError'));
            }
            return Promise.resolve({});
          });

          const message: PipelineStatusMessage = {
            submissionId,
            stage: 'Triage',
            status: 'completed',
            agentOutputSummary: 'Test',
            timestamp: new Date().toISOString(),
          };

          const event: WebSocketPublisherEvent = { submissionId, message };
          const result = await handler(event);

          // Property: counts must sum to total connections
          expect(result.deliveredCount + result.staleCount + result.failedCount)
            .toBe(totalConnections);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('message is delivered to ALL non-stale, non-failed connections', async () => {
    await fc.assert(
      fc.asyncProperty(
        connectionOutcomesArb,
        submissionIdArb,
        async (outcomes: ConnectionOutcome[], submissionId: string) => {
          const connectionIds = outcomes.map((_, i) => `conn-${i}`);
          const expectedDelivered = outcomes.filter((o) => o === 'delivered').length;

          // Mock DynamoDB Query
          mockDdbSend.mockImplementation((command: any) => {
            if (command._type === 'QueryCommand') {
              return Promise.resolve({
                Items: connectionIds.map((id) => ({
                  connectionId: { S: id },
                })),
                LastEvaluatedKey: undefined,
              });
            }
            if (command._type === 'DeleteItemCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          // Mock postToConnection based on outcomes
          let callIndex = 0;
          mockApiGwSend.mockImplementation(() => {
            const outcome = outcomes[callIndex];
            callIndex++;
            if (outcome === 'stale') {
              return Promise.reject(new GoneException());
            } else if (outcome === 'failed') {
              return Promise.reject(new Error('InternalServerError'));
            }
            return Promise.resolve({});
          });

          const message: PipelineStatusMessage = {
            submissionId,
            stage: 'Diagnostic Research',
            status: 'in_progress',
            timestamp: new Date().toISOString(),
          };

          const event: WebSocketPublisherEvent = { submissionId, message };
          const result = await handler(event);

          // Property: delivered count equals number of connections that didn't error
          expect(result.deliveredCount).toBe(expectedDelivered);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stale connections (GoneException) are cleaned up via DeleteItem', async () => {
    await fc.assert(
      fc.asyncProperty(
        connectionOutcomesArb,
        submissionIdArb,
        async (outcomes: ConnectionOutcome[], submissionId: string) => {
          const connectionIds = outcomes.map((_, i) => `conn-${i}`);
          const expectedStale = outcomes.filter((o) => o === 'stale').length;
          const deleteItemCalls: string[] = [];

          // Mock DynamoDB
          mockDdbSend.mockImplementation((command: any) => {
            if (command._type === 'QueryCommand') {
              return Promise.resolve({
                Items: connectionIds.map((id) => ({
                  connectionId: { S: id },
                })),
                LastEvaluatedKey: undefined,
              });
            }
            if (command._type === 'DeleteItemCommand') {
              // Track which connection IDs are deleted
              const key = command.Key;
              if (key?.connectionId?.S) {
                deleteItemCalls.push(key.connectionId.S);
              }
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          // Mock postToConnection based on outcomes
          let callIndex = 0;
          mockApiGwSend.mockImplementation(() => {
            const outcome = outcomes[callIndex];
            callIndex++;
            if (outcome === 'stale') {
              return Promise.reject(new GoneException());
            } else if (outcome === 'failed') {
              return Promise.reject(new Error('InternalServerError'));
            }
            return Promise.resolve({});
          });

          const message: PipelineStatusMessage = {
            submissionId,
            stage: 'Parts & Logistics',
            status: 'completed',
            timestamp: new Date().toISOString(),
          };

          const event: WebSocketPublisherEvent = { submissionId, message };
          const result = await handler(event);

          // Property: stale count matches number of GoneExceptions
          expect(result.staleCount).toBe(expectedStale);

          // Property: a DeleteItem was called for each stale connection
          expect(deleteItemCalls.length).toBe(expectedStale);
        }
      ),
      { numRuns: 100 }
    );
  });
});
