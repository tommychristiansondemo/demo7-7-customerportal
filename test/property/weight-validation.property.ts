/**
 * Property-based tests for weight validation in the Model Router.
 *
 * **Validates: Requirements 11.6, 11.8**
 *
 * Property 2: Weight validation accepts valid triples and rejects invalid ones.
 * For any triple (a, b, c): if all three are in [0, 100] and |a + b + c - 100| ≤ 1,
 * the validator SHALL accept; otherwise the validator SHALL reject.
 */

import * as fc from 'fast-check';
import { validateWeights } from '../../src/shared/model-router';
import { Weights } from '../../src/shared/types';

const NUM_RUNS = 100;

describe('Property 2: Weight validation accepts valid triples and rejects invalid ones', () => {
  /**
   * Valid triples are always accepted.
   *
   * Strategy: generate two random integers in [0, 100], sort them, compute differences
   * to get three non-negative integers that sum exactly to 100.
   */
  it('valid triples (each in [0,100], sum = 100) are always accepted', () => {
    const validWeightsArb = fc
      .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
      .map(([a, b]) => {
        const sorted = [a, b].sort((x, y) => x - y);
        const w1 = sorted[0];
        const w2 = sorted[1] - sorted[0];
        const w3 = 100 - sorted[1];
        return { cost_priority: w1, latency_priority: w2, quality_priority: w3 } as Weights;
      })
      .filter((w) => {
        return (
          w.cost_priority >= 0 &&
          w.cost_priority <= 100 &&
          w.latency_priority >= 0 &&
          w.latency_priority <= 100 &&
          w.quality_priority >= 0 &&
          w.quality_priority <= 100 &&
          Math.abs(w.cost_priority + w.latency_priority + w.quality_priority - 100) <= 1
        );
      });

    fc.assert(
      fc.property(validWeightsArb, (weights) => {
        const result = validateWeights(weights);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: NUM_RUNS }
    );
  });

  /**
   * Invalid triples where at least one value is out of range (< 0 or > 100) are always rejected.
   */
  it('triples with at least one value out of [0,100] are always rejected', () => {
    // Generate a value that is either negative or greater than 100
    const outOfRangeValue = fc.oneof(
      fc.integer({ min: -1000, max: -1 }),
      fc.integer({ min: 101, max: 1000 })
    );

    // Generate a position (0, 1, or 2) for where the out-of-range value goes
    const invalidOutOfRangeArb = fc
      .tuple(
        outOfRangeValue,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 2 })
      )
      .map(([bad, a, b, pos]) => {
        const values = [a, b, a]; // placeholder
        values[pos] = bad;
        if (pos === 0) {
          values[1] = a;
          values[2] = b;
        } else if (pos === 1) {
          values[0] = a;
          values[2] = b;
        } else {
          values[0] = a;
          values[1] = b;
        }
        return {
          cost_priority: values[0],
          latency_priority: values[1],
          quality_priority: values[2],
        } as Weights;
      });

    fc.assert(
      fc.property(invalidOutOfRangeArb, (weights) => {
        const result = validateWeights(weights);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: NUM_RUNS }
    );
  });

  /**
   * Invalid triples where each value is in [0,100] but they do NOT sum to 100 (±1)
   * are always rejected.
   */
  it('triples in [0,100] that do not sum to 100 (±1) are always rejected', () => {
    const invalidSumArb = fc
      .tuple(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 })
      )
      .filter(([a, b, c]) => {
        // All in [0,100] but sum is NOT within ±1 of 100
        return Math.abs(a + b + c - 100) > 1;
      })
      .map(([a, b, c]) => ({
        cost_priority: a,
        latency_priority: b,
        quality_priority: c,
      }));

    fc.assert(
      fc.property(invalidSumArb, (weights) => {
        const result = validateWeights(weights);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
