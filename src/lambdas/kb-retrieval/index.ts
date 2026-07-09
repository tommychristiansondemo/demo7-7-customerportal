import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { createLogger } from '../../shared/logger';

/**
 * KB Retrieval Lambda (MCP Tool)
 *
 * Retrieves relevant TSB (Technical Service Bulletin) document excerpts
 * from a Bedrock Knowledge Base. Invoked by AgentCore Gateway as an MCP tool.
 *
 * Environment Variables:
 *   KNOWLEDGE_BASE_ID — The Bedrock Knowledge Base ID to query (also accepts KB_ID)
 *   TOP_K             — Number of excerpts to return (1–10, default 3)
 *
 * Requirements: 5.3, 6.2, 7.4
 */

const bedrockClient = new BedrockAgentRuntimeClient({});

interface KBRetrievalEvent {
  query: string;
  submissionId?: string;
}

interface RetrievalExcerpt {
  documentId: string;
  content: string;
  score?: number;
  source?: string;
  metadata?: Record<string, string>;
}

interface KBRetrievalResponse {
  excerpts: RetrievalExcerpt[];
  query: string;
  knowledgeBaseId: string;
  resultCount: number;
}

interface ErrorResponse {
  error: string;
  message: string;
}

export async function handler(
  event: KBRetrievalEvent
): Promise<KBRetrievalResponse | ErrorResponse> {
  const submissionId = event.submissionId || 'unknown';
  const logger = createLogger(submissionId);

  const knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID || process.env.KB_ID;
  const topK = Math.min(
    10,
    Math.max(1, parseInt(process.env.TOP_K || '3', 10) || 3)
  );

  // Validate required configuration
  if (!knowledgeBaseId) {
    logger.error('error', {
      message: 'KNOWLEDGE_BASE_ID environment variable is not configured',
    });
    return {
      error: 'CONFIGURATION_ERROR',
      message: 'Knowledge Base ID is not configured',
    };
  }

  // Validate query input
  const query = event.query;
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    logger.error('error', {
      message: 'Missing or empty query string',
    });
    return {
      error: 'VALIDATION_ERROR',
      message: 'A non-empty query string is required',
    };
  }

  logger.info('mcp_tool_call_initiated', {
    tool: 'kb_retrieval',
    knowledgeBaseId,
    topK,
    queryLength: query.trim().length,
  });

  try {
    const command = new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: {
        text: query.trim(),
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: topK,
        },
      },
    });

    const response: RetrieveCommandOutput = await bedrockClient.send(command);

    const excerpts: RetrievalExcerpt[] = (response.retrievalResults || []).map(
      (result) => {
        const excerpt: RetrievalExcerpt = {
          documentId:
            result.location?.s3Location?.uri ||
            result.metadata?.['document_id']?.toString() ||
            'unknown',
          content: result.content?.text || '',
          score: result.score,
        };

        // Include S3 source URI if available
        if (result.location?.s3Location?.uri) {
          excerpt.source = result.location.s3Location.uri;
        }

        // Include metadata if available
        if (result.metadata) {
          excerpt.metadata = {};
          for (const [key, value] of Object.entries(result.metadata)) {
            if (value !== undefined && value !== null) {
              excerpt.metadata[key] = String(value);
            }
          }
        }

        return excerpt;
      }
    );

    logger.info('mcp_tool_call_completed', {
      tool: 'kb_retrieval',
      knowledgeBaseId,
      resultCount: excerpts.length,
      topK,
    });

    return {
      excerpts,
      query: query.trim(),
      knowledgeBaseId,
      resultCount: excerpts.length,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error('error', {
      tool: 'kb_retrieval',
      message: 'Failed to retrieve from Knowledge Base',
      error: errorMessage,
      knowledgeBaseId,
    });

    return {
      error: 'RETRIEVAL_ERROR',
      message: `Knowledge Base retrieval failed: ${errorMessage}`,
    };
  }
}
