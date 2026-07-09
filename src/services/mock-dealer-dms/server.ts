import * as http from 'http';

/**
 * Mock Dealer Management Service (DMS)
 *
 * Simulates a real dealership's back-office system that manages:
 * - Service appointments
 * - Parts inventory specific to the dealer
 * - Labor rates and pricing
 *
 * This service runs in ECS Fargate and is accessed via PrivateLink,
 * demonstrating the pattern for connecting agents to private internal services.
 *
 * Endpoints:
 *   GET  /appointments  — List available service appointment slots
 *   POST /schedule      — Schedule a new service appointment
 *   GET  /inventory     — Get dealer-specific parts inventory
 *   GET  /pricing       — Get labor rates and service pricing
 *   GET  /health        — Health check
 *   GET  /dealer-parts  — Legacy endpoint (backward compatibility)
 */

// ─── Mock Data ───────────────────────────────────────────────────────────────

const DEALER_INFO = {
  dealer_id: 'DEALER-TOKYO-001',
  dealer_name: 'Sakura Motors Service Center',
  address: '1-2-3 Minato, Fictional City, JP',
  timezone: 'Asia/Tokyo',
};

const AVAILABLE_APPOINTMENTS = [
  {
    slot_id: 'SLOT-001',
    date: '2024-12-09',
    time: '08:00',
    duration_minutes: 60,
    service_bay: 'Bay A',
    technician: 'T. Yamamoto',
    specialization: 'EV Systems',
    available: true,
  },
  {
    slot_id: 'SLOT-002',
    date: '2024-12-09',
    time: '09:30',
    duration_minutes: 90,
    service_bay: 'Bay B',
    technician: 'K. Tanaka',
    specialization: 'Powertrain',
    available: true,
  },
  {
    slot_id: 'SLOT-003',
    date: '2024-12-09',
    time: '11:00',
    duration_minutes: 120,
    service_bay: 'Bay A',
    technician: 'T. Yamamoto',
    specialization: 'EV Systems',
    available: false,
  },
  {
    slot_id: 'SLOT-004',
    date: '2024-12-10',
    time: '08:00',
    duration_minutes: 60,
    service_bay: 'Bay C',
    technician: 'M. Suzuki',
    specialization: 'ADAS Calibration',
    available: true,
  },
  {
    slot_id: 'SLOT-005',
    date: '2024-12-10',
    time: '10:00',
    duration_minutes: 90,
    service_bay: 'Bay B',
    technician: 'K. Tanaka',
    specialization: 'Powertrain',
    available: true,
  },
  {
    slot_id: 'SLOT-006',
    date: '2024-12-10',
    time: '13:00',
    duration_minutes: 60,
    service_bay: 'Bay D',
    technician: 'R. Watanabe',
    specialization: 'Infotainment',
    available: true,
  },
  {
    slot_id: 'SLOT-007',
    date: '2024-12-11',
    time: '08:30',
    duration_minutes: 180,
    service_bay: 'Bay A',
    technician: 'T. Yamamoto',
    specialization: 'EV Systems',
    available: true,
  },
  {
    slot_id: 'SLOT-008',
    date: '2024-12-11',
    time: '14:00',
    duration_minutes: 60,
    service_bay: 'Bay C',
    technician: 'M. Suzuki',
    specialization: 'ADAS Calibration',
    available: false,
  },
];

