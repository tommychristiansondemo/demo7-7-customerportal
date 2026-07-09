/**
 * Unit tests for the PrivateLink Service Lambda.
 * Validates: Requirements 10.3, 10.4
 */

import { handler } from '../../src/lambdas/privatelink-service/index';

// Capture stdout for logger assertions
const originalWrite = process.stdout.write;
let logOutput: string[];

beforeEach(() => {
  logOutput = [];
  process.stdout.write = jest.fn((chunk: string | Uint8Array) => {
    logOutput.push(chunk.toString());
    return true;
  }) as unknown as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
  delete process.env.DEALER_SERVICE_ENDPOINT;
  jest.restoreAllMocks();
});

describe('PrivateLink Service Lambda', () => {
  it('returns 500 when DEALER_SERVICE_ENDPOINT is not set', async () => {
    delete process.env.DEALER_SERVICE_ENDPOINT;

    const result = await handler({ submissionId: 'test-123' });

    expect(result.statusCode).toBe(500);
    expect(result).toHaveProperty('error', 'CONFIGURATION_ERROR');
  });

  it('returns dealer parts JSON on successful 200 response', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    const mockBody = { parts: [{ id: 'P-001', name: 'Test Part' }] };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockBody,
    } as unknown as Response);

    const result = await handler({ submissionId: 'test-456' });

    expect(result.statusCode).toBe(200);
    expect(result).toHaveProperty('body', mockBody);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://mock-endpoint/dealer-parts',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('returns error response on non-2xx status', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as unknown as Response);

    const result = await handler({ submissionId: 'test-789' });

    expect(result.statusCode).toBe(503);
    expect(result).toHaveProperty('error', 'DEALER_SERVICE_ERROR');
    expect(result).toHaveProperty('message', 'Dealer service returned HTTP 503');
  });

  it('returns 504 timeout error when request exceeds 10 seconds', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    global.fetch = jest.fn().mockRejectedValue(abortError);

    const result = await handler({ submissionId: 'test-timeout' });

    expect(result.statusCode).toBe(504);
    expect(result).toHaveProperty('error', 'TIMEOUT_ERROR');
    expect(result).toHaveProperty(
      'message',
      'Dealer service request timed out after 10 seconds'
    );
  });

  it('returns 502 connection error on network failure', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handler({ submissionId: 'test-conn' });

    expect(result.statusCode).toBe(502);
    expect(result).toHaveProperty('error', 'CONNECTION_ERROR');
    expect((result as { message: string }).message).toContain('ECONNREFUSED');
  });

  it('uses "unknown" as submissionId when not provided', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ parts: [] }),
    } as unknown as Response);

    const result = await handler({});

    expect(result.statusCode).toBe(200);
    // Check logs contain 'unknown' as submission_id
    const logs = logOutput.map((l) => JSON.parse(l));
    expect(logs.some((l: Record<string, unknown>) => l.submission_id === 'unknown')).toBe(true);
  });

  it('logs mcp_tool_call_initiated and mcp_tool_call_completed on success', async () => {
    process.env.DEALER_SERVICE_ENDPOINT = 'http://mock-endpoint';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ parts: [] }),
    } as unknown as Response);

    await handler({ submissionId: 'log-test' });

    const logs = logOutput.map((l) => JSON.parse(l));
    expect(logs.some((l: Record<string, unknown>) => l.event_type === 'mcp_tool_call_initiated')).toBe(true);
    expect(logs.some((l: Record<string, unknown>) => l.event_type === 'mcp_tool_call_completed')).toBe(true);
  });
});
