/**
 * Parts Lookup Lambda — MCP Tool
 *
 * Accepts a list of up to 50 part numbers, queries DynamoDB parts inventory
 * table using BatchGetItem, and returns availability_status + estimated_lead_time_days
 * for each found part. Missing parts are returned with availability_status: "not_found".
 *
 * Environment Variables:
 *   PARTS_TABLE_NAME — DynamoDB parts inventory table name
 *
 * Requirements: 5.5, 8.3, 8.4
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../shared/logger';

const MAX_PART_NUMBERS = 50;
const DYNAMO_BATCH_LIMIT = 100;

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export interface PartsLookupRequest {
  part_numbers: string[];
  submission_id?: string;
}

export interface PartsLookupResponseEntry {
  part_number: string;
  availability_status: 'in_stock' | 'backordered' | 'discontinued' | 'not_found';
  estimated_lead_time_days?: number;
}

export interface PartsLookupResponse {
  parts: PartsLookupResponseEntry[];
}

export async function handler(event: PartsLookupRequest): Promise<PartsLookupResponse> {
  const submissionId = event.submission_id || 'unknown';
  const logger = createLogger(submissionId);

  logger.info('mcp_tool_call_initiated', {
    tool_name: 'parts_lookup',
    part_count: event.part_numbers?.length ?? 0,
  });

  const tableName = process.env.PARTS_TABLE_NAME;
  if (!tableName) {
    logger.error('error', { message: 'PARTS_TABLE_NAME environment variable is required' });
    throw new Error('PARTS_TABLE_NAME environment variable is required');
  }

  // Validate input
  if (!event.part_numbers || !Array.isArray(event.part_numbers)) {
    logger.error('error', { message: 'part_numbers must be a non-empty array' });
    throw new Error('part_numbers must be a non-empty array');
  }

  if (event.part_numbers.length === 0) {
    logger.info('mcp_tool_call_completed', { tool_name: 'parts_lookup', result_count: 0 });
    return { parts: [] };
  }

  if (event.part_numbers.length > MAX_PART_NUMBERS) {
    logger.error('error', {
      message: `Cannot request more than ${MAX_PART_NUMBERS} part numbers at once`,
      requested: event.part_numbers.length,
    });
    throw new Error(`Cannot request more than ${MAX_PART_NUMBERS} part numbers at once. Received: ${event.part_numbers.length}`);
  }

  // Deduplicate part numbers while preserving order for response
  const uniquePartNumbers = [...new Set(event.part_numbers)];

  // Chunk into batches of DYNAMO_BATCH_LIMIT (100) for BatchGetItem
  // With max 50 input, we won't exceed this, but handle it defensively
  const foundParts = new Map<string, PartsLookupResponseEntry>();

  for (let i = 0; i < uniquePartNumbers.length; i += DYNAMO_BATCH_LIMIT) {
    const chunk = uniquePartNumbers.slice(i, i + DYNAMO_BATCH_LIMIT);

    const keys = chunk.map((partNumber) => ({ part_number: partNumber }));

    const command = new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: keys,
          ProjectionExpression: 'part_number, availability_status, estimated_lead_time_days',
        },
      },
    });

    const result = await docClient.send(command);

    // Process returned items
    const items = result.Responses?.[tableName] || [];
    for (const item of items) {
      foundParts.set(item.part_number as string, {
        part_number: item.part_number as string,
        availability_status: item.availability_status as PartsLookupResponseEntry['availability_status'],
        estimated_lead_time_days: item.estimated_lead_time_days as number,
      });
    }

    // Handle unprocessed keys with retry
    let unprocessedKeys = result.UnprocessedKeys?.[tableName];
    let retries = 0;
    while (unprocessedKeys && unprocessedKeys.Keys && unprocessedKeys.Keys.length > 0 && retries < 3) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 1000 * retries));

      const retryCommand = new BatchGetCommand({
        RequestItems: {
          [tableName]: unprocessedKeys,
        },
      });

      const retryResult = await docClient.send(retryCommand);
      const retryItems = retryResult.Responses?.[tableName] || [];
      for (const item of retryItems) {
        foundParts.set(item.part_number as string, {
          part_number: item.part_number as string,
          availability_status: item.availability_status as PartsLookupResponseEntry['availability_status'],
          estimated_lead_time_days: item.estimated_lead_time_days as number,
        });
      }
      unprocessedKeys = retryResult.UnprocessedKeys?.[tableName];
    }
  }

  // Build response: one entry per originally requested part number
  const parts: PartsLookupResponseEntry[] = event.part_numbers.map((partNumber) => {
    const found = foundParts.get(partNumber);
    if (found) {
      return found;
    }
    // Part not found in DynamoDB — return not_found status with no other fields
    return {
      part_number: partNumber,
      availability_status: 'not_found' as const,
    };
  });

  logger.info('mcp_tool_call_completed', {
    tool_name: 'parts_lookup',
    result_count: parts.length,
    found_count: foundParts.size,
    not_found_count: parts.length - foundParts.size,
  });

  return { parts };
}
