import { handler, WebSocketPublisherEvent } from '../../src/lambdas/websocket-publisher/index';
import { PipelineStatusMessage } from '../../src/shared/types';

/**
 * Unit tests for the WebSocket Publisher Lambda.
 *
 * Tests cover:
 * - Fan-out delivery to multiple connections
 * - Handling of stale connections (GoneException)
 * - No connections scenario
 * - Error handling for postToConnection failures
 *
 * Requirements: 4.3, 4.4
 */

// Mock AWS SDK clients
const mockQuery = jest.fn();
const mockDeleteItem = jest.fn();
const mockPostToConnection = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn((command) => {
      if (command.constructor.name === 'QueryCommand') {
        return mockQuery(command);
      }
      if (command.constructor.name === 'DeleteItemCommand') {
        return mockDeleteItem(command);
      }
      return Promise.resolve({});
    }),
  })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ ...input, constructor: { name: 'QueryCommand' } })),
  DeleteItemCommand: jest.fn().mockImplementation((input) => ({ ...input, constructor: { name: 'DeleteItemCommand' } })),
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
      send: jest.fn((command) => mockPostToConnection(command)),
    })),
    PostToConnectionCommand: jest.fn().mockImplementation((input) => ({ ...input })),
    GoneException,
  };
});

// Get the mocked GoneException for use in tests
const { GoneException } = jest.requireMock('@aws-sdk/client-apigatewaymanagementapi');

// Set environment variables
process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';
process.env.WEBSOCKET_ENDPOINT = 'https://test-api.execute-api.us-east-1.amazonaws.com/prod';

function createTestMessage(overrides: Partial<PipelineStatusMessage> = {}): PipelineStatusMessage {
  return {
    submissionId: 'test-submission-123',
    stage: 'Triage',
    status: 'completed',
    agentOutputSummary: 'Test output summary',
    timestamp: '2024-12-01T10:30:05.000Z',
    ...overrides,
  };
}

function createTestEvent(overrides: Partial<WebSocketPublisherEvent> = {}): WebSocketPublisherEvent {
  return {
    submissionId: 'test-submission-123',
    message: createTestMessage(),
    ...overrides,
  };
}

describe('WebSocket Publisher Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should deliver messages to all active connections', async () => {
    // Setup: 3 active connections for the submission
    mockQuery.mockResolvedValue({
      Items: [
        { connectionId: { S: 'conn-1' } },
        { connectionId: { S: 'conn-2' } },
        { connectionId: { S: 'conn-3' } },
      ],
      LastEvaluatedKey: undefined,
    });

    mockPostToConnection.mockResolvedValue({});

    const event = createTestEvent();
    const result = await handler(event);

    expect(result.deliveredCount).toBe(3);
    expect(result.staleCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(mockPostToConnection).toHaveBeenCalledTimes(3);
  });

  it('should handle no connections gracefully', async () => {
    mockQuery.mockResolvedValue({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const event = createTestEvent();
    const result = await handler(event);

    expect(result.deliveredCount).toBe(0);
    expect(result.staleCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(mockPostToConnection).not.toHaveBeenCalled();
  });

  it('should delete stale connections on GoneException', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        { connectionId: { S: 'conn-active' } },
        { connectionId: { S: 'conn-stale' } },
      ],
      LastEvaluatedKey: undefined,
    });

    // First connection succeeds, second throws GoneException
    mockPostToConnection
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new GoneException());

    mockDeleteItem.mockResolvedValue({});

    const event = createTestEvent();
    const result = await handler(event);

    expect(result.deliveredCount).toBe(1);
    expect(result.staleCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(mockDeleteItem).toHaveBeenCalledTimes(1);
  });

  it('should count failures for non-GoneException errors', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        { connectionId: { S: 'conn-1' } },
        { connectionId: { S: 'conn-2' } },
      ],
      LastEvaluatedKey: undefined,
    });

    mockPostToConnection
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Network error'));

    const event = createTestEvent();
    const result = await handler(event);

    expect(result.deliveredCount).toBe(1);
    expect(result.staleCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('should structure messages per PipelineStatusMessage interface', async () => {
    mockQuery.mockResolvedValue({
      Items: [{ connectionId: { S: 'conn-1' } }],
      LastEvaluatedKey: undefined,
    });

    mockPostToConnection.mockResolvedValue({});

    const message = createTestMessage({
      stage: 'Diagnostic Research',
      status: 'in_progress',
      metadata: {
        modelId: 'amazon.nova-lite-v1:0',
        latencyMs: 1500,
        tokenCount: 200,
        estimatedCostUsd: 0.0002,
      },
    });

    const event = createTestEvent({ message });
    await handler(event);

    // Verify the message structure sent to the connection
    expect(mockPostToConnection).toHaveBeenCalledTimes(1);
    const sentCommand = mockPostToConnection.mock.calls[0][0];
    const sentPayload = JSON.parse(Buffer.from(sentCommand.Data).toString());

    expect(sentPayload.type).toBe('PIPELINE_STATUS');
    expect(sentPayload.payload.submissionId).toBe('test-submission-123');
    expect(sentPayload.payload.stage).toBe('Diagnostic Research');
    expect(sentPayload.payload.status).toBe('in_progress');
    expect(sentPayload.payload.metadata.modelId).toBe('amazon.nova-lite-v1:0');
    expect(sentPayload.payload.metadata.latencyMs).toBe(1500);
  });

  it('should handle paginated DynamoDB query results', async () => {
    // First page returns 1 item with LastEvaluatedKey
    mockQuery
      .mockResolvedValueOnce({
        Items: [{ connectionId: { S: 'conn-page1' } }],
        LastEvaluatedKey: { connectionId: { S: 'conn-page1' } },
      })
      .mockResolvedValueOnce({
        Items: [{ connectionId: { S: 'conn-page2' } }],
        LastEvaluatedKey: undefined,
      });

    mockPostToConnection.mockResolvedValue({});

    const event = createTestEvent();
    const result = await handler(event);

    expect(result.deliveredCount).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should include error status messages with errorReason', async () => {
    mockQuery.mockResolvedValue({
      Items: [{ connectionId: { S: 'conn-1' } }],
      LastEvaluatedKey: undefined,
    });

    mockPostToConnection.mockResolvedValue({});

    const message = createTestMessage({
      status: 'error',
      errorReason: 'Agent timeout after 60s',
      agentOutputSummary: undefined,
    });

    const event = createTestEvent({ message });
    await handler(event);

    const sentCommand = mockPostToConnection.mock.calls[0][0];
    const sentPayload = JSON.parse(Buffer.from(sentCommand.Data).toString());

    expect(sentPayload.payload.status).toBe('error');
    expect(sentPayload.payload.errorReason).toBe('Agent timeout after 60s');
  });
});
