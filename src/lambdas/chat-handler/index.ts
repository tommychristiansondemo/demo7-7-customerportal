/**
 * Chat Handler Lambda
 *
 * Provides a conversational interface for students to ask questions
 * about the VSI project architecture and deployment choices.
 * Uses Claude Sonnet 4.6 with the project knowledge file as system context.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync } from 'fs';
import { join } from 'path';

const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

// Load project knowledge at cold start
let PROJECT_KNOWLEDGE: string;
try {
  PROJECT_KNOWLEDGE = readFileSync(join(__dirname, 'project-knowledge.md'), 'utf-8');
} catch {
  PROJECT_KNOWLEDGE = 'Project knowledge file not available.';
}

const SYSTEM_PROMPT = `You are a helpful teaching assistant for an AWS Generative AI course. Students are using a demo application called "Vehicle Service Intelligence" (VSI) that demonstrates AI-powered vehicle diagnostics using multiple AWS services.

Your role is to answer questions about:
- The architecture and deployment choices made in this project
- How the various AWS services work together (Bedrock, Lambda, API Gateway, DynamoDB, AppConfig, OpenSearch, CloudFront, etc.)
- The adaptive model routing system and how AppConfig feature flags control model selection
- The RAG pipeline using Bedrock Knowledge Base with NHTSA data
- The 5-stage inference pipeline and how each stage works
- Cost considerations and trade-offs between different approaches
- General AWS and AI/ML concepts demonstrated by this application

Be concise, educational, and encouraging. Use the project knowledge below to ground your answers in the actual implementation details.

--- PROJECT KNOWLEDGE ---
${PROJECT_KNOWLEDGE}
--- END PROJECT KNOWLEDGE ---`;

interface ChatEvent {
  body?: string;
  isBase64Encoded?: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function handler(event: ChatEvent) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  try {
    // Parse request
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : event.body || '';
    const { message, history } = JSON.parse(rawBody) as {
      message: string;
      history?: ChatMessage[];
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    // Build messages array with conversation history
    const messages: ChatMessage[] = [];
    if (history && Array.isArray(history)) {
      // Include last 10 turns max to stay within context
      const recentHistory = history.slice(-10);
      messages.push(...recentHistory);
    }
    messages.push({ role: 'user', content: message.trim() });

    // Call Bedrock InvokeModel
    const requestBody = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(requestBody),
    });

    const response = await bedrockRuntime.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract assistant response
    const assistantMessage = responseBody.content
      ?.filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('\n') || 'I was unable to generate a response.';

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ response: assistantMessage }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Chat error:', errorMessage);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to generate response', details: errorMessage }),
    };
  }
}
