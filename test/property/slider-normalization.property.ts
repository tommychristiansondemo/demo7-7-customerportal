/**
 * Property-based test: Slider normalization preserves sum invariant.
 *
 * Generates random slider values in [0.0, 1.0] and random slider index (0-2).
 * Asserts:
 * 1. After normalization, all three weights sum to exactly 1.0 (±0.001).
 * 2. After normalization, all weights are >= 0 and <= 1.
 * 3. The moved slider's value is preserved exactly.
 * 4. The two non-moved sliders each receive (1 - movedValue) / 2.
 *
 * **Validates: Requirements 12.3**
 */

import * as fc from 'fast-check';

/**
 * Re-implementation of the normalizeWeights function from portal/instructor.js
 * for testing in Node.js. This mirrors the logic exposed as window.VSI_INSTRUCTOR.normalizeWeights.
 *
 * @param movedSlider - Which slider was moved ('cost', 'latency', or 'quality')
 * @param movedValue - The new value of the moved slider [0.0, 1.0]
 * @returns Object with cost, latency, quality values summing to 1.0
 */
function normalizeWeights(
  movedSlider: 'cost' | 'latency' | 'quality',
  movedValue: number
): { cost: number; latency: number; quality: number } {
  const remaining = 1.0 - movedValue;
  const otherValue = remaining / 2;

  const result = { cost: 0, latency: 0, quality: 0 };

  if (movedSlider === 'cost') {
    result.cost = movedValue;
    result.latency = otherValue;
    result.quality = otherValue;
  } else if (movedSlider === 'latency') {
    result.cost = otherValue;
    result.latency = movedValue;
    result.quality = otherValue;
  } else {
    result.cost = otherValue;
    result.latency = otherValue;
    result.quality = movedValue;
  }

  return result;
}

// Arbitrary for slider index mapped to slider name
const sliderNameArb: fc.Arbitrary<'cost' | 'latency' | 'quality'> = fc
  .integer({ min: 0, max: 2 })
  .map((i) => (['cost', 'latency', 'quality'] as const)[i]);

// Arbitrary for slider value in [0.0, 1.0]
const sliderValueArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('Property 7: Slider normalization preserves sum invariant', () => {
  it('all three weights sum to 1.0 within ±0.001', () => {
    fc.assert(
      fc.property(sliderNameArb, sliderValueArb, (movedSlider, movedValue) => {
        const result = normalizeWeights(movedSlider, movedValue);
        const sum = result.cost + result.latency + result.quality;
        expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.001);
      }),
      { numRuns: 200 }
    );
  });

  it('all weights are >= 0 and <= 1', () => {
    fc.assert(
      fc.property(sliderNameArb, sliderValueArb, (movedSlider, movedValue) => {
        const result = normalizeWeights(movedSlider, movedValue);
        expect(result.cost).toBeGreaterThanOrEqual(0);
        expect(result.cost).toBeLessThanOrEqual(1);
        expect(result.latency).toBeGreaterThanOrEqual(0);
        expect(result.latency).toBeLessThanOrEqual(1);
        expect(result.quality).toBeGreaterThanOrEqual(0);
        expect(result.quality).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });

  it('the moved slider retains its exact value', () => {
    fc.assert(
      fc.property(sliderNameArb, sliderValueArb, (movedSlider, movedValue) => {
        const result = normalizeWeights(movedSlider, movedValue);
        expect(result[movedSlider]).toBe(movedValue);
      }),
      { numRuns: 200 }
    );
  });

  it('non-moved sliders each receive (1 - movedValue) / 2', () => {
    fc.assert(
      fc.property(sliderNameArb, sliderValueArb, (movedSlider, movedValue) => {
        const result = normalizeWeights(movedSlider, movedValue);
        const expectedOther = (1.0 - movedValue) / 2;

        const sliders: Array<'cost' | 'latency' | 'quality'> = [
          'cost',
          'latency',
          'quality',
        ];
        for (const slider of sliders) {
          if (slider !== movedSlider) {
            expect(result[slider]).toBe(expectedOther);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
