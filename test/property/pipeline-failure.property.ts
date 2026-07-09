/**
 * Property-based test: Pipeline failure at any stage halts subsequent execution.
 *
 * Generates random failure positions (1-5) and asserts:
 * 1. Stages AFTER the failed stage are never executed (no publishStatus calls for subsequent stages).
 * 2. An error status message is published for the failed stage.
 * 3. Stages BEFORE the failed stage complete normally (completed status published).
 *
 * **Validates: Requirements 5.8, 5.9**
 */

import * as fc from 'fast-check';

// --- Mock setup ---

const mockLambdaSend = jest.fn();
const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: mockLambdaSend,
  })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({
    ...input,
    _type: 'InvokeCommand',
  })),
}));

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockBedrockSend,
  })),
  InvokeAgentCommand: jest.fn().mockImplementation((input) => ({
    ...input,
    _type: 'InvokeAgentCommand',
  })),
}));

// Mock the model router to return a deterministic decision
jest.mock('../../src/shared/model-router', () => ({
  selectModel: jest.fn(() => ({
    selectedModelId: 'amazon.nova-lite-v1:0',
    scores: { 'amazon.nova-lite-v1:0': 0.8 },
    weights: { cost_priority: 0.33, latency_priority: 0.33, quality_priority: 0.34 },
    timestamp: new Date().toISOString(),
  })),
}));

// Mock the logger
jest.mock('../../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

// Mock global fetch for AppConfig extension
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        cost_priority: 0.33,
        latency_priority: 0.33,
        quality_priority: 0.34,
      }),
  } as any)
);

// Set environment variables
process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:agent-runtime/test-agent';
process.env.WEBSOCKET_PUBLISHER_FUNCTION_NAME = 'test-ws-publisher';
process.env.KNOWLEDGE_BASE_ID = 'test-kb-id';

import { handler, PipelineOrchestratorEvent } from '../../src/lambdas/pipeline-orchestrator/index';

// --- Constants ---

const STAGE_NAMES = [
  'Triage',
  'Diagnostic Research',
  'Parts & Logistics',
  'Warranty Determination',
  'Summary',
] as const;

// Suppress stdout during property tests (logger writes to stdout)
beforeAll(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// --- Helpers ---

/**
 * Creates a mock async iterable to simulate streamed agent response.
 */
function createMockCompletion(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { chunk: { bytes: new TextEncoder().encode(text) } };
    },
  };
}

/**
 * Tracks all publishStatus calls by examining Lambda invoke commands.
 */
function extractPublishedStatuses(calls: any[]): Array<{ stage: string; status: string; errorReason?: string }> {
  const statuses: Array<{ stage: string; status: string; errorReason?: string }> = [];

  for (const call of calls) {
    if (call[0]?._type === 'InvokeCommand' && call[0]?.FunctionName === 'test-ws-publisher') {
      try {
        const payload = JSON.parse(Buffer.from(call[0].Payload).toString());
        if (payload.message) {
          statuses.push({
            stage: payload.message.stage,
            status: payload.message.status,
            errorReason: payload.message.errorReason,
          });
        }
      } catch {
        // Skip malformed payloads
      }
    }
  }

  return statuses;
}

// --- Arbitraries ---

/**
 * Generates a random failure stage index (0-4, representing stages 1-5).
 */
const failureStageArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4 });

/**
 * Generates a random error message for the failing stage.
 */
const errorMessageArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// --- Tests ---

