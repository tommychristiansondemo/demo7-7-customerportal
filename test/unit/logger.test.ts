import { createLogger, Logger } from '../../src/shared/logger';

describe('Structured JSON Logger', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('creates a logger bound to a submission ID', () => {
    const logger = createLogger('test-submission-123');
    expect(logger).toBeInstanceOf(Logger);
  });

  it('emits INFO-level structured JSON with required fields', () => {
    const logger = createLogger('sub-001');
    logger.info('intake_submission_received', { vehicleModel: 'Sentra' });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(writeSpy.mock.calls[0][0]);

    expect(output.level).toBe('INFO');
    expect(output.event_type).toBe('intake_submission_received');
    expect(output.submission_id).toBe('sub-001');
    expect(output.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(output.vehicleModel).toBe('Sentra');
  });

  it('emits ERROR-level structured JSON', () => {
    const logger = createLogger('sub-002');
    logger.error('error', { errorMessage: 'Agent timeout', agentName: 'Triage' });

    const output = JSON.parse(writeSpy.mock.calls[0][0]);
    expect(output.level).toBe('ERROR');
    expect(output.event_type).toBe('error');
    expect(output.submission_id).toBe('sub-002');
    expect(output.errorMessage).toBe('Agent timeout');
    expect(output.agentName).toBe('Triage');
  });

  it('emits WARN-level structured JSON', () => {
    const logger = createLogger('sub-003');
    logger.warn('websocket_publish', { connectionCount: 0 });

    const output = JSON.parse(writeSpy.mock.calls[0][0]);
    expect(output.level).toBe('WARN');
    expect(output.event_type).toBe('websocket_publish');
    expect(output.connectionCount).toBe(0);
  });

  it('emits DEBUG-level structured JSON', () => {
    const logger = createLogger('sub-004');
    logger.debug('mcp_tool_call_initiated', { toolName: 'kb_retrieval' });

    const output = JSON.parse(writeSpy.mock.calls[0][0]);
    expect(output.level).toBe('DEBUG');
    expect(output.event_type).toBe('mcp_tool_call_initiated');
    expect(output.toolName).toBe('kb_retrieval');
  });

  it('includes ISO 8601 timestamp in every log entry', () => {
    const logger = createLogger('sub-005');
    logger.info('agent_stage_started', {});

    const output = JSON.parse(writeSpy.mock.calls[0][0]);
    // Verify ISO 8601 format
    const parsed = new Date(output.timestamp);
    expect(parsed.toISOString()).toBe(output.timestamp);
  });

  it('outputs each log entry as a single JSON line ending with newline', () => {
    const logger = createLogger('sub-006');
    logger.info('agent_stage_completed', { agentName: 'Summary' });

    const rawOutput: string = writeSpy.mock.calls[0][0];
    expect(rawOutput.endsWith('\n')).toBe(true);
    expect(rawOutput.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('supports all defined event types', () => {
    const logger = createLogger('sub-007');
    const eventTypes = [
      'intake_submission_received',
      'agent_stage_started',
      'agent_stage_completed',
      'model_routing_decision',
      'mcp_tool_call_initiated',
      'mcp_tool_call_completed',
      'websocket_publish',
      'error',
    ] as const;

    for (const eventType of eventTypes) {
      logger.info(eventType, {});
    }

    expect(writeSpy).toHaveBeenCalledTimes(eventTypes.length);
  });
});