const DEALER_INVENTORY = [
  {
    dealer_part_id: 'DLR-001',
    part_number: 'NIS-EV-BAT-001',
    description: 'EV Traction Battery Module - 12S',
    quantity_on_hand: 3,
    dealer_price: 4250.0,
    last_restocked: '2024-11-15T08:00:00.000Z',
    warehouse_location: 'Bay A-12',
    reorder_threshold: 2,
    vehicle_systems: ['ev_battery'],
  },
  {
    dealer_part_id: 'DLR-002',
    part_number: 'NIS-EV-BAT-002',
    description: 'Battery Management System Controller',
    quantity_on_hand: 7,
    dealer_price: 1875.5,
    last_restocked: '2024-11-20T10:30:00.000Z',
    warehouse_location: 'Bay A-14',
    reorder_threshold: 3,
    vehicle_systems: ['ev_battery'],
  },
  {
    dealer_part_id: 'DLR-003',
    part_number: 'NIS-PWR-TRN-001',
    description: 'CVT Transmission Valve Body Assembly',
    quantity_on_hand: 2,
    dealer_price: 3150.0,
    last_restocked: '2024-10-28T14:00:00.000Z',
    warehouse_location: 'Bay B-03',
    reorder_threshold: 1,
    vehicle_systems: ['powertrain'],
  },
  {
    dealer_part_id: 'DLR-004',
    part_number: 'NIS-PWR-TRN-002',
    description: 'Engine ECU Replacement Unit',
    quantity_on_hand: 5,
    dealer_price: 2200.0,
    last_restocked: '2024-11-10T09:15:00.000Z',
    warehouse_location: 'Bay B-07',
    reorder_threshold: 2,
    vehicle_systems: ['powertrain'],
  },
  {
    dealer_part_id: 'DLR-005',
    part_number: 'NIS-ADAS-SNR-001',
    description: 'Front Radar Sensor Module',
    quantity_on_hand: 4,
    dealer_price: 1450.0,
    last_restocked: '2024-11-18T11:00:00.000Z',
    warehouse_location: 'Bay C-01',
    reorder_threshold: 2,
    vehicle_systems: ['adas'],
  },
  {
    dealer_part_id: 'DLR-006',
    part_number: 'NIS-ADAS-CAM-001',
    description: 'Forward-Facing Camera Unit',
    quantity_on_hand: 6,
    dealer_price: 980.0,
    last_restocked: '2024-11-22T13:45:00.000Z',
    warehouse_location: 'Bay C-03',
    reorder_threshold: 3,
    vehicle_systems: ['adas'],
  },
  {
    dealer_part_id: 'DLR-007',
    part_number: 'NIS-INFO-DSP-001',
    description: 'Infotainment Touchscreen Display 8-inch',
    quantity_on_hand: 8,
    dealer_price: 1125.0,
    last_restocked: '2024-11-25T08:30:00.000Z',
    warehouse_location: 'Bay D-02',
    reorder_threshold: 4,
    vehicle_systems: ['infotainment'],
  },
  {
    dealer_part_id: 'DLR-008',
    part_number: 'NIS-INFO-AMP-001',
    description: 'Premium Audio Amplifier',
    quantity_on_hand: 12,
    dealer_price: 675.0,
    last_restocked: '2024-11-19T16:00:00.000Z',
    warehouse_location: 'Bay D-05',
    reorder_threshold: 5,
    vehicle_systems: ['infotainment'],
  },
  {
    dealer_part_id: 'DLR-009',
    part_number: 'NIS-EV-CHG-001',
    description: 'Onboard Charger Module 7.4kW',
    quantity_on_hand: 1,
    dealer_price: 2890.0,
    last_restocked: '2024-10-30T07:00:00.000Z',
    warehouse_location: 'Bay A-16',
    reorder_threshold: 2,
    vehicle_systems: ['ev_battery'],
  },
  {
    dealer_part_id: 'DLR-010',
    part_number: 'NIS-PWR-INV-001',
    description: 'Traction Motor Inverter',
    quantity_on_hand: 2,
    dealer_price: 3750.0,
    last_restocked: '2024-11-05T12:00:00.000Z',
    warehouse_location: 'Bay B-10',
    reorder_threshold: 1,
    vehicle_systems: ['powertrain', 'ev_battery'],
  },
  {
    dealer_part_id: 'DLR-011',
    part_number: 'NIS-ADAS-LDR-001',
    description: 'LiDAR Sensor Unit - Roof Mount',
    quantity_on_hand: 0,
    dealer_price: 5200.0,
    last_restocked: '2024-09-15T10:00:00.000Z',
    warehouse_location: 'Bay C-08',
    reorder_threshold: 1,
    vehicle_systems: ['adas'],
  },
  {
    dealer_part_id: 'DLR-012',
    part_number: 'NIS-EV-THM-001',
    description: 'Battery Thermal Management Pump',
    quantity_on_hand: 9,
    dealer_price: 445.0,
    last_restocked: '2024-11-28T09:00:00.000Z',
    warehouse_location: 'Bay A-18',
    reorder_threshold: 4,
    vehicle_systems: ['ev_battery'],
  },
];

