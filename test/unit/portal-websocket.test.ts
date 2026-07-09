/**
 * Unit tests for portal/websocket.js WebSocket connection management.
 *
 * Tests the core logic of message parsing, stage tracking, reconnection,
 * and pipeline completion detection.
 *
 * @jest-environment jsdom
 */

describe('Portal WebSocket Module', () => {
  let mockWebSocket: any;
  let mockWebSocketInstance: any;
  let originalTimeout: typeof setTimeout;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = `
      <section id="progress-section">
        <h2>Pipeline Progress</h2>
        <div class="progress-indicator">
          <div class="stage" data-stage="Triage">
            <div class="stage-icon">1</div>
            <div class="stage-label">Triage</div>
            <div class="stage-status"></div>
          </div>
          <div class="stage" data-stage="Diagnostic Research">
            <div class="stage-icon">2</div>
            <div class="stage-label">Diagnostic Research</div>
            <div class="stage-status"></div>
          </div>
          <div class="stage" data-stage="Parts & Logistics">
            <div class="stage-icon">3</div>
            <div class="stage-label">Parts & Logistics</div>
            <div class="stage-status"></div>
          </div>
          <div class="stage" data-stage="Warranty Determination">
            <div class="stage-icon">4</div>
            <div class="stage-label">Warranty Determination</div>
            <div class="stage-status"></div>
          </div>
          <div class="stage" data-stage="Summary">
            <div class="stage-icon">5</div>
            <div class="stage-label">Summary</div>
            <div class="stage-status"></div>
          </div>
        </div>
        <div id="stage-output"></div>
      </section>
      <section id="results-section" class="hidden"></section>
      <div id="submission-error" class="hidden"></div>
    `;

    // Mock WebSocket
    mockWebSocketInstance = {
      readyState: 0, // CONNECTING
      close: jest.fn(),
      onopen: null as any,
      onmessage: null as any,
      onclose: null as any,
      onerror: null as any,
    };

    mockWebSocket = jest.fn(() => mockWebSocketInstance);
    (global as any).WebSocket = mockWebSocket;
    (mockWebSocket as any).OPEN = 1;
    (mockWebSocket as any).CLOSED = 3;

    // Setup VSI_APP mock
    (global as any).window = global;
    (window as any).VSI_APP = {
      showProgressSection: jest.fn(),
      showResultsSection: jest.fn(),
      showSubmissionError: jest.fn(),
      resetPortal: jest.fn(),
    };

    // Use fake timers
    jest.useFakeTimers();

    // Load the websocket module
    jest.resetModules();
    const fs = require('fs');
    const path = require('path');
    const code = fs.readFileSync(path.join(__dirname, '../../portal/websocket.js'), 'utf8');
    eval(code);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).WebSocket;
    delete (window as any).VSI_APP;
    delete (window as any).VSI_WS;
    delete (window as any).VSI_METADATA;
    delete (window as any).initWebSocket;
  });

  describe('initWebSocket', () => {
    it('should create a WebSocket connection with submissionId query param', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');

      expect(mockWebSocket).toHaveBeenCalledWith('wss://example.com/ws?submissionId=test-123');
    });

    it('should append submissionId if URL already has query params', () => {
      (window as any).initWebSocket('test-456', 'wss://example.com/ws?stage=prod');

      expect(mockWebSocket).toHaveBeenCalledWith('wss://example.com/ws?stage=prod&submissionId=test-456');
    });

    it('should expose VSI_WS global with utility functions', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');

      expect((window as any).VSI_WS).toBeDefined();
      expect((window as any).VSI_WS.disconnect).toBeInstanceOf(Function);
      expect((window as any).VSI_WS.reset).toBeInstanceOf(Function);
      expect((window as any).VSI_WS.getStageStatuses).toBeInstanceOf(Function);
      expect((window as any).VSI_WS.getStageOutputs).toBeInstanceOf(Function);
    });
  });

  describe('connection timeout', () => {
    it('should display error after 10 seconds if connection not established', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');

      // Advance time by 10 seconds
      jest.advanceTimersByTime(10000);

      expect(mockWebSocketInstance.close).toHaveBeenCalled();
      expect((window as any).VSI_APP.showSubmissionError).toHaveBeenCalledWith(
        'WebSocket connection timed out after 10 seconds'
      );
    });

    it('should NOT timeout if connection opens within 10 seconds', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');

      // Simulate successful connection
      mockWebSocketInstance.readyState = 1; // OPEN
      mockWebSocketInstance.onopen();

      // Advance time past timeout
      jest.advanceTimersByTime(15000);

      expect((window as any).VSI_APP.showSubmissionError).not.toHaveBeenCalled();
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();
    });

    it('should update stage to in_progress status', () => {
      const message = {
        submissionId: 'test-123',
        stage: 'Triage',
        status: 'in_progress',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance.onmessage({ data: JSON.stringify(message) });

      const stageEl = document.querySelector('.stage[data-stage="Triage"]');
      expect(stageEl?.classList.contains('in-progress')).toBe(true);
      expect(stageEl?.querySelector('.stage-status')?.textContent).toBe('Processing...');
    });

    it('should update stage to completed and display output summary', () => {
      const message = {
        submissionId: 'test-123',
        stage: 'Triage',
        status: 'completed',
        agentOutputSummary: 'Vehicle system classified as powertrain, severity: high',
        timestamp: '2024-01-01T00:00:01Z',
      };

      mockWebSocketInstance.onmessage({ data: JSON.stringify(message) });

      const stageEl = document.querySelector('.stage[data-stage="Triage"]');
      expect(stageEl?.classList.contains('completed')).toBe(true);
      expect(stageEl?.querySelector('.stage-status')?.textContent).toBe('Complete');

      const output = document.getElementById('stage-output');
      expect(output?.innerHTML).toContain('Triage');
      expect(output?.innerHTML).toContain('Vehicle system classified as powertrain');
    });

    it('should update stage to error and display error reason', () => {
      const message = {
        submissionId: 'test-123',
        stage: 'Diagnostic Research',
        status: 'error',
        errorReason: 'Knowledge Base retrieval failed',
        timestamp: '2024-01-01T00:00:01Z',
      };

      mockWebSocketInstance.onmessage({ data: JSON.stringify(message) });

      const stageEl = document.querySelector('.stage[data-stage="Diagnostic Research"]');
      expect(stageEl?.classList.contains('error')).toBe(true);

      const output = document.getElementById('stage-output');
      expect(output?.innerHTML).toContain('Error');
      expect(output?.innerHTML).toContain('Knowledge Base retrieval failed');
    });

    it('should ignore messages with unknown stage names', () => {
      const message = {
        submissionId: 'test-123',
        stage: 'UnknownStage',
        status: 'completed',
        timestamp: '2024-01-01T00:00:01Z',
      };

      mockWebSocketInstance.onmessage({ data: JSON.stringify(message) });

      const statuses = (window as any).VSI_WS.getStageStatuses();
      expect(statuses['UnknownStage']).toBeUndefined();
    });

    it('should ignore non-JSON messages', () => {
      mockWebSocketInstance.onmessage({ data: 'not json' });

      const statuses = (window as any).VSI_WS.getStageStatuses();
      expect(Object.keys(statuses)).toHaveLength(0);
    });

    it('should store metadata when present', () => {
      const message = {
        submissionId: 'test-123',
        stage: 'Triage',
        status: 'completed',
        agentOutputSummary: 'Done',
        timestamp: '2024-01-01T00:00:01Z',
        metadata: {
          modelId: 'nova-lite',
          latencyMs: 1500,
          tokenCount: 200,
        },
      };

      mockWebSocketInstance.onmessage({ data: JSON.stringify(message) });

      expect((window as any).VSI_METADATA).toBeDefined();
      expect((window as any).VSI_METADATA['Triage'].modelId).toBe('nova-lite');
    });
  });

  describe('pipeline completion', () => {
    beforeEach(() => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();
    });

    it('should transition to results screen when all 5 stages complete', () => {
      const stages = [
        'Triage',
        'Diagnostic Research',
        'Parts & Logistics',
        'Warranty Determination',
        'Summary',
      ];

      stages.forEach((stage) => {
        mockWebSocketInstance.onmessage({
          data: JSON.stringify({
            submissionId: 'test-123',
            stage,
            status: 'completed',
            agentOutputSummary: `${stage} complete`,
            timestamp: '2024-01-01T00:00:01Z',
          }),
        });
      });

      // Should transition after short delay
      jest.advanceTimersByTime(1000);
      expect((window as any).VSI_APP.showResultsSection).toHaveBeenCalled();
    });

    it('should NOT transition if not all stages are complete', () => {
      const stages = ['Triage', 'Diagnostic Research', 'Parts & Logistics'];

      stages.forEach((stage) => {
        mockWebSocketInstance.onmessage({
          data: JSON.stringify({
            submissionId: 'test-123',
            stage,
            status: 'completed',
            agentOutputSummary: `${stage} complete`,
            timestamp: '2024-01-01T00:00:01Z',
          }),
        });
      });

      jest.advanceTimersByTime(1000);
      expect((window as any).VSI_APP.showResultsSection).not.toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    beforeEach(() => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();
    });

    it('should attempt one reconnection on unexpected disconnect', () => {
      // Simulate disconnect
      mockWebSocketInstance.onclose({ code: 1006 });

      // Check reconnection notice appears
      const notice = document.getElementById('reconnection-notice');
      expect(notice).toBeTruthy();
      expect(notice?.classList.contains('hidden')).toBe(false);
      expect(notice?.textContent).toContain('Attempting to reconnect');

      // After delay, a new WebSocket should be created
      jest.advanceTimersByTime(1500);
      expect(mockWebSocket).toHaveBeenCalledTimes(2);
    });

    it('should NOT reconnect more than once', () => {
      // First disconnect
      mockWebSocketInstance.onclose({ code: 1006 });
      jest.advanceTimersByTime(1500);

      // Second disconnect
      mockWebSocketInstance.onclose({ code: 1006 });
      jest.advanceTimersByTime(1500);

      // Should only create 2 WebSocket instances total (original + 1 reconnect)
      expect(mockWebSocket).toHaveBeenCalledTimes(2);

      const notice = document.getElementById('reconnection-notice');
      expect(notice?.textContent).toContain('Unable to reconnect');
    });

    it('should NOT reconnect if pipeline completed', () => {
      // Complete all stages
      const stages = [
        'Triage',
        'Diagnostic Research',
        'Parts & Logistics',
        'Warranty Determination',
        'Summary',
      ];

      stages.forEach((stage) => {
        mockWebSocketInstance.onmessage({
          data: JSON.stringify({
            submissionId: 'test-123',
            stage,
            status: 'completed',
            agentOutputSummary: `${stage} complete`,
            timestamp: '2024-01-01T00:00:01Z',
          }),
        });
      });

      // Simulate disconnect after completion
      mockWebSocketInstance.onclose({ code: 1000 });
      jest.advanceTimersByTime(1500);

      // Should NOT attempt reconnection
      expect(mockWebSocket).toHaveBeenCalledTimes(1);
    });

    it('should NOT reconnect if pipeline has error', () => {
      // Set one stage to error
      mockWebSocketInstance.onmessage({
        data: JSON.stringify({
          submissionId: 'test-123',
          stage: 'Triage',
          status: 'error',
          errorReason: 'Something failed',
          timestamp: '2024-01-01T00:00:01Z',
        }),
      });

      // Simulate disconnect after error
      mockWebSocketInstance.onclose({ code: 1006 });
      jest.advanceTimersByTime(1500);

      // Should NOT attempt reconnection
      expect(mockWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('VSI_WS API', () => {
    it('should track stage statuses correctly', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();

      mockWebSocketInstance.onmessage({
        data: JSON.stringify({
          submissionId: 'test-123',
          stage: 'Triage',
          status: 'completed',
          agentOutputSummary: 'Done',
          timestamp: '2024-01-01T00:00:01Z',
        }),
      });

      const statuses = (window as any).VSI_WS.getStageStatuses();
      expect(statuses['Triage']).toBe('completed');
    });

    it('should track stage outputs correctly', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();

      mockWebSocketInstance.onmessage({
        data: JSON.stringify({
          submissionId: 'test-123',
          stage: 'Triage',
          status: 'completed',
          agentOutputSummary: 'Classified as powertrain',
          timestamp: '2024-01-01T00:00:01Z',
        }),
      });

      const outputs = (window as any).VSI_WS.getStageOutputs();
      expect(outputs['Triage']).toBe('Classified as powertrain');
    });

    it('disconnect should close the WebSocket', () => {
      (window as any).initWebSocket('test-123', 'wss://example.com/ws');
      mockWebSocketInstance.readyState = 1;
      mockWebSocketInstance.onopen();

      (window as any).VSI_WS.disconnect();

      expect(mockWebSocketInstance.close).toHaveBeenCalled();
    });
  });
});
