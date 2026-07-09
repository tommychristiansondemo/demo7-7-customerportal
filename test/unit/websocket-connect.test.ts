// Mock DynamoDB client — declare mockSend before jest.mock hoisting via var
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
    PutItemCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj: Record<string, unknown>) => {
    const result: Record<string, { S?: string; N?: string }> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') result[key] = { S: value };
      if (typeof value === 'number') result[key] = { N: String(value) };
    }
    return result;
  }),
}));

// Set env before import
process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

import { handler } from '../../src/lambdas/websocket-connect/index';

describe('websocket-connect handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  const makeEvent = (submissionId?: string) => ({
    requestContext: {
      connectionId: 'test-connection-id-123',
      routeKey: '$connect',
      eventType: 'CONNECT',
      requestTimeEpoch: Date.now(),
    },
    queryStringParameters: submissionId ? { submissionId } : undefined,
  });

  it('stores connection record and returns 200 on valid submissionId', async () => {
    const event = makeEvent('sub-abc-123');
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Connected');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when submissionId is missing', async () => {
    const event = makeEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Missing submissionId');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 500 when DynamoDB write fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB write failed'));
    const event = makeEvent('sub-fail-456');
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBe('Internal server error');
  });
});