const LABOR_RATES = [
  {
    service_code: 'LBR-DIAG-STD',
    description: 'Standard Diagnostic Assessment',
    rate_per_hour_usd: 125.0,
    estimated_hours: 1.0,
    category: 'diagnostic',
  },
  {
    service_code: 'LBR-DIAG-ADV',
    description: 'Advanced Diagnostic (EV/ADAS)',
    rate_per_hour_usd: 175.0,
    estimated_hours: 1.5,
    category: 'diagnostic',
  },
  {
    service_code: 'LBR-EV-BAT',
    description: 'EV Battery Module Replacement',
    rate_per_hour_usd: 185.0,
    estimated_hours: 4.0,
    category: 'ev_systems',
  },
  {
    service_code: 'LBR-EV-CHG',
    description: 'Onboard Charger Replacement',
    rate_per_hour_usd: 165.0,
    estimated_hours: 2.5,
    category: 'ev_systems',
  },
  {
    service_code: 'LBR-PWR-CVT',
    description: 'CVT Transmission Repair',
    rate_per_hour_usd: 155.0,
    estimated_hours: 6.0,
    category: 'powertrain',
  },
  {
    service_code: 'LBR-PWR-ECU',
    description: 'ECU Programming and Replacement',
    rate_per_hour_usd: 145.0,
    estimated_hours: 2.0,
    category: 'powertrain',
  },
  {
    service_code: 'LBR-ADAS-CAL',
    description: 'ADAS Sensor Calibration',
    rate_per_hour_usd: 195.0,
    estimated_hours: 3.0,
    category: 'adas',
  },
  {
    service_code: 'LBR-ADAS-RPL',
    description: 'ADAS Sensor Module Replacement',
    rate_per_hour_usd: 175.0,
    estimated_hours: 2.0,
    category: 'adas',
  },
  {
    service_code: 'LBR-INFO-DSP',
    description: 'Infotainment Display Replacement',
    rate_per_hour_usd: 125.0,
    estimated_hours: 1.5,
    category: 'infotainment',
  },
  {
    service_code: 'LBR-INFO-UPD',
    description: 'Infotainment Software Update',
    rate_per_hour_usd: 95.0,
    estimated_hours: 0.5,
    category: 'infotainment',
  },
];

// ─── Request Helpers ─────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

function handleGetAppointments(res: http.ServerResponse): void {
  sendJson(res, 200, {
    dealer: DEALER_INFO,
    appointments: AVAILABLE_APPOINTMENTS,
    total_slots: AVAILABLE_APPOINTMENTS.length,
    available_slots: AVAILABLE_APPOINTMENTS.filter((a) => a.available).length,
    generated_at: new Date().toISOString(),
  });
}

