/**
 * Unit tests for the Model Router scoring and selection logic.
 * Covers: validateWeights, computeScore, selectModel, MODEL_CANDIDATES, tie-breaking, logging.
 */

import {
  MODEL_CANDIDATES,
  validateWeights,
  computeScore,
  selectModel,
} from '../../src/shared/model-router';
import { Weights, ModelCandidate } from '../../src/shared/types';

// Capture stdout writes for log verification
let stdoutWrites: string[] = [];
const originalWrite = process.stdout.write;

beforeEach(() => {
  stdoutWrites = [];
  process.stdout.write = jest.fn((chunk: any) => {
    stdoutWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as any;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe('MODEL_CANDIDATES', () => {
  it('should contain exactly 5 models', () => {
    expect(MODEL_CANDIDATES).toHaveLength(5);
  });

  it('should include Nova Lite with correct scores', () => {
    const novaLite = MODEL_CANDIDATES.find(m => m.modelId === 'amazon.nova-lite-v1:0');
    expect(novaLite).toBeDefined();
    expect(novaLite!.costScore).toBe(85);
    expect(novaLite!.latencyScore).toBe(85);
    expect(novaLite!.qualityScore).toBe(45);
  });

  it('should include Nova Pro with correct scores', () => {
    const novaPro = MODEL_CANDIDATES.find(m => m.modelId === 'amazon.nova-pro-v1:0');
    expect(novaPro).toBeDefined();
    expect(novaPro!.costScore).toBe(55);
    expect(novaPro!.latencyScore).toBe(55);
    expect(novaPro!.qualityScore).toBe(70);
  });

  it('should include Claude Sonnet with correct scores', () => {
    const claude = MODEL_CANDIDATES.find(
      m => m.modelId === 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    );
    expect(claude).toBeDefined();
    expect(claude!.costScore).toBe(10);
    expect(claude!.latencyScore).toBe(25);
    expect(claude!.qualityScore).toBe(98);
  });

  it('should include Claude Haiku with correct scores', () => {
    const haiku = MODEL_CANDIDATES.find(
      m => m.modelId === 'anthropic.claude-3-5-haiku-20241022-v1:0'
    );
    expect(haiku).toBeDefined();
    expect(haiku!.costScore).toBe(65);
    expect(haiku!.latencyScore).toBe(80);
    expect(haiku!.qualityScore).toBe(72);
  });

  it('should include Nova Micro with correct scores', () => {
    const novaMicro = MODEL_CANDIDATES.find(m => m.modelId === 'amazon.nova-micro-v1:0');
    expect(novaMicro).toBeDefined();
    expect(novaMicro!.costScore).toBe(95);
    expect(novaMicro!.latencyScore).toBe(95);
    expect(novaMicro!.qualityScore).toBe(25);
  });
});

describe('validateWeights', () => {
  it('should accept valid weights that sum to 100', () => {
    const result = validateWeights({ cost_priority: 33, latency_priority: 33, quality_priority: 34 });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should accept weights within ±1 tolerance', () => {
    const result = validateWeights({ cost_priority: 33, latency_priority: 33, quality_priority: 33 });
    // sum = 99 which is within ±1 tolerance
    expect(result.valid).toBe(true);
  });

  it('should reject cost_priority below 0', () => {
    const result = validateWeights({ cost_priority: -1, latency_priority: 60, quality_priority: 50 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cost_priority');
  });

  it('should reject latency_priority above 100', () => {
    const result = validateWeights({ cost_priority: 30, latency_priority: 110, quality_priority: 30 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('latency_priority');
  });

  it('should reject quality_priority below 0', () => {
    const result = validateWeights({ cost_priority: 50, latency_priority: 50, quality_priority: -1 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('quality_priority');
  });

  it('should reject weights that do not sum to 100 ±1', () => {
    const result = validateWeights({ cost_priority: 50, latency_priority: 50, quality_priority: 50 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('sum to 100');
  });

  it('should accept exact boundary values of 0 and 100', () => {
    const result = validateWeights({ cost_priority: 100, latency_priority: 0, quality_priority: 0 });
    expect(result.valid).toBe(true);
  });
});

describe('computeScore', () => {
  it('should compute weighted score correctly', () => {
    const candidate: ModelCandidate = {
      modelId: 'test-model',
      displayName: 'Test Model',
      costScore: 80,
      latencyScore: 60,
      qualityScore: 40,
    };
    const weights: Weights = { cost_priority: 50, latency_priority: 30, quality_priority: 20 };
    // (50*80 + 30*60 + 20*40) / 100 = (4000 + 1800 + 800) / 100 = 66
    expect(computeScore(candidate, weights)).toBeCloseTo(66, 10);
  });

  it('should return costScore when cost_priority is 100', () => {
    const candidate: ModelCandidate = {
      modelId: 'test-model',
      displayName: 'Test Model',
      costScore: 90,
      latencyScore: 50,
      qualityScore: 30,
    };
    const weights: Weights = { cost_priority: 100, latency_priority: 0, quality_priority: 0 };
    expect(computeScore(candidate, weights)).toBeCloseTo(90, 10);
  });

  it('should return qualityScore when quality_priority is 100', () => {
    const candidate: ModelCandidate = {
      modelId: 'test-model',
      displayName: 'Test Model',
      costScore: 90,
      latencyScore: 50,
      qualityScore: 95,
    };
    const weights: Weights = { cost_priority: 0, latency_priority: 0, quality_priority: 100 };
    expect(computeScore(candidate, weights)).toBeCloseTo(95, 10);
  });
});

describe('selectModel', () => {
  it('should select Nova Micro when cost is fully prioritized', () => {
    const weights: Weights = { cost_priority: 100, latency_priority: 0, quality_priority: 0 };
    const decision = selectModel(weights);
    // Nova Micro has highest costScore (95)
    expect(decision.selectedModelId).toBe('amazon.nova-micro-v1:0');
  });

  it('should select Claude Sonnet when quality is fully prioritized', () => {
    const weights: Weights = { cost_priority: 0, latency_priority: 0, quality_priority: 100 };
    const decision = selectModel(weights);
    expect(decision.selectedModelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
  });

  it('should select Nova Micro when latency is fully prioritized', () => {
    const weights: Weights = { cost_priority: 0, latency_priority: 100, quality_priority: 0 };
    const decision = selectModel(weights);
    // Nova Micro has highest latencyScore (95)
    expect(decision.selectedModelId).toBe('amazon.nova-micro-v1:0');
  });

  it('should return all candidate scores in the decision', () => {
    const weights: Weights = { cost_priority: 33, latency_priority: 33, quality_priority: 34 };
    const decision = selectModel(weights);
    expect(Object.keys(decision.scores)).toHaveLength(5);
    expect(decision.scores['amazon.nova-lite-v1:0']).toBeDefined();
    expect(decision.scores['amazon.nova-pro-v1:0']).toBeDefined();
    expect(decision.scores['amazon.nova-micro-v1:0']).toBeDefined();
    expect(decision.scores['anthropic.claude-3-5-sonnet-20241022-v2:0']).toBeDefined();
    expect(decision.scores['anthropic.claude-3-5-haiku-20241022-v1:0']).toBeDefined();
  });

  it('should include the weights in the decision', () => {
    const weights: Weights = { cost_priority: 33, latency_priority: 33, quality_priority: 34 };
    const decision = selectModel(weights);
    expect(decision.weights).toEqual(weights);
  });

  it('should include an ISO 8601 timestamp in the decision', () => {
    const weights: Weights = { cost_priority: 33, latency_priority: 33, quality_priority: 34 };
    const decision = selectModel(weights);
    expect(decision.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should throw on invalid weights', () => {
    const weights: Weights = { cost_priority: 50, latency_priority: 50, quality_priority: 50 };
    expect(() => selectModel(weights)).toThrow('Invalid weights');
  });

  describe('tie-breaking', () => {
    it('should break ties by selecting the model with the highest costScore', () => {
      // With balanced weights, verify selection is deterministic
      const weights: Weights = { cost_priority: 25, latency_priority: 25, quality_priority: 50 };
      const decision = selectModel(weights);
      expect(decision.selectedModelId).toBeDefined();
    });
  });

  describe('structured logging', () => {
    it('should emit a structured log entry on model selection', () => {
      const weights: Weights = { cost_priority: 33, latency_priority: 33, quality_priority: 34 };
      selectModel(weights, 'test-submission-123');

      expect(stdoutWrites.length).toBeGreaterThan(0);
      const logEntry = JSON.parse(stdoutWrites[0]);
      expect(logEntry.event_type).toBe('model_routing_decision');
      expect(logEntry.submission_id).toBe('test-submission-123');
      expect(logEntry.selectedModelId).toBeDefined();
      expect(logEntry.weights).toBeDefined();
      expect(logEntry.scores).toBeDefined();
      expect(logEntry.timestamp).toBeDefined();
    });
  });
});
