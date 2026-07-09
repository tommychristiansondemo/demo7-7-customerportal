/**
 * Warranty Rules Lambda — MCP Tool
 *
 * Determines warranty coverage based on vehicle model year and synthetic mileage
 * derived deterministically from the telematics ID.
 *
 * Rules:
 *  1. New Vehicle Limited: model year ≤3 years from current year AND mileage < 36,000
 *  2. Powertrain: model year ≤5 years from current year AND mileage < 60,000
 *  3. Not Covered: all other cases
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { createLogger } from '../../shared/logger';
import { WarrantyResult, WarrantyStatus, WarrantyType } from '../../shared/types';

/**
 * Computes a deterministic numeric hash from a string.
 * Sums character codes multiplied by position-based primes for distribution.
 */
export function numericHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return hash;
}

/**
 * Computes synthetic mileage deterministically from a telematics ID.
 * Returns a value in the range [0, 99999].
 */
export function computeSyntheticMileage(telematicsId: string): number {
  return numericHash(telematicsId) % 100_000;
}

/**
 * Determines warranty coverage based on vehicle age and synthetic mileage.
 */
export function determineWarranty(
  modelYear: number,
  telematicsId: string,
  currentYear?: number
): WarrantyResult {
  const year = currentYear ?? new Date().getFullYear();
  const vehicleAge = year - modelYear;
  const syntheticMileage = computeSyntheticMileage(telematicsId);

  // Rule 1: New Vehicle Limited Warranty (≤3 years AND <36,000 miles)
  if (vehicleAge <= 3 && syntheticMileage < 36_000) {
    return {
      warrantyStatus: 'covered' as WarrantyStatus,
      applicableWarrantyType: 'new_vehicle_limited' as WarrantyType,
      coverageDetails:
        `Vehicle is covered under New Vehicle Limited Warranty. ` +
        `Vehicle age: ${vehicleAge} year(s), synthetic mileage: ${syntheticMileage.toLocaleString()} miles. ` +
        `Coverage applies for vehicles within 3 years and under 36,000 miles.`,
      syntheticMileage,
    };
  }

  // Rule 2: Powertrain Warranty (≤5 years AND <60,000 miles)
  if (vehicleAge <= 5 && syntheticMileage < 60_000) {
    return {
      warrantyStatus: 'partially_covered' as WarrantyStatus,
      applicableWarrantyType: 'powertrain' as WarrantyType,
      coverageDetails:
        `Vehicle is covered under Powertrain Warranty. ` +
        `Vehicle age: ${vehicleAge} year(s), synthetic mileage: ${syntheticMileage.toLocaleString()} miles. ` +
        `Coverage applies for vehicles within 5 years and under 60,000 miles.`,
      syntheticMileage,
    };
  }

  // Rule 3: Not Covered
  return {
    warrantyStatus: 'not_covered' as WarrantyStatus,
    applicableWarrantyType: 'none' as WarrantyType,
    coverageDetails:
      `No warranty coverage applies. ` +
      `Vehicle age: ${vehicleAge} year(s), synthetic mileage: ${syntheticMileage.toLocaleString()} miles. ` +
      `Vehicle exceeds warranty limits (3 years/36,000 mi for new vehicle limited; 5 years/60,000 mi for powertrain).`,
    syntheticMileage,
  };
}

/**
 * Lambda handler for the Warranty Rules MCP tool.
 * Expects event with telematicsId and modelYear fields.
 */
export const handler = async (event: Record<string, unknown>): Promise<WarrantyResult> => {
  const submissionId = (event.submissionId as string) || 'unknown';
  const logger = createLogger(submissionId);

  logger.info('mcp_tool_call_initiated', { tool: 'warranty_rules' });

  const telematicsId = event.telematicsId as string | undefined;
  const modelYear = event.modelYear as number | undefined;

  // Handle missing or invalid inputs
  if (!telematicsId || typeof telematicsId !== 'string' || telematicsId.trim() === '') {
    logger.warn('mcp_tool_call_completed', {
      tool: 'warranty_rules',
      result: 'not_covered',
      reason: 'missing_telematics_id',
    });
    return {
      warrantyStatus: 'not_covered',
      applicableWarrantyType: 'none',
      coverageDetails: 'Unable to determine warranty: missing or invalid vehicle data',
      syntheticMileage: 0,
    };
  }

  if (
    modelYear === undefined ||
    modelYear === null ||
    typeof modelYear !== 'number' ||
    !Number.isFinite(modelYear) ||
    !Number.isInteger(modelYear) ||
    modelYear < 1900 ||
    modelYear > 2100
  ) {
    logger.warn('mcp_tool_call_completed', {
      tool: 'warranty_rules',
      result: 'not_covered',
      reason: 'missing_or_invalid_model_year',
      providedModelYear: modelYear,
    });
    return {
      warrantyStatus: 'not_covered',
      applicableWarrantyType: 'none',
      coverageDetails: 'Unable to determine warranty: missing or invalid vehicle data',
      syntheticMileage: computeSyntheticMileage(telematicsId),
    };
  }

  const result = determineWarranty(modelYear, telematicsId);

  logger.info('mcp_tool_call_completed', {
    tool: 'warranty_rules',
    warrantyStatus: result.warrantyStatus,
    applicableWarrantyType: result.applicableWarrantyType,
    syntheticMileage: result.syntheticMileage,
    modelYear,
    telematicsId,
  });

  return result;
};
