import { handler } from '../../src/lambdas/kb-retrieval/index';

/**
 * Unit tests for KB Retrieval Lambda
 *
 * Tests validate input handling, error cases, and correct mapping
 * of Bedrock Knowledge Base responses to the expected output format.
 *
 * Requirements: 5.3, 6.2, 7.4
 */

// Mock the Bedrock Agent Runtime client
// jest.mock is hoisted, so we use a factory that returns functions referencing a variable
// declared with var (which is also hoisted)
var mockSend: jest.Mock; // eslint-disable-line no-var
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  RetrieveCommand: jest.fn((input: unknown) => ({ input })),
}));

describe('KB Retrieval Lambda', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockSend = jest.fn();
    jest.clearAllMocks();
    process.env = { ...originalEnv, KNOWLEDGE_BASE_ID: 'test-kb-id-123', TOP_K: '3' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return an error when KNOWLEDGE_BASE_ID is not configured', async () => {
    delete process.env.KNOWLEDGE_BASE_ID;
    delete process.env.KB_ID;
    const result = await handler({ query: 'some query', submissionId: 'test-sub-1' });
    expect(result).toHaveProperty('error', 'CONFIGURATION_ERROR');
    expect(result).toHaveProperty('message', 'Knowledge Base ID is not configured');
  });

  it('should return a validation error for empty query', async () => {
    const result = await handler({ query: '   ', submissionId: 'test-sub-2' });
    expect(result).toHaveProperty('error', 'VALIDATION_ERROR');
    expect(result).toHaveProperty('message', 'A non-empty query string is required');
  });

  it('should return a validation error when query is missing', async () => {
    const result = await handler({ query: '', submissionId: 'test-sub-3' });
    expect(result).toHaveProperty('error', 'VALIDATION_ERROR');
  });

  it('should return excerpts from Knowledge Base on successful retrieval', async () => {
    mockSend.mockResolvedValueOnce({
      retrievalResults: [
        {
          content: { text: 'Battery drain issue in cold climates...' },
          location: { s3Location: { uri: 's3://tsb-bucket/TSB-DEMO-001.md' } },
          score: 0.92,
          metadata: { document_id: 'TSB-DEMO-001', vehicle_system: 'ev_battery' },
        },
        {
          content: { text: 'Powertrain control module update...' },
          location: { s3Location: { uri: 's3://tsb-bucket/TSB-DEMO-002.md' } },
          score: 0.85,
          metadata: { document_id: 'TSB-DEMO-002', vehicle_system: 'powertrain' },
        },
        {
          content: { text: 'ADAS sensor calibration procedure...' },
          location: { s3Location: { uri: 's3://tsb-bucket/TSB-DEMO-003.md' } },
          score: 0.78,
          metadata: { document_id: 'TSB-DEMO-003', vehicle_system: 'adas' },
        },
      ],
    });

    const result = await handler({
      query: 'battery drain cold weather',
      submissionId: 'sub-123',
    });

    expect(result).not.toHaveProperty('error');
    const successResult = result as {
      excerpts: Array<{
        documentId: string;
        content: string;
        score?: number;
        source?: string;
        metadata?: Record<string, string>;
      }>;
      query: string;
      knowledgeBaseId: string;
      resultCount: number;
    };

    expect(successResult.excerpts).toHaveLength(3);
    expect(successResult.query).toBe('battery drain cold weather');
    expect(successResult.knowledgeBaseId).toBe('test-kb-id-123');
    expect(successResult.resultCount).toBe(3);

    // Verify first excerpt
    expect(successResult.excerpts[0].documentId).toBe('s3://tsb-bucket/TSB-DEMO-001.md');
    expect(successResult.excerpts[0].content).toBe('Battery drain issue in cold climates...');
    expect(successResult.excerpts[0].score).toBe(0.92);
    expect(successResult.excerpts[0].source).toBe('s3://tsb-bucket/TSB-DEMO-001.md');
    expect(successResult.excerpts[0].metadata?.document_id).toBe('TSB-DEMO-001');
    expect(successResult.excerpts[0].metadata?.vehicle_system).toBe('ev_battery');
  });

  it('should return empty excerpts when Knowledge Base returns no results', async () => {
    mockSend.mockResolvedValueOnce({
      retrievalResults: [],
    });

    const result = await handler({
      query: 'nonexistent issue xyz',
      submissionId: 'sub-empty',
    });

    expect(result).not.toHaveProperty('error');
    const successResult = result as {
      excerpts: unknown[];
      resultCount: number;
    };
    expect(successResult.excerpts).toHaveLength(0);
    expect(successResult.resultCount).toBe(0);
  });

  it('should handle Knowledge Base API errors gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied to Knowledge Base'));

    const result = await handler({
      query: 'battery issue',
      submissionId: 'sub-error',
    });

    expect(result).toHaveProperty('error', 'RETRIEVAL_ERROR');
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('Access denied to Knowledge Base')
    );
  });

  it('should handle missing retrievalResults in response', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await handler({
      query: 'test query',
      submissionId: 'sub-null',
    });

    expect(result).not.toHaveProperty('error');
    const successResult = result as {
      excerpts: unknown[];
      resultCount: number;
    };
    expect(successResult.excerpts).toHaveLength(0);
    expect(successResult.resultCount).toBe(0);
  });

  it('should trim the query string before sending to KB', async () => {
    mockSend.mockResolvedValueOnce({ retrievalResults: [] });

    const result = await handler({
      query: '  battery drain  ',
      submissionId: 'sub-trim',
    });

    expect(result).not.toHaveProperty('error');
    const successResult = result as { query: string };
    expect(successResult.query).toBe('battery drain');
  });

  it('should handle results with missing optional fields', async () => {
    mockSend.mockResolvedValueOnce({
      retrievalResults: [
        {
          content: { text: 'Some content' },
          // No location, no score, no metadata
        },
      ],
    });

    const result = await handler({
      query: 'test',
      submissionId: 'sub-partial',
    });

    expect(result).not.toHaveProperty('error');
    const successResult = result as {
      excerpts: Array<{
        documentId: string;
        content: string;
        score?: number;
        source?: string;
      }>;
    };
    expect(successResult.excerpts).toHaveLength(1);
    expect(successResult.excerpts[0].documentId).toBe('unknown');
    expect(successResult.excerpts[0].content).toBe('Some content');
    expect(successResult.excerpts[0].score).toBeUndefined();
    expect(successResult.excerpts[0].source).toBeUndefined();
  });
});
