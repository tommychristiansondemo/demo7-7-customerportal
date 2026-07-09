import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

/**
 * Seed Lambda for the parts inventory DynamoDB table.
 * Writes 25 fictional part records covering powertrain, EV battery, ADAS,
 * and infotainment vehicle systems with varied availability statuses.
 *
 * Triggered as a CloudFormation Custom Resource on stack Create/Update.
 */

interface CfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: Record<string, string>;
}

interface PartsRecord {
  part_number: string;
  description: string;
  vehicle_systems: string[];
  availability_status: 'in_stock' | 'backordered' | 'discontinued';
  estimated_lead_time_days: number;
  unit_cost_usd: number;
}

const SEED_PARTS: PartsRecord[] = [
  // Powertrain parts
  {
    part_number: 'VSI-PT-1001',
    description: 'High-performance turbo intake manifold gasket',
    vehicle_systems: ['powertrain'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 0,
    unit_cost_usd: 34.99,
  },
  {
    part_number: 'VSI-PT-1002',
    description: 'Variable valve timing solenoid assembly',
    vehicle_systems: ['powertrain'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 2,
    unit_cost_usd: 189.50,
  },
  {
    part_number: 'VSI-PT-1003',
    description: 'Dual-clutch transmission fluid cooler',
    vehicle_systems: ['powertrain'],
    availability_status: 'backordered',
    estimated_lead_time_days: 21,
    unit_cost_usd: 412.00,
  },
  {
    part_number: 'VSI-PT-1004',
    description: 'Engine knock sensor with wiring harness',
    vehicle_systems: ['powertrain'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 1,
    unit_cost_usd: 67.25,
  },
  {
    part_number: 'VSI-PT-1005',
    description: 'Catalytic converter heat shield',
    vehicle_systems: ['powertrain'],
    availability_status: 'discontinued',
    estimated_lead_time_days: 365,
    unit_cost_usd: 155.00,
  },
  {
    part_number: 'VSI-PT-1006',
    description: 'Timing chain tensioner kit',
    vehicle_systems: ['powertrain'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 3,
    unit_cost_usd: 298.75,
  },
  // EV Battery parts
  {
    part_number: 'VSI-EV-2001',
    description: 'Battery management system control module',
    vehicle_systems: ['ev_battery'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 5,
    unit_cost_usd: 1249.99,
  },
  {
    part_number: 'VSI-EV-2002',
    description: 'High-voltage battery cell cooling plate',
    vehicle_systems: ['ev_battery'],
    availability_status: 'backordered',
    estimated_lead_time_days: 45,
    unit_cost_usd: 879.00,
  },
  {
    part_number: 'VSI-EV-2003',
    description: 'DC fast-charge inlet connector assembly',
    vehicle_systems: ['ev_battery'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 3,
    unit_cost_usd: 324.50,
  },
  {
    part_number: 'VSI-EV-2004',
    description: 'Thermal runaway prevention sensor array',
    vehicle_systems: ['ev_battery'],
    availability_status: 'backordered',
    estimated_lead_time_days: 30,
    unit_cost_usd: 567.00,
  },
  {
    part_number: 'VSI-EV-2005',
    description: 'Regenerative braking energy recovery module',
    vehicle_systems: ['ev_battery', 'powertrain'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 7,
    unit_cost_usd: 2150.00,
  },
  {
    part_number: 'VSI-EV-2006',
    description: 'Battery pack isolation relay',
    vehicle_systems: ['ev_battery'],
    availability_status: 'discontinued',
    estimated_lead_time_days: 365,
    unit_cost_usd: 445.00,
  },
  // ADAS parts
  {
    part_number: 'VSI-AD-3001',
    description: 'Forward-facing radar sensor unit',
    vehicle_systems: ['adas'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 4,
    unit_cost_usd: 762.00,
  },
  {
    part_number: 'VSI-AD-3002',
    description: 'Lane departure warning camera module',
    vehicle_systems: ['adas'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 2,
    unit_cost_usd: 489.99,
  },
  {
    part_number: 'VSI-AD-3003',
    description: 'Blind spot monitoring ultrasonic sensor',
    vehicle_systems: ['adas'],
    availability_status: 'backordered',
    estimated_lead_time_days: 14,
    unit_cost_usd: 215.00,
  },
  {
    part_number: 'VSI-AD-3004',
    description: 'Adaptive cruise control actuator bracket',
    vehicle_systems: ['adas'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 0,
    unit_cost_usd: 89.50,
  },
  {
    part_number: 'VSI-AD-3005',
    description: 'Emergency braking system ECU',
    vehicle_systems: ['adas'],
    availability_status: 'backordered',
    estimated_lead_time_days: 60,
    unit_cost_usd: 1875.00,
  },
  {
    part_number: 'VSI-AD-3006',
    description: 'Parking assist sonar ring assembly',
    vehicle_systems: ['adas'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 1,
    unit_cost_usd: 134.25,
  },
  // Infotainment parts
  {
    part_number: 'VSI-IF-4001',
    description: 'Touchscreen display panel 10.2 inch',
    vehicle_systems: ['infotainment'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 3,
    unit_cost_usd: 649.99,
  },
  {
    part_number: 'VSI-IF-4002',
    description: 'Navigation system GPS antenna module',
    vehicle_systems: ['infotainment'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 1,
    unit_cost_usd: 112.00,
  },
  {
    part_number: 'VSI-IF-4003',
    description: 'Premium audio amplifier with DSP',
    vehicle_systems: ['infotainment'],
    availability_status: 'backordered',
    estimated_lead_time_days: 28,
    unit_cost_usd: 534.00,
  },
  {
    part_number: 'VSI-IF-4004',
    description: 'Bluetooth connectivity module v5.3',
    vehicle_systems: ['infotainment'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 0,
    unit_cost_usd: 78.50,
  },
  {
    part_number: 'VSI-IF-4005',
    description: 'Heads-up display projector unit',
    vehicle_systems: ['infotainment', 'adas'],
    availability_status: 'discontinued',
    estimated_lead_time_days: 365,
    unit_cost_usd: 1450.00,
  },
  {
    part_number: 'VSI-IF-4006',
    description: 'Wireless charging pad assembly',
    vehicle_systems: ['infotainment'],
    availability_status: 'in_stock',
    estimated_lead_time_days: 2,
    unit_cost_usd: 195.00,
  },
  // Cross-system part
  {
    part_number: 'VSI-XS-5001',
    description: 'Central vehicle network gateway ECU',
    vehicle_systems: ['powertrain', 'ev_battery', 'adas', 'infotainment'],
    availability_status: 'backordered',
    estimated_lead_time_days: 90,
    unit_cost_usd: 3200.00,
  },
];

const client = new DynamoDBClient({});

export async function handler(event: CfnEvent): Promise<{ PhysicalResourceId: string; Data: Record<string, string> }> {
  console.log('Seed parts inventory event:', JSON.stringify(event));

  // On Delete, nothing to clean up (table will be destroyed by CDK)
  if (event.RequestType === 'Delete') {
    return {
      PhysicalResourceId: 'seed-parts-inventory',
      Data: { recordCount: '0' },
    };
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is required');
  }

  // BatchWriteItem supports max 25 items per request
  const batches: PartsRecord[][] = [];
  for (let i = 0; i < SEED_PARTS.length; i += 25) {
    batches.push(SEED_PARTS.slice(i, i + 25));
  }

  let totalWritten = 0;
  for (const batch of batches) {
    const writeRequests = batch.map((record) => ({
      PutRequest: {
        Item: marshall(record, { removeUndefinedValues: true }),
      },
    }));

    const command = new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: writeRequests,
      },
    });

    const result = await client.send(command);

    // Handle unprocessed items with retry
    let unprocessed = result.UnprocessedItems?.[tableName];
    let retries = 0;
    while (unprocessed && unprocessed.length > 0 && retries < 3) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      const retryCommand = new BatchWriteItemCommand({
        RequestItems: { [tableName]: unprocessed },
      });
      const retryResult = await client.send(retryCommand);
      unprocessed = retryResult.UnprocessedItems?.[tableName];
    }

    if (unprocessed && unprocessed.length > 0) {
      throw new Error(`Failed to write ${unprocessed.length} items after ${retries} retries`);
    }

    totalWritten += batch.length;
  }

  console.log(`Successfully seeded ${totalWritten} parts records`);

  return {
    PhysicalResourceId: 'seed-parts-inventory',
    Data: { recordCount: String(totalWritten) },
  };
}
