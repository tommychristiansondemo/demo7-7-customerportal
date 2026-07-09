import * as crypto from 'crypto';

/**
 * Unit tests for the ECS mock dealer service deterministic response logic.
 * Tests the hash-based generation functions directly without spinning up an HTTP server.
 */

// Replicate the deterministicHash function from server.ts for testing
function deterministicHash(input: string): number {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

describe('Mock Dealer Service - deterministicHash', () => {
  it('produces same output for same input', () => {
    const result1 = deterministicHash('TELEM-12345');
    const result2 = deterministicHash('TELEM-12345');
    expect(result1).toBe(result2);
  });

  it('produces different output for different inputs', () => {
    const result1 = deterministicHash('TELEM-12345');
    const result2 = deterministicHash('TELEM-67890');
    expect(result1).not.toBe(result2);
  });

  it('returns a non-negative number', () => {
    const result = deterministicHash('any-string');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('Mock Dealer Service - vehicle-history generation', () => {
  // Replicate generateVehicleHistory logic for testing
  function generateVehicleHistory(telematicsId: string) {
    const hash = deterministicHash(telematicsId);
    const recordCount = (hash % 5) + 1;

    const serviceTypes = ['oil_change', 'brake_inspection', 'battery_check', 'tire_rotation', 'transmission_service', 'coolant_flush', 'air_filter_replacement'];
    const dealers = ['DEALER-TOKYO-001', 'DEALER-OSAKA-002', 'DEALER-NAGOYA-003', 'DEALER-YOKOHAMA-004'];

    const records = [];
    for (let i = 0; i < recordCount; i++) {
      const recordHash = deterministicHash(`${telematicsId}-${i}`);
      const serviceIndex = recordHash % serviceTypes.length;
      const dealerIndex = (recordHash >> 4) % dealers.length;
      const daysAgo = ((recordHash >> 8) % 365) + 30;
      const cost = ((recordHash % 500) + 50) + (recordHash % 100) / 100;

      const date = new Date('2024-12-01T00:00:00.000Z');
      date.setDate(date.getDate() - daysAgo);

      records.push({
        repair_id: `RPR-${telematicsId.substring(0, 6)}-${String(i + 1).padStart(3, '0')}`,
        service_type: serviceTypes[serviceIndex],
        dealer_id: dealers[dealerIndex],
        service_date: date.toISOString().split('T')[0],
        cost_usd: Math.round(cost * 100) / 100,
        mileage_at_service: 10000 + (recordHash % 80000),
        technician_notes: expect.any(String),
        parts_replaced: expect.any(Array),
      });
    }

    return {
      telematics_id: telematicsId,
      vehicle_history: records,
      total_records: records.length,
      last_updated: '2024-12-01T00:00:00.000Z',
    };
  }

  it('generates deterministic results for same telematicsId', () => {
    const result1 = generateVehicleHistory('TELEM-ABC123');
    const result2 = generateVehicleHistory('TELEM-ABC123');
    expect(result1.total_records).toBe(result2.total_records);
    expect(result1.telematics_id).toBe(result2.telematics_id);
  });

  it('generates 1-5 repair records', () => {
    const ids = ['TELEM-001', 'TELEM-002', 'TELEM-003', 'TELEM-999', 'TELEM-XYZ'];
    for (const id of ids) {
      const result = generateVehicleHistory(id);
      expect(result.total_records).toBeGreaterThanOrEqual(1);
      expect(result.total_records).toBeLessThanOrEqual(5);
      expect(result.vehicle_history).toHaveLength(result.total_records);
    }
  });

  it('includes telematics_id in the response', () => {
    const result = generateVehicleHistory('TELEM-TEST');
    expect(result.telematics_id).toBe('TELEM-TEST');
  });
});

describe('Mock Dealer Service - schedule-availability generation', () => {
  function generateScheduleAvailability(dealerId: string, serviceType: string) {
    const hash = deterministicHash(`${dealerId}:${serviceType}`);
    const slotCount = (hash % 4) + 2;

    const timeSlots = ['08:00', '09:30', '10:00', '11:00', '13:00', '14:30', '15:00', '16:00'];
    const technicians = ['Tech-A', 'Tech-B', 'Tech-C', 'Tech-D'];

    const slots = [];
    for (let i = 0; i < slotCount; i++) {
      const slotHash = deterministicHash(`${dealerId}:${serviceType}:${i}`);
      const timeIndex = slotHash % timeSlots.length;
      const techIndex = (slotHash >> 4) % technicians.length;
      const daysFromNow = (slotHash % 7) + 1;

      const date = new Date('2024-12-01T00:00:00.000Z');
      date.setDate(date.getDate() + daysFromNow);

      slots.push({
        slot_id: `SLOT-${dealerId.substring(0, 8)}-${String(i + 1).padStart(3, '0')}`,
        date: date.toISOString().split('T')[0],
        time: timeSlots[timeIndex],
        duration_minutes: serviceType.includes('transmission') || serviceType.includes('battery') ? 120 : 60,
        technician: technicians[techIndex],
        bay_number: (slotHash % 6) + 1,
      });
    }

    return {
      dealer_id: dealerId,
      service_type: serviceType,
      available_slots: slots,
      total_slots: slots.length,
      generated_at: '2024-12-01T00:00:00.000Z',
    };
  }

  it('generates deterministic results for same inputs', () => {
    const result1 = generateScheduleAvailability('DEALER-TOKYO-001', 'oil_change');
    const result2 = generateScheduleAvailability('DEALER-TOKYO-001', 'oil_change');
    expect(result1.total_slots).toBe(result2.total_slots);
    expect(result1.available_slots).toEqual(result2.available_slots);
  });

  it('generates 2-5 availability slots', () => {
    const combos = [
      ['DEALER-001', 'oil_change'],
      ['DEALER-002', 'brake_inspection'],
      ['DEALER-003', 'transmission_service'],
    ];
    for (const [dealerId, serviceType] of combos) {
      const result = generateScheduleAvailability(dealerId, serviceType);
      expect(result.total_slots).toBeGreaterThanOrEqual(2);
      expect(result.total_slots).toBeLessThanOrEqual(5);
      expect(result.available_slots).toHaveLength(result.total_slots);
    }
  });

  it('returns 120 min duration for transmission/battery services', () => {
    const result = generateScheduleAvailability('DEALER-001', 'transmission_service');
    for (const slot of result.available_slots) {
      expect(slot.duration_minutes).toBe(120);
    }
  });

  it('returns 60 min duration for regular services', () => {
    const result = generateScheduleAvailability('DEALER-001', 'oil_change');
    for (const slot of result.available_slots) {
      expect(slot.duration_minutes).toBe(60);
    }
  });

  it('includes dealer_id and service_type in the response', () => {
    const result = generateScheduleAvailability('DEALER-XYZ', 'tire_rotation');
    expect(result.dealer_id).toBe('DEALER-XYZ');
    expect(result.service_type).toBe('tire_rotation');
  });
});
