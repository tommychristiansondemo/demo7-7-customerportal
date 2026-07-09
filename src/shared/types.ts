/**
 * Shared TypeScript interfaces for Vehicle Service Intelligence (VSI)
 * All data models used across Lambda handlers, agents, and the pipeline.
 */

// --- Intake Submission & Response ---

export interface IntakeSubmission {
  vehicleModel: string;          // Required, 1-100 chars (e.g. "Armada SL")
  modelYear: number;             // Required, 4-digit year
  symptomDescription: string;    // Required, 1-2000 chars
  dtcCodes?: string[];           // Optional, array of DTC strings
}

export interface IntakeResponse {
  submissionId: string;          // UUID v4
  websocketUrl: string;          // Full WSS URL with submissionId param
  timestamp: string;             // ISO 8601
}

// --- Pipeline Status ---

export type PipelineStage =
  | 'Triage'
  | 'Diagnostic Research'
  | 'Parts & Logistics'
  | 'Warranty Determination'
  | 'Summary';

export type PipelineStatus = 'in_progress' | 'completed' | 'error';

export interface PipelineStatusMetadata {
  modelId: string;
  latencyMs: number;
  tokenCount?: number;
  estimatedCostUsd?: number;
}

export interface PipelineStatusMessage {
  submissionId: string;
  stage: PipelineStage;
  status: PipelineStatus;
  agentOutputSummary?: string;   // Present when completed
  errorReason?: string;          // Present when error
  timestamp: string;             // ISO 8601
  metadata?: PipelineStatusMetadata;
}

// --- Agent Output Schemas ---

export type VehicleSystem = 'powertrain' | 'ev_battery' | 'adas' | 'infotainment' | 'other';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface TriageOutput {
  vehicleSystem: VehicleSystem;
  severity: Severity;
  dtcCodes: string[];
  classificationReasoning: string;
}

export interface DiagnosticExcerpt {
  documentId: string;
  tsbNumber: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
}

export interface DiagnosticResearchOutput {
  excerpts: DiagnosticExcerpt[];
  queryUsed: string;
}

export type PartAvailabilityStatus = 'in_stock' | 'backordered' | 'discontinued' | 'not_found';

export interface PartResult {
  partNumber: string;
  availabilityStatus: PartAvailabilityStatus;
  estimatedLeadTimeDays?: number;
}

export interface PartsLogisticsOutput {
  parts: PartResult[];
}

export type WarrantyStatus = 'covered' | 'partially_covered' | 'not_covered';
export type WarrantyType = 'new_vehicle_limited' | 'powertrain' | 'none';

export interface WarrantyResult {
  warrantyStatus: WarrantyStatus;
  applicableWarrantyType: WarrantyType;
  coverageDetails: string;
  syntheticMileage: number;
}

export interface SummaryOutput {
  vehicleInfo: {
    model: string;
    year: number;
    telematicsId: string;
  };
  triage: TriageOutput;
  diagnosticResearch: DiagnosticResearchOutput;
  partsLogistics: PartsLogisticsOutput;
  warranty: WarrantyResult;
  technicianNarrative: string;
}

// --- Model Router ---

export interface ModelCandidate {
  modelId: string;
  displayName: string;
  costScore: number;      // 0-100 (higher = cheaper)
  latencyScore: number;   // 0-100 (higher = faster)
  qualityScore: number;   // 0-100 (higher = better quality)
}

export interface Weights {
  cost_priority: number;    // 0-100
  latency_priority: number; // 0-100
  quality_priority: number; // 0-100
  // Must sum to 100
}

export interface RouterDecision {
  selectedModelId: string;
  scores: Record<string, number>;
  weights: Weights;
  timestamp: string;       // ISO 8601
}

// --- DynamoDB Records ---

export interface PartsInventoryRecord {
  part_number: string;              // PK
  description: string;
  vehicle_systems: string[];
  availability_status: 'in_stock' | 'backordered' | 'discontinued';
  estimated_lead_time_days: number; // 0-365
  unit_cost_usd: number;           // 0.01-9999.99
}

export interface WebSocketConnectionRecord {
  connectionId: string;            // PK
  submissionId: string;
  connectedAt: string;             // ISO 8601
  ttl: number;                     // epoch seconds
}

// --- Structured Log Event Types ---

export type LogEventType =
  | 'intake_submission_received'
  | 'agent_stage_started'
  | 'agent_stage_completed'
  | 'model_routing_decision'
  | 'mcp_tool_call_initiated'
  | 'mcp_tool_call_completed'
  | 'websocket_publish'
  | 'error';
