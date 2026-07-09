/**
 * End-to-end integration test suite for the deployed VSI application.
 *
 * Tests the HTTP API (POST /submissions, GET/PUT /config/weights) and
 * WebSocket connectivity against a live deployed stack.
 *
 * Environment variables:
 *   API_URL  — The deployed HTTP API base URL (e.g., https://abc123.execute-api.us-east-1.amazonaws.com)
 *   WS_URL   — The deployed WebSocket API base URL (e.g., wss://xyz789.execute-api.us-east-1.amazonaws.com/prod)
 *
 * The entire suite is skipped when API_URL is not set, so it won't fail
 * in CI when no deployed infrastructure exists.
 */

const API_URL = process.env.API_URL;
const WS_URL = process.env.WS_URL;

const shouldRun = !!API_URL;

// Helper to make HTTP requests using native fetch (Node 18+)
async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${API_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

// Conditionally run the entire describe block
const describeIfDeployed = shouldRun ? describe : describe.skip;

describeIfDeployed('VSI End-to-End Integration Tests', () => {
  // Track WebSocket connections for cleanup
  let openWebSockets: WebSocket[] = [];

  afterEach(() => {
    // Close any WebSocket connections opened during the test
    for (const ws of openWebSockets) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // Ignore close errors during cleanup
      }
    }
    openWebSockets = [];
  });

  // --- POST /submissions ---

  describe('POST /submissions', () => {
    it('returns 201 with submissionId and websocketUrl for a valid payload', async () => {
      const payload = {
        vehicleModel: 'Sentra EV',
        modelYear: 2023,
        telematicsId: 'TELEM-INT-TEST-001',
        symptomDescription: 'Battery drains faster than expected in cold weather',
        dtcCodes: ['P0A80'],
      };

      const { status, data } = await apiRequest('POST', '/submissions', payload);

      expect(status).toBe(201);
      expect(data).toHaveProperty('submissionId');
      expect(data).toHaveProperty('websocketUrl');
      expect(data).toHaveProperty('timestamp');

      const response = data as { submissionId: string; websocketUrl: string; timestamp: string };
      // submissionId should be a UUID-like string
      expect(response.submissionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      // websocketUrl should contain the submissionId
      expect(response.websocketUrl).toContain(response.submissionId);
      // timestamp should be ISO 8601
      expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
    }, 15000);

    it('returns 400 with descriptive error for invalid payload (missing required fields)', async () => {
      const invalidPayload = {
        vehicleModel: 'Sentra EV',
        // missing modelYear, symptomDescription
      };

      const { status, data } = await apiRequest('POST', '/submissions', invalidPayload);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      const errorResponse = data as { error: string; message: string };
      expect(errorResponse.error).toBe('VALIDATION_ERROR');
      expect(errorResponse.message).toBeDefined();
    }, 10000);

    it('returns 400 when body is empty', async () => {
      const { status, data } = await apiRequest('POST', '/submissions', {});

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
    }, 10000);
  });

  // --- GET /config/weights ---

  describe('GET /config/weights', () => {
    it('returns current weights with all required fields', async () => {
      const { status, data } = await apiRequest('GET', '/config/weights');

      expect(status).toBe(200);

      const weights = data as {
        cost_priority: number;
        latency_priority: number;
        quality_priority: number;
        lastUpdated?: string;
      };

      expect(typeof weights.cost_priority).toBe('number');
      expect(typeof weights.latency_priority).toBe('number');
      expect(typeof weights.quality_priority).toBe('number');

      // Each weight should be in [0, 1]
      expect(weights.cost_priority).toBeGreaterThanOrEqual(0);
      expect(weights.cost_priority).toBeLessThanOrEqual(1);
      expect(weights.latency_priority).toBeGreaterThanOrEqual(0);
      expect(weights.latency_priority).toBeLessThanOrEqual(1);
      expect(weights.quality_priority).toBeGreaterThanOrEqual(0);
      expect(weights.quality_priority).toBeLessThanOrEqual(1);

      // Weights should sum to approximately 1.0
      const sum = weights.cost_priority + weights.latency_priority + weights.quality_priority;
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.001);
    }, 10000);
  });

  // --- PUT /config/weights ---

  describe('PUT /config/weights', () => {
    it('returns 200 when valid weights are provided', async () => {
      const validWeights = {
        cost_priority: 0.5,
        latency_priority: 0.3,
        quality_priority: 0.2,
      };

      const { status, data } = await apiRequest('PUT', '/config/weights', validWeights);

      expect(status).toBe(200);

      const response = data as { message: string; weights: unknown; timestamp: string };
      expect(response.message).toBeDefined();
      expect(response.weights).toBeDefined();
      expect(response.timestamp).toBeDefined();
      // Verify the timestamp is valid ISO 8601
      expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
    }, 15000);

    it('returns 400 when weights do not sum to 1.0', async () => {
      const invalidWeights = {
        cost_priority: 0.5,
        latency_priority: 0.5,
        quality_priority: 0.5,
      };

      const { status, data } = await apiRequest('PUT', '/config/weights', invalidWeights);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      const errorResponse = data as { error: string; message: string };
      expect(errorResponse.error).toBe('VALIDATION_ERROR');
      expect(errorResponse.message).toBeDefined();
    }, 10000);

    it('returns 400 when a weight is outside [0.0, 1.0]', async () => {
      const invalidWeights = {
        cost_priority: -0.1,
        latency_priority: 0.6,
        quality_priority: 0.5,
      };

      const { status, data } = await apiRequest('PUT', '/config/weights', invalidWeights);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
    }, 10000);

    // Restore default weights after tests that modify them
    afterAll(async () => {
      if (shouldRun) {
        await apiRequest('PUT', '/config/weights', {
          cost_priority: 0.33,
          latency_priority: 0.33,
          quality_priority: 0.34,
        });
      }
    });
  });

  // --- WebSocket connectivity ---

  describe('WebSocket connection', () => {
    const describeIfWs = WS_URL ? describe : describe.skip;

    describeIfWs('with WS_URL configured', () => {
      it('can establish a WebSocket connection with a submissionId', async () => {
        // First create a submission to get a valid submissionId
        const payload = {
          vehicleModel: 'Altima',
          modelYear: 2024,
          telematicsId: 'TELEM-WS-TEST-001',
          symptomDescription: 'Intermittent check engine light on cold starts',
        };

        const { status, data } = await apiRequest('POST', '/submissions', payload);
        expect(status).toBe(201);

        const { submissionId } = data as { submissionId: string };
        expect(submissionId).toBeDefined();

        // Establish WebSocket connection
        const wsUrl = `${WS_URL}?submissionId=${submissionId}`;

        const connected = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(wsUrl);
          openWebSockets.push(ws);

          const timeout = setTimeout(() => {
            resolve(false);
          }, 10000);

          ws.onopen = () => {
            clearTimeout(timeout);
            resolve(true);
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
          };
        });

        expect(connected).toBe(true);
      }, 20000);

      it('connection closes gracefully', async () => {
        // Create a submission
        const payload = {
          vehicleModel: 'Leaf',
          modelYear: 2022,
          telematicsId: 'TELEM-WS-TEST-002',
          symptomDescription: 'Range significantly reduced below rated capacity',
        };

        const { data } = await apiRequest('POST', '/submissions', payload);
        const { submissionId } = data as { submissionId: string };

        const wsUrl = `${WS_URL}?submissionId=${submissionId}`;

        const closeCode = await new Promise<number | null>((resolve) => {
          const ws = new WebSocket(wsUrl);
          openWebSockets.push(ws);

          const timeout = setTimeout(() => {
            resolve(null);
          }, 10000);

          ws.onopen = () => {
            // Close the connection after successful open
            ws.close(1000, 'test complete');
          };

          ws.onclose = (event) => {
            clearTimeout(timeout);
            resolve(event.code);
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve(null);
          };
        });

        // Normal closure code
        expect(closeCode).toBe(1000);
      }, 20000);
    });
  });
});
