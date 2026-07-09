/**
 * Property-based test: Model Router selects the highest-scoring candidate.
 *
 * Generates random valid weight triples summing to 100 and asserts:
 * 1. The selected model always has the highest computed score.
 * 2. In the event of a tie, the selected model has the highest costScore.
 *
 * **Validates: Requirements 11.3, 11.4**
 */

import * as fc from 'fast-check';
import {
  selectModel,
  computeScore,
  MODEL_CANDIDATES,
} from '../../src/shared/model-router';
import { Weights } from '../../src/shared/types';

// Suppress stdout during property tests (logger writes to stdout)
beforeAll(() => {
  process.stdout.write = jest.fn(() => true) as any;
});

/**
 * Arbitrary that generates valid weight triples summing to 100.
 * Strategy: generate two integers a, b in [0, 100], sort them, then
 * weights = [a, b - a, 100 - b]. This ensures all three are in [0, 100]
 * and they sum exactly to 100.
 */
const validWeightsArb: fc.Arbitrary<Weights> = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 })
  )
  .map(([x, y]) => {
    const sorted = [x, y].sort((a, b) => a - b);
    const a = sorted[0];
    const b = sorted[1];
    return {
      cost_priority: a,
      latency_priority: b - a,
      quality_priority: 100 - b,
    };
  })
  .filter((w) => {
    // Ensure all values are in [0, 100] and sum is within tolerance
    const sum = w.cost_priority + w.latency_priority + w.quality_priority;
    return (
      w.cost_priority >= 0 &&
      w.cost_priority <= 100 &&
      w.latency_priority >= 0 &&
      w.latency_priority <= 100 &&
      w.quality_priority >= 0 &&
      w.quality_priority <= 100 &&
      Math.abs(sum - 100) <= 1
    );
  });

describe('Property 1: Model Router selects the highest-scoring candidate', () => {
  it('selected model always has the highest computed score', () => {
    fc.assert(
      fc.property(validWeightsArb, (weights: Weights) => {
        const decision = selectModel(weights);

        // Compute scores for all candidates
        const scores = MODEL_CANDIDATES.map((candidate) => ({
          modelId: candidate.modelId,
          score: computeScore(candidate, weights),
          costScore: candidate.costScore,
        }));

        // Find the maximum score
        const maxScore = Math.max(...scores.map((s) => s.score));

        // The selected model's score must equal the maximum
        const selectedScore = scores.find(
          (s) => s.modelId === decision.selectedModelId
        );
        expect(selectedScore).toBeDefined();
        expect(selectedScore!.score).toBeCloseTo(maxScore, 10);
      }),
      { numRuns: 200 }
    );
  });

  it('tie-breaking selects the model with the highest costScore', () => {
    fc.assert(
      fc.property(validWeightsArb, (weights: Weights) => {
        const decision = selectModel(weights);

        // Compute scores for all candidates
        const scores = MODEL_CANDIDATES.map((candidate) => ({
          modelId: candidate.modelId,
          score: computeScore(candidate, weights),
          costScore: candidate.costScore,
        }));

        // Find the maximum score
        const maxScore = Math.max(...scores.map((s) => s.score));

        // Get all candidates tied at the maximum score
        const tiedCandidates = scores.filter(
          (s) => Math.abs(s.score - maxScore) < 0.001
        );

        if (tiedCandidates.length > 1) {
          // Among tied candidates, the selected one should have the highest costScore
          const maxCostScoreAmongTied = Math.max(
            ...tiedCandidates.map((c) => c.costScore)
          );
          const selectedCandidate = tiedCandidates.find(
            (c) => c.modelId === decision.selectedModelId
          );
          expect(selectedCandidate).toBeDefined();
          expect(selectedCandidate!.costScore).toBe(maxCostScoreAmongTied);
        }
      }),
      { numRuns: 200 }
    );
  });
});
