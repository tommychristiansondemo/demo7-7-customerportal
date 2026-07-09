// Mock DynamoDB client — declare mockSend before jest.mock hoisting via var
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
    DeleteItemCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj: Record<string, unknown>) => {
    const result: Record<string, { S?: string }> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') result[key] = { S: value };
    }
    return result;
  }),
}));

// Set env before import
process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

import { handler } from '../../src/lambdas/websocket-disconnect/index';

describe('websocket-disconnect handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  const makeEvent = (connectionId = 'test-connection-id-456') => ({
    requestContext: {
      connectionId,
      routeKey: '$disconnect',
      eventType: 'DISCONNECT',
      requestTimeEpoch: Date.now(),
    },
    queryStringParameters: undefined,
  });

  it('deletes connection record and returns 200', async () => {
    const event = makeEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Disconnected');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when DynamoDB delete fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB delete failed'));
    const event = makeEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBe('Internal server error');
  });
});