async function handlePostSchedule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Failed to read request body' });
    return;
  }

  let payload: {
    slot_id?: string;
    vehicle_vin?: string;
    customer_name?: string;
    service_type?: string;
  };

  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!payload.slot_id || !payload.vehicle_vin || !payload.customer_name) {
    sendJson(res, 400, {
      error: 'Missing required fields: slot_id, vehicle_vin, customer_name',
    });
    return;
  }

  const slot = AVAILABLE_APPOINTMENTS.find((a) => a.slot_id === payload.slot_id);
  if (!slot) {
    sendJson(res, 404, { error: `Appointment slot ${payload.slot_id} not found` });
    return;
  }

  if (!slot.available) {
    sendJson(res, 409, {
      error: `Appointment slot ${payload.slot_id} is no longer available`,
    });
    return;
  }

  // Generate a deterministic confirmation number from the slot ID
  const confirmationNumber = `CONF-${payload.slot_id.replace('SLOT-', '')}-${Date.now().toString(36).toUpperCase()}`;

  sendJson(res, 201, {
    confirmation_number: confirmationNumber,
    dealer: DEALER_INFO,
    appointment: {
      slot_id: slot.slot_id,
      date: slot.date,
      time: slot.time,
      duration_minutes: slot.duration_minutes,
      service_bay: slot.service_bay,
      technician: slot.technician,
    },
    vehicle_vin: payload.vehicle_vin,
    customer_name: payload.customer_name,
    service_type: payload.service_type ?? 'general_service',
    status: 'confirmed',
    scheduled_at: new Date().toISOString(),
  });
}

function handleGetInventory(res: http.ServerResponse): void {
  sendJson(res, 200, {
    dealer: DEALER_INFO,
    inventory: DEALER_INVENTORY,
    total_parts: DEALER_INVENTORY.length,
    low_stock_alerts: DEALER_INVENTORY.filter(
      (p) => p.quantity_on_hand <= p.reorder_threshold
    ).map((p) => ({
      part_number: p.part_number,
      description: p.description,
      quantity_on_hand: p.quantity_on_hand,
      reorder_threshold: p.reorder_threshold,
    })),
    inventory_timestamp: new Date().toISOString(),
  });
}

function handleGetPricing(res: http.ServerResponse): void {
  sendJson(res, 200, {
    dealer: DEALER_INFO,
    labor_rates: LABOR_RATES,
    currency: 'USD',
    effective_date: '2024-12-01',
    notes: 'Rates are estimates. Final pricing may vary based on vehicle condition and diagnostic findings.',
    generated_at: new Date().toISOString(),
  });
}

function handleGetDealerParts(res: http.ServerResponse): void {
  // Legacy endpoint for backward compatibility with PrivateLink service Lambda
  sendJson(res, 200, {
    dealer_id: DEALER_INFO.dealer_id,
    inventory_timestamp: '2024-12-01T00:00:00.000Z',
    parts: DEALER_INVENTORY.map((p) => ({
      dealer_part_id: p.dealer_part_id,
      part_number: p.part_number,
      description: p.description,
      quantity_on_hand: p.quantity_on_hand,
      dealer_price: p.dealer_price,
      last_restocked: p.last_restocked,
      warehouse_location: p.warehouse_location,
    })),
    total_parts: DEALER_INVENTORY.length,
  });
}

function handleHealth(res: http.ServerResponse): void {
  sendJson(res, 200, {
    status: 'healthy',
    service: 'mock-dealer-dms',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '80', 10);

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  console.log(`${method} ${url}`);

  try {
    if (method === 'GET' && url === '/health') {
      handleHealth(res);
    } else if (method === 'GET' && url === '/appointments') {
      handleGetAppointments(res);
    } else if (method === 'POST' && url === '/schedule') {
      await handlePostSchedule(req, res);
    } else if (method === 'GET' && url === '/inventory') {
      handleGetInventory(res);
    } else if (method === 'GET' && url === '/pricing') {
      handleGetPricing(res);
    } else if (method === 'GET' && url === '/dealer-parts') {
      handleGetDealerParts(res);
    } else {
      sendJson(res, 404, { error: 'Not Found', path: url, method });
    }
  } catch (err) {
    console.error('Unhandled error:', err);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`Mock Dealer DMS listening on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health        — Health check');
  console.log('  GET  /appointments  — Available service appointments');
  console.log('  POST /schedule      — Schedule a service appointment');
  console.log('  GET  /inventory     — Dealer parts inventory');
  console.log('  GET  /pricing       — Labor rates and service pricing');
  console.log('  GET  /dealer-parts  — Legacy dealer parts (PrivateLink compat)');
});
