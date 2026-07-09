import * as http from 'http';
import * as crypto from 'crypto';

/**
 * Deterministic hash function — produces a consistent numeric value
 * from any string input, enabling predictable mock responses.
 */
function deterministicHash(input: string): number {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Mock dealer parts inventory - deterministic response data
 * Simulates a dealer parts management system accessed via PrivateLink
 */
const DEALER_PARTS_INVENTORY = [
  {
    dealer_part_id: 'DLR-001',
    part_number: 'NIS-EV-BAT-001',
    description: 'EV Traction Battery Module - 12S',
    quantity_on_hand: 3,
    dealer_price: 4250.00,
    last_restocked: '2024-11-15T08:00:00.000Z',
    warehouse_location: 'Bay A-12',
  },
  {
    dealer_part_id: 'DLR-002',
    part_number: 'NIS-EV-BAT-002',
    description: 'Battery Management System Controller',
    quantity_on_hand: 7,
    dealer_price: 1875.50,
    last_restocked: '2024-11-20T10:30:00.000Z',
    warehouse_location: 'Bay A-14',
  },
  {
    dealer_part_id: 'DLR-003',
    part_number: 'NIS-PWR-TRN-001',
    description: 'CVT Transmission Valve Body Assembly',
    quantity_on_hand: 2,
    dealer_price: 3150.00,
    last_restocked: '2024-10-28T14:00:00.000Z',
    warehouse_location: 'Bay B-03',
  },
  {
    dealer_part_id: 'DLR-004',
    part_number: 'NIS-PWR-TRN-002',
    description: 'Engine ECU Replacement Unit',
    quantity_on_hand: 5,
    dealer_price: 2200.00,
    last_restocked: '2024-11-10T09:15:00.000Z',
    warehouse_location: 'Bay B-07',
  },
  {
    dealer_part_id: 'DLR-005',
    part_number: 'NIS-ADAS-SNR-001',
    description: 'Front Radar Sensor Module',
    quantity_on_hand: 4,
    dealer_price: 1450.00,
    last_restocked: '2024-11-18T11:00:00.000Z',
    warehouse_location: 'Bay C-01',
  },
  {
    dealer_part_id: 'DLR-006',
    part_number: 'NIS-ADAS-CAM-001',
    description: 'Forward-Facing Camera Unit',
    quantity_on_hand: 6,
    dealer_price: 980.00,
    last_restocked: '2024-11-22T13:45:00.000Z',
    warehouse_location: 'Bay C-03',
  },
  {
    dealer_part_id: 'DLR-007',
    part_number: 'NIS-INFO-DSP-001',
    description: 'Infotainment Touchscreen Display 8-inch',
    quantity_on_hand: 8,
    dealer_price: 1125.00,
    last_restocked: '2024-11-25T08:30:00.000Z',
    warehouse_location: 'Bay D-02',
  },
  {
    dealer_part_id: 'DLR-008',
    part_number: 'NIS-INFO-AMP-001',
    description: 'Premium Audio Amplifier',
    quantity_on_hand: 12,
    dealer_price: 675.00,
    last_restocked: '2024-11-19T16:00:00.000Z',
    warehouse_location: 'Bay D-05',
  },
  {
    dealer_part_id: 'DLR-009',
    part_number: 'NIS-EV-CHG-001',
    description: 'Onboard Charger Module 7.4kW',
    quantity_on_hand: 1,
    dealer_price: 2890.00,
    last_restocked: '2024-10-30T07:00:00.000Z',
    warehouse_location: 'Bay A-16',
  },
  {
    dealer_part_id: 'DLR-010',
    part_number: 'NIS-PWR-INV-001',
    description: 'Traction Motor Inverter',
    quantity_on_hand: 2,
    dealer_price: 3750.00,
    last_restocked: '2024-11-05T12:00:00.000Z',
    warehouse_location: 'Bay B-10',
  },
  {
    dealer_part_id: 'DLR-011',
    part_number: 'NIS-ADAS-LDR-001',
    description: 'LiDAR Sensor Unit - Roof Mount',
    quantity_on_hand: 0,
    dealer_price: 5200.00,
    last_restocked: '2024-09-15T10:00:00.000Z',
    warehouse_location: 'Bay C-08',
  },
  {
    dealer_part_id: 'DLR-012',
    part_number: 'NIS-EV-THM-001',
    description: 'Battery Thermal Management Pump',
    quantity_on_hand: 9,
    dealer_price: 445.00,
    last_restocked: '2024-11-28T09:00:00.000Z',
    warehouse_location: 'Bay A-18',
  },
];

/**
 * Generates deterministic mock repair history based on telematicsId hash.
 * Same telematicsId always produces same results.
 */
function generateVehicleHistory(telematicsId: string): object {
  const hash = deterministicHash(telematicsId);
  const recordCount = (hash % 5) + 1; // 1-5 repair records

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
      technician_notes: `Routine ${serviceTypes[serviceIndex].replace(/_/g, ' ')} performed. No issues found.`,
      parts_replaced: i % 2 === 0
        ? [DEALER_PARTS_INVENTORY[recordHash % DEALER_PARTS_INVENTORY.length].part_number]
        : [],
    });
  }

  return {
    telematics_id: telematicsId,
    vehicle_history: records,
    total_records: records.length,
    last_updated: '2024-12-01T00:00:00.000Z',
  };
}

/**
 * Generates deterministic scheduling availability based on dealerId + serviceType hash.
 * Same inputs always produce the same availability slots.
 */
function generateScheduleAvailability(dealerId: string, serviceType: string): object {
  const hash = deterministicHash(`${dealerId}:${serviceType}`);
  const slotCount = (hash % 4) + 2; // 2-5 available slots

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

/**
 * Reads the full request body as a string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const PORT = 80;

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  // Health check endpoint
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    return;
  }

  // Dealer parts endpoint
  if (method === 'GET' && url === '/dealer-parts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      dealer_id: 'DEALER-TOKYO-001',
      inventory_timestamp: '2024-12-01T00:00:00.000Z',
      parts: DEALER_PARTS_INVENTORY,
      total_parts: DEALER_PARTS_INVENTORY.length,
    }));
    return;
  }

  // Vehicle history endpoint — deterministic mock repair history
  if (method === 'POST' && url === '/vehicle-history') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const telematicsId = parsed.telematicsId;

      if (!telematicsId || typeof telematicsId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid telematicsId' }));
        return;
      }

      const history = generateVehicleHistory(telematicsId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
    return;
  }

  // Schedule availability endpoint — deterministic mock scheduling slots
  if (method === 'POST' && url === '/schedule-availability') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const dealerId = parsed.dealerId;
      const serviceType = parsed.serviceType;

      if (!dealerId || typeof dealerId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid dealerId' }));
        return;
      }
      if (!serviceType || typeof serviceType !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid serviceType' }));
        return;
      }

      const availability = generateScheduleAvailability(dealerId, serviceType);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(availability));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
    return;
  }

  // Unknown route
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: url }));
});

server.listen(PORT, () => {
  console.log(`Mock dealer service listening on port ${PORT}`);
});
