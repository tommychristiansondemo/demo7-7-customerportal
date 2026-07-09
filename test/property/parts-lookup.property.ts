/**
 * Property-based test: Parts lookup returns correct status for all requested part numbers.
 *
 * Generates random part number arrays (1-50 items), mocks DynamoDB BatchGetCommand
 * to return some parts as found and some as not found, and asserts:
 * 1. Every requested part number appears in the response.
 * 2. Found parts have status in {in_stock, backordered, discontinued}.
 * 3. Parts not in DynamoDB get status "not_found".
 * 4. Response length equals input length.
 *
 * **Validates: Requirements 8.3, 8.4**
 */

import * as fc from 'fast-check';

// Mock the DynamoDB send function at the module level
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: mockSend,
    }),
  },
  BatchGetCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

import { handler, PartsLookupResponse } from '../../src/lambdas/parts-lookup/index';

// Suppress stdout during property tests (logger writes to stdout)
beforeAll(() => {
  process.env.PARTS_TABLE_NAME = 'test-parts-table';
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockSend.mockReset();
});

const VALID_STATUSES = ['in_stock', 'backordered', 'discontinued'] as const;

/**
 * Arbitrary that generates a valid part number string (alphanumeric with dashes, 5-20 chars).
 */
const partNumberArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
  { minLength: 5, maxLength: 20 }
).filter((s) => s.length >= 5 && /[A-Z0-9]/.test(s));

/**
 * Arbitrary that generates a list of 1-50 part numbers.
 */
const partNumberListArb = fc.array(partNumberArb, { minLength: 1, maxLength: 50 });

/**
 * Arbitrary that generates a valid availability status for found parts.
 */
const availabilityStatusArb = fc.constantFrom(...VALID_STATUSES);

describe('Property 4: Parts lookup returns correct status for all requested part numbers', () => {
  it('response length equals input length and every part number is present', async () => {
    await fc.assert(
      fc.asyncProperty(
        partNumberListArb,
        fc.func(fc.boolean()),
        async (partNumbers, existsFunc) => {
          // Determine which parts "exist" in DynamoDB using the generated function
          const uniqueParts = [...new Set(partNumbers)];
          const existingParts = new Set(
            uniqueParts.filter((_, i) => existsFunc(i))
          );

          // Build mock DynamoDB response for existing parts
          const mockItems = Array.from(existingParts).map((pn) => ({
            part_number: pn,
            availability_status: VALID_STATUSES[Math.abs(hashCode(pn)) % VALID_STATUSES.length],
            estimated_lead_time_days: Math.abs(hashCode(pn)) % 366,
          }));

          mockSend.mockResolvedValue({
            Responses: {
              'test-parts-table': mockItems,
            },
            UnprocessedKeys: {},
          });

          const response: PartsLookupResponse = await handler({
            part_numbers: partNumbers,
            submission_id: 'test-prop-4',
          });

          // Assert: response length equals input length
          expect(response.parts.length).toBe(partNumbers.length);

          // Assert: every requested part number appears in the response
          const responsePartNumbers = response.parts.map((p) => p.part_number);
          for (const pn of partNumbers) {
            expect(responsePartNumbers).toContain(pn);
          }

          // Assert: found parts have status in {in_stock, backordered, discontinued}
          for (const part of response.parts) {
            if (existingParts.has(part.part_number)) {
              expect(VALID_STATUSES).toContain(part.availability_status);
              expect(part.estimated_lead_time_days).toBeDefined();
              expect(typeof part.estimated_lead_time_days).toBe('number');
            }
          }

          // Assert: parts not in DynamoDB get status "not_found"
          for (const part of response.parts) {
            if (!existingParts.has(part.part_number)) {
              expect(part.availability_status).toBe('not_found');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('found parts have valid status values and not_found parts have no extra fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        partNumberListArb,
        fc.integer({ min: 0, max: 100 }),
        async (partNumbers, existPercentSeed) => {
          const uniqueParts = [...new Set(partNumbers)];
          const existPercent = existPercentSeed / 100;

          // Determine which parts exist based on a percentage threshold
          const existingParts = new Set(
            uniqueParts.filter((_, i) => i / uniqueParts.length < existPercent)
          );

          const mockItems = Array.from(existingParts).map((pn) => ({
            part_number: pn,
            availability_status: VALID_STATUSES[Math.abs(hashCode(pn)) % VALID_STATUSES.length],
            estimated_lead_time_days: Math.abs(hashCode(pn)) % 366,
          }));

          mockSend.mockResolvedValue({
            Responses: {
              'test-parts-table': mockItems,
            },
            UnprocessedKeys: {},
          });

          const response: PartsLookupResponse = await handler({
            part_numbers: partNumbers,
            submission_id: 'test-prop-4-status',
          });

          for (const part of response.parts) {
            if (existingParts.has(part.part_number)) {
              // Found parts must have a valid status
              expect(['in_stock', 'backordered', 'discontinued']).toContain(
                part.availability_status
              );
            } else {
              // Not found parts must have status "not_found" and no estimated_lead_time_days
              expect(part.availability_status).toBe('not_found');
              expect(part.estimated_lead_time_days).toBeUndefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Simple hash function for deterministic status/lead time assignment in tests.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}
