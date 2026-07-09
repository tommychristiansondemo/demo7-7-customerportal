/**
 * Property-based test: Warranty determination is deterministic and correct.
 *
 * Generates random (modelYear, telematicsId) pairs and asserts:
 * 1. determineWarranty is deterministic — same inputs always produce same output
 * 2. Vehicles within 3 years AND under 36k miles → covered (new_vehicle_limited)
 * 3. Vehicles within 5 years AND under 60k miles → partially_covered (powertrain)
 * 4. All other vehicles → not_covered (none)
 * 5. syntheticMileage is always in range [0, 99999]
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */

import * as fc from 'fast-check';
import {
  determineWarranty,
  computeSyntheticMileage,
} from '../../src/lambdas/warranty-rules/index';

// Use a fixed "current year" so tests are stable regardless of when they run
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Arbitrary for model years in range [1990, 2030]
 */
const modelYearArb = fc.integer({ min: 1990, max: 2030 });

/**
 * Arbitrary for telematics IDs — alphanumeric strings of length 5-30
 */
const telematicsIdArb = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
    fc.constantFrom('-', '_')
  ),
  { minLength: 5, maxLength: 30 }
).filter((s) => s.trim().length > 0);

describe('Property 3: Warranty determination is deterministic and correct', () => {
  it('determineWarranty is deterministic — same inputs always produce same output', () => {
    fc.assert(
      fc.property(modelYearArb, telematicsIdArb, (modelYear, telematicsId) => {
        const result1 = determineWarranty(modelYear, telematicsId, CURRENT_YEAR);
        const result2 = determineWarranty(modelYear, telematicsId, CURRENT_YEAR);

        expect(result1.warrantyStatus).toBe(result2.warrantyStatus);
        expect(result1.applicableWarrantyType).toBe(result2.applicableWarrantyType);
        expect(result1.syntheticMileage).toBe(result2.syntheticMileage);
        expect(result1.coverageDetails).toBe(result2.coverageDetails);
      }),
      { numRuns: 200 }
    );
  });

  it('vehicles within 3 years AND under 36k miles → covered (new_vehicle_limited)', () => {
    // Generate model years within 3 years of current year
    const recentYearArb = fc.integer({ min: CURRENT_YEAR - 3, max: CURRENT_YEAR });

    fc.assert(
      fc.property(recentYearArb, telematicsIdArb, (modelYear, telematicsId) => {
        const mileage = computeSyntheticMileage(telematicsId);
        if (mileage < 36_000) {
          const result = determineWarranty(modelYear, telematicsId, CURRENT_YEAR);
          expect(result.warrantyStatus).toBe('covered');
          expect(result.applicableWarrantyType).toBe('new_vehicle_limited');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('vehicles within 5 years AND under 60k miles but NOT meeting new-vehicle criteria → partially_covered (powertrain)', () => {
    // Generate model years within 5 years of current year
    const midYearArb = fc.integer({ min: CURRENT_YEAR - 5, max: CURRENT_YEAR });

    fc.assert(
      fc.property(midYearArb, telematicsIdArb, (modelYear, telematicsId) => {
        const mileage = computeSyntheticMileage(telematicsId);
        const vehicleAge = CURRENT_YEAR - modelYear;

        // Check that it does NOT meet new-vehicle criteria but DOES meet powertrain
        const meetsNewVehicle = vehicleAge <= 3 && mileage < 36_000;
        const meetsPowertrain = vehicleAge <= 5 && mileage < 60_000;

        if (!meetsNewVehicle && meetsPowertrain) {
          const result = determineWarranty(modelYear, telematicsId, CURRENT_YEAR);
          expect(result.warrantyStatus).toBe('partially_covered');
          expect(result.applicableWarrantyType).toBe('powertrain');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('all other vehicles → not_covered (none)', () => {
    fc.assert(
      fc.property(modelYearArb, telematicsIdArb, (modelYear, telematicsId) => {
        const mileage = computeSyntheticMileage(telematicsId);
        const vehicleAge = CURRENT_YEAR - modelYear;

        const meetsPowertrain = vehicleAge <= 5 && mileage < 60_000;

        if (!meetsPowertrain) {
          const result = determineWarranty(modelYear, telematicsId, CURRENT_YEAR);
          expect(result.warrantyStatus).toBe('not_covered');
          expect(result.applicableWarrantyType).toBe('none');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('syntheticMileage is always in range [0, 99999]', () => {
    fc.assert(
      fc.property(telematicsIdArb, (telematicsId) => {
        const mileage = computeSyntheticMileage(telematicsId);
        expect(mileage).toBeGreaterThanOrEqual(0);
        expect(mileage).toBeLessThanOrEqual(99_999);
      }),
      { numRuns: 500 }
    );
  });
});
