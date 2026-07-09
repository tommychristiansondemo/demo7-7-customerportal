/**
 * Unit tests for the AppConfig Weights Updater Lambda
 *
 * Tests validation logic, HTTP method routing, and response formatting.
 * AWS SDK calls are mocked since we're testing the handler logic, not AppConfig itself.
 */

// Mock the AWS SDK before importing the handler
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-appconfig', () => ({
  AppConfigClient: jest.fn(() => ({ send: mockSend })),
  CreateHostedConfigurationVersionCommand: jest.fn((params: Record<string, unknown>) => ({ ...params, _type: 'CreateHostedConfigVersion' })),
  StartDeploymentCommand: jest.fn((params: Record<string, unknown>) => ({ ...params, _type: 'StartDeployment' })),
}));

// Mock fetch for GET handler (AppConfig Extension)
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Set environment variables before importing handler
process.env.APPCONFIG_APPLICATION_ID = 'test-app-id';
process.env.APPCONFIG_ENVIRONMENT_ID = 'test-env-id';
process.env.APPCONFIG_CONFIGURATION_PROFILE_ID = 'test-profile-id';
process.env.APPCONFIG_DEPLOYMENT_STRATEGY_ID = 'test-strategy-id';

import { handler } from '../../src/lambdas/appconfig-weights-updater/index';

function makeEvent(method: string, body?: Record<string, unknown>) {
  return {
    requestContext: { http: { method } },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

describe('AppConfig Weights Updater Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /config/weights', () => {
    it('returns 200 with timestamp for valid weights', async () => {
      mockSend.mockResolvedValueOnce({ VersionNumber: 2 }); // CreateHostedConfigVersion
      mockSend.mockResolvedValueOnce({}); // StartDeployment

      const event = makeEvent('PUT', {
        cost_priority: 50,
        latency_priority: 30,
        quality_priority: 20,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Weights updated successfully');
      expect(body.weights).toEqual({
        cost_priority: 50,
        latency_priority: 30,
        quality_priority: 20,
      });
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('returns 400 when weights do not sum to 100', async () => {
      const event = makeEvent('PUT', {
        cost_priority: 50,
        latency_priority: 50,
        quality_priority: 50,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('sum to 100');
    });

    it('returns 400 when a weight is below 0', async () => {
      const event = makeEvent('PUT', {
        cost_priority: -1,
        latency_priority: 60,
        quality_priority: 50,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('cost_priority');
    });

    it('returns 400 when a weight exceeds 100', async () => {
      const event = makeEvent('PUT', {
        cost_priority: 150,
        latency_priority: 0,
        quality_priority: -50,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for non-numeric weight values', async () => {
      const event = makeEvent('PUT', {
        cost_priority: 'high',
        latency_priority: 50,
        quality_priority: 50,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('must all be numbers');
    });

    it('returns 400 for invalid JSON body', async () => {
      const event = {
        requestContext: { http: { method: 'PUT' } },
        body: 'not valid json',
        isBase64Encoded: false,
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('valid JSON');
    });

    it('accepts weights with tolerance sum of 100 ±1', async () => {
      mockSend.mockResolvedValueOnce({ VersionNumber: 3 });
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent('PUT', {
        cost_priority: 33,
        latency_priority: 33,
        quality_priority: 34,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    it('returns 500 when AppConfig SDK call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('AppConfig service unavailable'));

      const event = makeEvent('PUT', {
        cost_priority: 33,
        latency_priority: 33,
        quality_priority: 34,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('APPCONFIG_ERROR');
      expect(body.message).toContain('AppConfig service unavailable');
    });

    it('handles base64 encoded body', async () => {
      mockSend.mockResolvedValueOnce({ VersionNumber: 4 });
      mockSend.mockResolvedValueOnce({});

      const bodyContent = JSON.stringify({
        cost_priority: 40,
        latency_priority: 30,
        quality_priority: 30,
      });

      const event = {
        requestContext: { http: { method: 'PUT' } },
        body: Buffer.from(bodyContent).toString('base64'),
        isBase64Encoded: true,
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('GET /config/weights', () => {
    it('returns 200 with current weights from AppConfig Extension', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cost_priority: 33,
          latency_priority: 33,
          quality_priority: 34,
        }),
      });

      const event = makeEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.cost_priority).toBe(33);
      expect(body.latency_priority).toBe(33);
      expect(body.quality_priority).toBe(34);
      expect(body.lastUpdated).toBeDefined();
    });

    it('calls the correct AppConfig Extension URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cost_priority: 50,
          latency_priority: 30,
          quality_priority: 20,
        }),
      });

      const event = makeEvent('GET');
      await handler(event);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:2772/applications/vsi-model-routing/environments/production/configurations/model-weights'
      );
    });

    it('returns 500 when AppConfig Extension is unavailable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const event = makeEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('APPCONFIG_ERROR');
      expect(body.message).toContain('Connection refused');
    });

    it('returns 500 when AppConfig Extension returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const event = makeEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('APPCONFIG_ERROR');
    });
  });

  describe('Unsupported methods', () => {
    it('returns 405 for unsupported HTTP methods', async () => {
      const event = makeEvent('DELETE');
      const result = await handler(event);

      expect(result.statusCode).toBe(405);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('METHOD_NOT_ALLOWED');
    });

    it('returns 405 for PATCH method', async () => {
      const event = makeEvent('PATCH');
      const result = await handler(event);

      expect(result.statusCode).toBe(405);
    });
  });

  describe('Response headers', () => {
    it('includes CORS and Content-Type headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cost_priority: 33,
          latency_priority: 33,
          quality_priority: 34,
        }),
      });

      const event = makeEvent('GET');
      const result = await handler(event);

      expect(result.headers?.['Content-Type']).toBe('application/json');
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });
  });
});
