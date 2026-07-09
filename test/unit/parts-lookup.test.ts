/**
 * Unit tests for Parts Lookup Lambda
 *
 * Tests the handler logic for BatchGetItem on DynamoDB parts table,
 * including found parts, missing parts, validation, and edge cases.
 *
 * Requirements: 5.5, 8.3, 8.4
 */

// Mock the DynamoDB DocumentClient
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
  },
  BatchGetCommand: jest.fn((input: unknown) => ({ input })),
}));

import { handler, PartsLookupRequest } from '../../src/lambdas/parts-lookup/index';

describe('Parts Lookup Lambda', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, PARTS_TABLE_NAME: 'test-parts-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should return found parts with availability_status and estimated_lead_time_days', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-PT-1001', availability_status: 'in_stock', estimated_lead_time_days: 0 },
          { part_number: 'VSI-EV-2001', availability_status: 'backordered', estimated_lead_time_days: 45 },
        ],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001', 'VSI-EV-2001'],
      submission_id: 'test-submission-123',
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual({
      part_number: 'VSI-PT-1001',
      availability_status: 'in_stock',
      estimated_lead_time_days: 0,
    });
    expect(result.parts[1]).toEqual({
      part_number: 'VSI-EV-2001',
      availability_status: 'backordered',
      estimated_lead_time_days: 45,
    });
  });

  it('should return not_found for parts that do not exist in DynamoDB', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-PT-1001', availability_status: 'in_stock', estimated_lead_time_days: 2 },
        ],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001', 'NONEXISTENT-PART'],
      submission_id: 'test-sub',
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual({
      part_number: 'VSI-PT-1001',
      availability_status: 'in_stock',
      estimated_lead_time_days: 2,
    });
    expect(result.parts[1]).toEqual({
      part_number: 'NONEXISTENT-PART',
      availability_status: 'not_found',
    });
    // not_found entries should NOT have estimated_lead_time_days
    expect(result.parts[1]).not.toHaveProperty('estimated_lead_time_days');
  });

  it('should return empty array when given an empty part_numbers list', async () => {
    const event: PartsLookupRequest = {
      part_numbers: [],
      submission_id: 'test-sub',
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should throw error when part_numbers exceeds 50', async () => {
    const event: PartsLookupRequest = {
      part_numbers: Array.from({ length: 51 }, (_, i) => `PART-${i}`),
      submission_id: 'test-sub',
    };

    await expect(handler(event)).rejects.toThrow('Cannot request more than 50 part numbers');
  });

  it('should throw error when part_numbers is not an array', async () => {
    const event = {
      part_numbers: null,
      submission_id: 'test-sub',
    } as unknown as PartsLookupRequest;

    await expect(handler(event)).rejects.toThrow('part_numbers must be a non-empty array');
  });

  it('should throw error when PARTS_TABLE_NAME env var is not set', async () => {
    delete process.env.PARTS_TABLE_NAME;

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001'],
      submission_id: 'test-sub',
    };

    await expect(handler(event)).rejects.toThrow('PARTS_TABLE_NAME environment variable is required');
  });

  it('should handle duplicate part numbers in input', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-PT-1001', availability_status: 'in_stock', estimated_lead_time_days: 0 },
        ],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001', 'VSI-PT-1001'],
      submission_id: 'test-sub',
    };

    const result = await handler(event);

    // Response should have one entry per originally requested part number
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].part_number).toBe('VSI-PT-1001');
    expect(result.parts[1].part_number).toBe('VSI-PT-1001');
  });

  it('should return all not_found when none of the parts exist', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['FAKE-001', 'FAKE-002', 'FAKE-003'],
      submission_id: 'test-sub',
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(3);
    for (const part of result.parts) {
      expect(part.availability_status).toBe('not_found');
      expect(part).not.toHaveProperty('estimated_lead_time_days');
    }
  });

  it('should handle unprocessed keys with retry', async () => {
    // First call returns some results and unprocessed keys
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-PT-1001', availability_status: 'in_stock', estimated_lead_time_days: 0 },
        ],
      },
      UnprocessedKeys: {
        'test-parts-table': {
          Keys: [{ part_number: 'VSI-EV-2001' }],
        },
      },
    });

    // Retry succeeds
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-EV-2001', availability_status: 'discontinued', estimated_lead_time_days: 365 },
        ],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001', 'VSI-EV-2001'],
      submission_id: 'test-sub',
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].availability_status).toBe('in_stock');
    expect(result.parts[1].availability_status).toBe('discontinued');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should work without submission_id (defaults to unknown)', async () => {
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-parts-table': [
          { part_number: 'VSI-PT-1001', availability_status: 'in_stock', estimated_lead_time_days: 1 },
        ],
      },
      UnprocessedKeys: {},
    });

    const event: PartsLookupRequest = {
      part_numbers: ['VSI-PT-1001'],
    };

    const result = await handler(event);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].availability_status).toBe('in_stock');
  });
});
