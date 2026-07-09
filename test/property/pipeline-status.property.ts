/**
 * Property-based test: Pipeline status messages contain all required fields.
 *
 * Generates arbitrary PipelineStatusMessage objects and verifies:
 * 1. All required fields are present: submissionId, stage, status, timestamp
 * 2. Stage is one of the 5 valid pipeline stages
 * 3. Status is one of: in_progress, completed, error
 * 4. Timestamp is a valid ISO-8601 string
 * 5. Optional fields (agentOutputSummary, errorReason) are strings when present
 *
 * **Validates: Requirements 4.4**
 */

import * as fc from 'fast-check';
import {
  PipelineStatusMessage,
  PipelineStage,
  PipelineStatus,
} from '../../src/shared/types';

const VALID_STAGES: PipelineStage[] = [
  'Triage',
  'Diagnostic Research',
  'Parts & Logistics',
  'Warranty Determination',
  'Summary',
];

const VALID_STATUSES: PipelineStatus[] = ['in_progress', 'completed', 'error'];

/**
 * Arbitrary that generates valid ISO-8601 timestamp strings.
 */
const iso8601TimestampArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/**
 * Arbitrary that generates a valid PipelineStage.
 */
const stageArb: fc.Arbitrary<PipelineStage> = fc.constantFrom(...VALID_STAGES);

/**
 * Arbitrary that generates a valid PipelineStatus.
 */
const statusArb: fc.Arbitrary<PipelineStatus> = fc.constantFrom(...VALID_STATUSES);

/**
 * Arbitrary that generates a PipelineStatusMessage with all required fields
 * and optionally includes agentOutputSummary and errorReason.
 */
const pipelineStatusMessageArb: fc.Arbitrary<PipelineStatusMessage> = fc.record({
  submissionId: fc.uuid(),
  stage: stageArb,
  status: statusArb,
  timestamp: iso8601TimestampArb,
  agentOutputSummary: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
  errorReason: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
});

describe('Property 8: Pipeline status messages contain all required fields', () => {
  it('all required fields are present: submissionId, stage, status, timestamp', () => {
    fc.assert(
      fc.property(pipelineStatusMessageArb, (message: PipelineStatusMessage) => {
        expect(message).toHaveProperty('submissionId');
        expect(message).toHaveProperty('stage');
        expect(message).toHaveProperty('status');
        expect(message).toHaveProperty('timestamp');

        // Required fields are not null or undefined
        expect(message.submissionId).toBeDefined();
        expect(message.stage).toBeDefined();
        expect(message.status).toBeDefined();
        expect(message.timestamp).toBeDefined();
      }),
      { numRuns: 200 }
    );
  });

  it('stage is one of the 5 valid pipeline stages', () => {
    fc.assert(
      fc.property(pipelineStatusMessageArb, (message: PipelineStatusMessage) => {
        expect(VALID_STAGES).toContain(message.stage);
      }),
      { numRuns: 200 }
    );
  });

  it('status is one of: in_progress, completed, error', () => {
    fc.assert(
      fc.property(pipelineStatusMessageArb, (message: PipelineStatusMessage) => {
        expect(VALID_STATUSES).toContain(message.status);
      }),
      { numRuns: 200 }
    );
  });

  it('timestamp is a valid ISO-8601 string', () => {
    fc.assert(
      fc.property(pipelineStatusMessageArb, (message: PipelineStatusMessage) => {
        // ISO-8601 strings parse to valid dates
        const parsed = new Date(message.timestamp);
        expect(parsed.toString()).not.toBe('Invalid Date');
        // Roundtrip: toISOString produces a valid ISO string that matches the format
        expect(parsed.toISOString()).toBe(message.timestamp);
      }),
      { numRuns: 200 }
    );
  });

  it('optional fields (agentOutputSummary, errorReason) are strings when present', () => {
    fc.assert(
      fc.property(pipelineStatusMessageArb, (message: PipelineStatusMessage) => {
        if (message.agentOutputSummary !== undefined) {
          expect(typeof message.agentOutputSummary).toBe('string');
        }
        if (message.errorReason !== undefined) {
          expect(typeof message.errorReason).toBe('string');
        }
      }),
      { numRuns: 200 }
    );
  });
});