describe('Property 6: Pipeline failure at any stage halts subsequent execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no agent at position > K is invoked after failure at K', async () => {
    await fc.assert(
      fc.asyncProperty(
        failureStageArb,
        errorMessageArb,
        async (failureIndex: number, errorMsg: string) => {
          // Clear mock call history between fc iterations
          mockBedrockSend.mockReset();
          mockLambdaSend.mockReset();

          let agentInvocationCount = 0;

          // Mock BedrockAgentRuntimeClient to succeed before failureIndex, fail at failureIndex
          mockBedrockSend.mockImplementation(() => {
            const currentStage = agentInvocationCount;
            agentInvocationCount++;

            if (currentStage === failureIndex) {
              return Promise.reject(new Error(errorMsg));
            }

            // Return a successful response with async iterable completion
            return Promise.resolve({
              completion: createMockCompletion(`Agent stage ${currentStage} output`),
            });
          });

          // Mock Lambda send (WebSocket Publisher) to always succeed
          mockLambdaSend.mockResolvedValue({});

          const event: PipelineOrchestratorEvent = {
            submissionId: 'test-submission-123',
            submission: {
              vehicleModel: 'Sentra EV',
              modelYear: 2023,
              symptomDescription: 'Battery drains quickly',
            },
            syntheticMileage: 25000,
            websocketUrl: 'wss://test.execute-api.us-east-1.amazonaws.com/prod',
          };

          await handler(event);

          // Property: Agent invocations should equal failureIndex + 1
          // (stages 0..failureIndex-1 succeed, stage failureIndex fails, subsequent stages not invoked)
          expect(agentInvocationCount).toBe(failureIndex + 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('error status event is emitted containing the failed stage name and failure reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        failureStageArb,
        errorMessageArb,
        async (failureIndex: number, errorMsg: string) => {
          // Clear mock call history between fc iterations
          mockBedrockSend.mockReset();
          mockLambdaSend.mockReset();

          let agentInvocationCount = 0;

          mockBedrockSend.mockImplementation(() => {
            const currentStage = agentInvocationCount;
            agentInvocationCount++;

            if (currentStage === failureIndex) {
              return Promise.reject(new Error(errorMsg));
            }

            return Promise.resolve({
              completion: createMockCompletion(`Agent stage ${currentStage} output`),
            });
          });

          mockLambdaSend.mockResolvedValue({});

          const event: PipelineOrchestratorEvent = {
            submissionId: 'test-submission-456',
            submission: {
              vehicleModel: 'Altima EV',
              modelYear: 2024,
              symptomDescription: 'Engine warning light',
            },
            syntheticMileage: 15000,
            websocketUrl: 'wss://test.execute-api.us-east-1.amazonaws.com/prod',
          };

          await handler(event);

          // Extract published status messages
          const publishedStatuses = extractPublishedStatuses(mockLambdaSend.mock.calls);

          // Find the error status message
          const errorStatuses = publishedStatuses.filter((s) => s.status === 'error');

          // Property: Exactly one error status should be emitted
          expect(errorStatuses.length).toBe(1);

          // Property: Error status should be for the correct stage
          expect(errorStatuses[0].stage).toBe(STAGE_NAMES[failureIndex]);

          // Property: Error status should contain the failure reason
          expect(errorStatuses[0].errorReason).toBe(errorMsg);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stages before the failed stage complete normally (completed status published)', async () => {
    await fc.assert(
      fc.asyncProperty(
        failureStageArb,
        errorMessageArb,
        async (failureIndex: number, errorMsg: string) => {
          // Clear mock call history between fc iterations
          mockBedrockSend.mockReset();
          mockLambdaSend.mockReset();

          let agentInvocationCount = 0;

          mockBedrockSend.mockImplementation(() => {
            const currentStage = agentInvocationCount;
            agentInvocationCount++;

            if (currentStage === failureIndex) {
              return Promise.reject(new Error(errorMsg));
            }

            return Promise.resolve({
              completion: createMockCompletion(`Agent stage ${currentStage} output`),
            });
          });

          mockLambdaSend.mockResolvedValue({});

          const event: PipelineOrchestratorEvent = {
            submissionId: 'test-submission-789',
            submission: {
              vehicleModel: 'Leaf Pro',
              modelYear: 2022,
              symptomDescription: 'Unusual noise from brakes',
            },
            syntheticMileage: 45000,
            websocketUrl: 'wss://test.execute-api.us-east-1.amazonaws.com/prod',
          };

          await handler(event);

          // Extract published status messages
          const publishedStatuses = extractPublishedStatuses(mockLambdaSend.mock.calls);

          // Stages before failure should have both in_progress and completed statuses
          for (let i = 0; i < failureIndex; i++) {
            const stageStatuses = publishedStatuses.filter((s) => s.stage === STAGE_NAMES[i]);
            const hasInProgress = stageStatuses.some((s) => s.status === 'in_progress');
            const hasCompleted = stageStatuses.some((s) => s.status === 'completed');

            expect(hasInProgress).toBe(true);
            expect(hasCompleted).toBe(true);
          }

          // The failed stage should have in_progress and error, but NOT completed
          const failedStageStatuses = publishedStatuses.filter(
            (s) => s.stage === STAGE_NAMES[failureIndex]
          );
          const failedHasInProgress = failedStageStatuses.some((s) => s.status === 'in_progress');
          const failedHasError = failedStageStatuses.some((s) => s.status === 'error');
          const failedHasCompleted = failedStageStatuses.some((s) => s.status === 'completed');

          expect(failedHasInProgress).toBe(true);
          expect(failedHasError).toBe(true);
          expect(failedHasCompleted).toBe(false);

          // Stages AFTER the failure should have NO status messages at all
          for (let i = failureIndex + 1; i < STAGE_NAMES.length; i++) {
            const subsequentStatuses = publishedStatuses.filter((s) => s.stage === STAGE_NAMES[i]);
            expect(subsequentStatuses.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
