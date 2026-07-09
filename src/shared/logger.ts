/**
 * Structured JSON logger for Vehicle Service Intelligence (VSI)
 *
 * Emits structured JSON logs to stdout (picked up by CloudWatch).
 * Each log entry includes: event_type, submission_id, timestamp (ISO 8601),
 * and relevant context fields for the event type.
 *
 * Requirement 14.5: Structured JSON logs with event types for all pipeline events.
 */

import { LogEventType } from './types';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  level: LogLevel;
  event_type: LogEventType;
  submission_id: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Creates a structured JSON logger bound to a specific submission.
 */
export function createLogger(submissionId: string) {
  return new Logger(submissionId);
}

export class Logger {
  private readonly submissionId: string;

  constructor(submissionId: string) {
    this.submissionId = submissionId;
  }

  /**
   * Emit a structured log entry at INFO level.
   */
  info(eventType: LogEventType, context: Record<string, unknown> = {}): void {
    this.emit('INFO', eventType, context);
  }

  /**
   * Emit a structured log entry at WARN level.
   */
  warn(eventType: LogEventType, context: Record<string, unknown> = {}): void {
    this.emit('WARN', eventType, context);
  }

  /**
   * Emit a structured log entry at ERROR level.
   */
  error(eventType: LogEventType, context: Record<string, unknown> = {}): void {
    this.emit('ERROR', eventType, context);
  }

  /**
   * Emit a structured log entry at DEBUG level.
   */
  debug(eventType: LogEventType, context: Record<string, unknown> = {}): void {
    this.emit('DEBUG', eventType, context);
  }

  /**
   * Core emit function. Writes a single JSON line to stdout.
   */
  private emit(
    level: LogLevel,
    eventType: LogEventType,
    context: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level,
      event_type: eventType,
      submission_id: this.submissionId,
      timestamp: new Date().toISOString(),
      ...context,
    };

    // Write as a single JSON line — CloudWatch picks up each line as a log event
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}
