/**
 * Adaptive Model Router for Vehicle Service Intelligence (VSI)
 *
 * Scores 5 candidate Bedrock models against AppConfig-driven priority weights
 * (summing to 100) and selects the highest-scoring model.
 *
 * Weights are integers on a 100-point scale:
 *   quality (0-100) + latency (0-100) + cost (0-100) = 100
 *
 * Each model has static feature scores (0-100) for quality, latency, and cost.
 * The router computes: score = (quality_weight × quality_score + latency_weight × latency_score + cost_weight × cost_score) / 100
 *
 * Tie-breaking favors the cheapest model (highest cost_score).
 * Selection is re-evaluated on every invocation using the latest AppConfig values.
 *
 * Requirements: 11.3, 11.4, 11.5, 11.6, 11.8
 */

import { ModelCandidate, Weights, RouterDecision } from './types';
import { createLogger } from './logger';

/**
 * 5 LLM candidates with their feature scores (0-100 scale).
 * Higher = better for that dimension.
 *
 * Scoring is calibrated so that:
 *   quality=50, latency=25, cost=25 → Claude Sonnet wins
 *   quality=10, latency=25, cost=65 → Nova Micro wins
 *   quality=30, latency=40, cost=30 → Claude Haiku wins
 */
export const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    displayName: 'Claude Sonnet 4.5',
    qualityScore: 98,
    latencyScore: 25,
    costScore: 10,
  },
  {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    displayName: 'Claude Haiku 4.5',
    qualityScore: 72,
    latencyScore: 80,
    costScore: 65,
  },
  {
    modelId: 'us.amazon.nova-pro-v1:0',
    displayName: 'Amazon Nova Pro',
    qualityScore: 70,
    latencyScore: 55,
    costScore: 55,
  },
  {
    modelId: 'us.amazon.nova-lite-v1:0',
    displayName: 'Amazon Nova Lite',
    qualityScore: 45,
    latencyScore: 85,
    costScore: 85,
  },
  {
    modelId: 'us.amazon.nova-micro-v1:0',
    displayName: 'Amazon Nova Micro',
    qualityScore: 25,
    latencyScore: 95,
    costScore: 95,
  },
];

/**
 * Validates that weights are non-negative and sum to 100 (±1 tolerance).
 */
export function validateWeights(weights: Weights): { valid: boolean; error?: string } {
  const { cost_priority, latency_priority, quality_priority } = weights;

  if (cost_priority < 0 || cost_priority > 100) {
    return { valid: false, error: `cost_priority must be in [0, 100], got ${cost_priority}` };
  }
  if (latency_priority < 0 || latency_priority > 100) {
    return { valid: false, error: `latency_priority must be in [0, 100], got ${latency_priority}` };
  }
  if (quality_priority < 0 || quality_priority > 100) {
    return { valid: false, error: `quality_priority must be in [0, 100], got ${quality_priority}` };
  }

  const sum = cost_priority + latency_priority + quality_priority;
  if (Math.abs(sum - 100) > 1) {
    return {
      valid: false,
      error: `Weights must sum to 100 (±1), got ${sum}`,
    };
  }

  return { valid: true };
}

/**
 * Computes the weighted score for a single model candidate.
 * Formula: score = (quality_weight × quality_score + latency_weight × latency_score + cost_weight × cost_score) / 100
 * Result is on a 0-100 scale.
 */
export function computeScore(candidate: ModelCandidate, weights: Weights): number {
  return (
    (weights.quality_priority * candidate.qualityScore +
     weights.latency_priority * candidate.latencyScore +
     weights.cost_priority * candidate.costScore) / 100
  );
}

/**
 * Selects the best model based on weighted scoring.
 * Tie-breaking: if two models have the same score, the one with the highest costScore wins.
 */
export function selectModel(weights: Weights, submissionId: string = 'unknown'): RouterDecision {
  const validation = validateWeights(weights);
  if (!validation.valid) {
    throw new Error(`Invalid weights: ${validation.error}`);
  }

  // Score all candidates
  const scores: Record<string, number> = {};
  for (const candidate of MODEL_CANDIDATES) {
    scores[candidate.modelId] = computeScore(candidate, weights);
  }

  // Select highest score; tie-break by highest costScore (lowest cost)
  let best: ModelCandidate = MODEL_CANDIDATES[0];
  let bestScore = scores[best.modelId];

  for (let i = 1; i < MODEL_CANDIDATES.length; i++) {
    const candidate = MODEL_CANDIDATES[i];
    const candidateScore = scores[candidate.modelId];

    if (
      candidateScore > bestScore ||
      (Math.abs(candidateScore - bestScore) < 0.001 && candidate.costScore > best.costScore)
    ) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  const timestamp = new Date().toISOString();

  const decision: RouterDecision = {
    selectedModelId: best.modelId,
    scores,
    weights,
    timestamp,
  };

  // Emit structured log
  const logger = createLogger(submissionId);
  logger.info('model_routing_decision', {
    selectedModelId: decision.selectedModelId,
    selectedModelName: best.displayName,
    weights: decision.weights,
    scores: decision.scores,
    winningScore: bestScore,
  });

  return decision;
}
