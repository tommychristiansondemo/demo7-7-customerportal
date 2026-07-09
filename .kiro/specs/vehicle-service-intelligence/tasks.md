# Implementation Plan: Vehicle Service Intelligence (VSI)

## Overview

This plan breaks down the VSI demo application into incremental, independently testable tasks following the CDK stack dependency order from the design. Each task produces working code that builds on prior steps, culminating in a fully deployable five-agent diagnostic pipeline. TypeScript is used throughout (CDK infrastructure, Lambda handlers, property tests with fast-check).

## Tasks

- [x] 1. Project scaffolding and shared modules
  - [x] 1.1 Initialize CDK project structure
    - Create `cdk.json`, `tsconfig.json`, `package.json` with dependencies (aws-cdk-lib, constructs, esbuild, fast-check, @types/node)
    - Create `bin/app.ts` CDK entry point instantiating `VsiStack`
    - Create `lib/stacks/vsi-stack.ts` root stack shell that will compose nested stacks
    - Set up `test/` directory structure for unit, property, and integration tests
    - _Requirements: 16.1, 16.4_

  - [x] 1.2 Implement shared types and utilities
    - Create `src/shared/types.ts` with all TypeScript interfaces (IntakeSubmission, IntakeResponse, PipelineStatusMessage, agent output schemas, ModelCandidate, Weights, RouterDecision)
    - Create `src/shared/logger.ts` structured JSON logger with event_type, submission_id, timestamp fields
    - _Requirements: 14.5_

  - [x] 1.3 Create reusable CDK constructs
    - Create `lib/constructs/lambda-function.ts` reusable Lambda construct with X-Ray tracing, structured logging, 7-day log retention
    - Create `lib/constructs/vpc-construct.ts` VPC construct with private subnets, no NAT/IGW
    - _Requirements: 14.1, 14.3, 15.1_

- [x] 2. DNS and Certificate stack
  - [x] 2.1 Implement DnsCertificateStack
    - Create `lib/stacks/dns-certificate-stack.ts`
    - Import existing Route 53 hosted zone by ID from CDK context
    - Provision ACM certificate for `nissan.awsteach.com` in us-east-1 with DNS validation
    - Create CNAME validation records in the hosted zone
    - Fail with descriptive error if hosted zone ID context value is missing
    - Export certificate ARN as CloudFormation output
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [x] 3. Static hosting stack
  - [x] 3.1 Implement StaticHostingStack
    - Create `lib/stacks/static-hosting-stack.ts`
    - Provision S3 bucket with all public access blocked, `autoDeleteObjects: true`, `removalPolicy: DESTROY`
    - Configure CloudFront distribution with OAC (no public bucket policy)
    - Set `index.html` as default root object
    - Configure custom error response for 403/404 → serve `index.html` with 200 (SPA routing)
    - HTTP → HTTPS redirect
    - Attach ACM certificate from DnsCertificateStack, add `nissan.awsteach.com` as CNAME
    - Create Route 53 A-record alias pointing to CloudFront distribution
    - Export CloudFront distribution URL
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 15.3, 15.6, 16.5_

- [x] 4. Portal SPA — intake form and basic structure
  - [x] 4.1 Create Portal HTML/CSS/JS scaffolding
    - Create `portal/index.html` with intake form (vehicleModel text, modelYear numeric, telematicsId text, symptomDescription textarea, dtcCodes optional dropdown)
    - Create `portal/styles.css` with responsive layout, form styling, progress indicator styles, report styles
    - Create `portal/app.js` with client-side validation (required field checks), form submission logic (POST to HTTP API), loading indicator toggle
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

  - [x] 4.2 Create Portal WebSocket connection management
    - Create `portal/websocket.js` with WebSocket connect (using submissionId query param), message parsing, reconnection on unexpected disconnect (one attempt), 10-second connection timeout with error display
    - Implement visual progress indicator with 5 labelled stages that updates on status messages
    - Implement transition to results screen when all 5 stages complete
    - _Requirements: 3.7, 4.1, 4.5, 4.6, 4.7, 4.8_

- [x] 5. DynamoDB data stack
  - [x] 5.1 Implement DataStack with parts inventory table and seed data
    - Create `lib/stacks/data-stack.ts`
    - Provision DynamoDB table with partition key `part_number` (String), `removalPolicy: DESTROY`
    - Create custom resource Lambda to seed ≥20 fictional part records with fields: part_number, description, vehicle_systems (list), availability_status (in_stock|backordered|discontinued), estimated_lead_time_days (0-365), unit_cost_usd (0.01-9999.99)
    - Export table name and ARN
    - _Requirements: 8.1, 8.2, 16.5_

- [x] 6. AppConfig stack
  - [x] 6.1 Implement AppConfigStack
    - Create `lib/stacks/appconfig-stack.ts`
    - Provision AppConfig application `vsi-model-routing`, environment `production`, freeform JSON configuration profile
    - Set default content: `{"cost_priority": 0.33, "latency_priority": 0.33, "quality_priority": 0.34}`
    - Create immediate deployment strategy (0-minute bake)
    - Export application ID, environment ID, configuration profile ID
    - _Requirements: 11.1, 11.7_

- [x] 7. Model Router shared module
  - [x] 7.1 Implement Model Router scoring logic
    - Create `src/shared/model-router.ts`
    - Define static model scores table (Nova Lite: cost 0.9, latency 0.9, quality 0.4; Nova Pro: cost 0.6, latency 0.6, quality 0.7; Claude Sonnet 3.5: cost 0.3, latency 0.4, quality 0.95)
    - Implement scoring formula: `score = (cost_priority × costScore) + (latency_priority × latencyScore) + (quality_priority × qualityScore)`
    - Implement tie-breaking: highest costScore wins
    - Implement weight validation: each in [0.0, 1.0], sum to 1.0 ±0.001
    - Emit structured log on model selection (model ID, weights, scores, timestamp)
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.8_

  - [x] 7.2 Write property test: Model Router selects highest-scoring candidate
    - **Property 1: Model Router selects the highest-scoring candidate**
    - Create `test/property/model-router.property.ts`
    - Generate random valid weight triples summing to 1.0
    - Assert selected model always has highest computed score
    - Assert tie-breaking selects highest costScore
    - **Validates: Requirements 11.3, 11.4**

  - [x] 7.3 Write property test: Weight validation accepts valid and rejects invalid
    - **Property 2: Weight validation accepts valid triples and rejects invalid ones**
    - Generate random triples (both valid and invalid)
    - Assert valid triples (each in [0,1], sum ≈ 1.0) are accepted
    - Assert invalid triples are rejected
    - **Validates: Requirements 11.6, 11.8**

- [x] 8. Checkpoint — Ensure shared modules and foundational stacks compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. HTTP API stack and Intake Handler Lambda
  - [x] 9.1 Implement Intake Handler Lambda
    - Create `src/lambdas/intake-handler/index.ts`
    - Validate payload (vehicleModel, modelYear, symptomDescription required)
    - Generate UUID submission ID
    - Generate synthetic mileage from telematics ID
    - Invoke Pipeline Orchestrator Lambda asynchronously
    - Return `{ submissionId, websocketUrl, timestamp }` with 201 status
    - Return 400 with descriptive error for invalid payloads
    - Include AppConfig Lambda extension layer for model router access
    - _Requirements: 3.3, 5.2, 9.3_

  - [x] 9.2 Implement ApiStack CDK
    - Create `lib/stacks/api-stack.ts`
    - Provision HTTP API (API Gateway v2) with CORS for `https://nissan.awsteach.com`
    - Create POST `/submissions` route → Intake Handler Lambda
    - Create PUT `/config/weights` route → Weights Updater Lambda
    - Create GET `/config/weights` route → Weights Updater Lambda
    - Enable X-Ray tracing on HTTP API
    - Dedicated IAM role for Intake Handler (invoke pipeline Lambda, InvokeAgentRuntime)
    - Export HTTP API endpoint URL
    - _Requirements: 14.1, 15.1, 15.2, 16.2_

  - [x] 9.3 Implement AppConfig Weights Updater Lambda
    - Create `src/lambdas/appconfig-weights-updater/index.ts`
    - PUT handler: validate weights sum to 1.0 ±0.001, each in [0.0, 1.0]; create new AppConfig hosted config version; start deployment; return 200 with timestamp
    - GET handler: read current config via AppConfig extension; return current weights + lastUpdated
    - Return 400 for invalid weights, 500 for AppConfig failures
    - _Requirements: 11.6, 11.8, 12.5, 12.7_

- [x] 10. WebSocket stack
  - [x] 10.1 Implement WebSocket connect/disconnect Lambdas
    - Create `src/lambdas/websocket-connect/index.ts` — extract submissionId from query params, store `{ connectionId, submissionId, connectedAt, ttl }` in connections DDB table
    - Create `src/lambdas/websocket-disconnect/index.ts` — delete connection record from DDB
    - _Requirements: 4.2_

  - [x] 10.2 Implement WebSocketStack CDK
    - Create `lib/stacks/websocket-stack.ts`
    - Provision WebSocket API with `$connect`, `$disconnect`, `$default` routes
    - Provision DynamoDB connections table (PK: connectionId, GSI: submissionId-index, TTL on `ttl` attribute)
    - Dedicated IAM roles for connect (PutItem) and disconnect (DeleteItem) Lambdas
    - Export WebSocket API endpoint URL, connections table name/ARN
    - _Requirements: 4.1, 4.2, 16.2_

  - [x] 10.3 Implement WebSocket Publisher Lambda
    - Create `src/lambdas/websocket-publisher/index.ts`
    - Query connections table GSI by submissionId
    - For each connectionId, call `postToConnection` with status message
    - On `GoneException`, delete stale connection record
    - Structure messages per PipelineStatusMessage interface
    - _Requirements: 4.3, 4.4_

  - [x] 10.4 Write property test: WebSocket fan-out delivers to all connections
    - **Property 5: WebSocket fan-out delivers to all connections for a submission**
    - Create `test/property/websocket-fanout.property.ts`
    - Generate random connection sets (1-20), random stale positions
    - Assert delivery attempts + stale deletions equals total connections
    - **Validates: Requirements 4.3**

  - [x] 10.5 Write property test: Pipeline status messages contain all required fields
    - **Property 8: Pipeline status messages contain all required fields**
    - Create `test/property/status-message.property.ts`
    - Generate random stage events with varying completeness
    - Assert all required fields present based on status type
    - **Validates: Requirements 4.4**

- [x] 11. Knowledge Base stack
  - [x] 11.1 Implement KnowledgeBaseStack CDK
    - Create `lib/stacks/knowledge-base-stack.ts`
    - Provision S3 bucket for TSB documents (removalPolicy: DESTROY)
    - Provision OpenSearch Serverless collection (vector store)
    - Provision Bedrock Knowledge Base with Titan Embed Text v2 embedding model
    - Configure S3 data source with default chunking (300 tokens, 20% overlap)
    - Export KB ID, KB ARN, TSB bucket name
    - _Requirements: 7.1, 7.2_

- [x] 12. Synthetic TSB document set
  - [x] 12.1 Create 15 synthetic TSB documents
    - Create `docs/synthetic-tsbs/TSB-DEMO-001.md` through `TSB-DEMO-015.md`
    - Each document: fictional TSB number, vehicle system classification, symptom, root cause, corrective action, 2-10 fictional part numbers
    - Cover all required systems: EV battery (≥3 docs), powertrain (≥3), ADAS (≥3), infotainment (≥3), other (≥2)
    - Include disclaimer as first line in each document
    - Use only fictional manufacturer/model names, no real OEM part formats, no VIN-format strings
    - Include metadata fields: document_id, vehicle_system, severity_keywords, tsb_number
    - _Requirements: 7.3, 7.5, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 13. MCP Tool Lambdas
  - [x] 13.1 Implement KB Retrieval Lambda
    - Create `src/lambdas/kb-retrieval/index.ts`
    - Call `bedrock-agent-runtime:Retrieve` with query string
    - Return top-k excerpts (k configurable via env var, default 3)
    - _Requirements: 5.3, 6.2, 7.4_

  - [x] 13.2 Implement Parts Lookup Lambda
    - Create `src/lambdas/parts-lookup/index.ts`
    - Accept list of up to 50 part numbers
    - BatchGetItem on DynamoDB parts table
    - Return availability_status + estimated_lead_time_days per found part
    - Return `{ part_number, availability_status: "not_found" }` for missing parts
    - _Requirements: 5.5, 8.3, 8.4_

  - [x] 13.3 Write property test: Parts lookup returns correct status
    - **Property 4: Parts lookup returns correct status for all requested part numbers**
    - Create `test/property/parts-lookup.property.ts`
    - Generate random part number lists (mix existing + non-existing)
    - Assert response count equals request count
    - Assert existing parts get real status, missing parts get "not_found"
    - **Validates: Requirements 8.3, 8.4**

  - [x] 13.4 Implement Warranty Rules Lambda
    - Create `src/lambdas/warranty-rules/index.ts`
    - Compute synthetic mileage: `numericHash(telematicsId) % 100_000`
    - Apply warranty rules: new-vehicle limited (≤3 years + <36000 mi), powertrain (≤5 years + <60000 mi), else not_covered
    - Return warranty_status, applicable_warranty_type, coverage_details, syntheticMileage
    - Handle missing/invalid inputs → not_covered with descriptive message
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 13.5 Write property test: Warranty determination is deterministic and correct
    - **Property 3: Warranty determination is deterministic and correct**
    - Create `test/property/warranty-rules.property.ts`
    - Generate random model years (1990-2030), random telematics IDs
    - Assert determinism (same inputs → same output)
    - Assert correct coverage tier based on year/mileage rules
    - Assert invalid inputs → not_covered
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [x] 13.6 Implement PrivateLink Service Lambda
    - Create `src/lambdas/privatelink-service/index.ts`
    - HTTP GET to ECS mock service via VPC endpoint at `/dealer-parts`
    - 10-second timeout, no retry
    - Return response body on success, error response on non-2xx or timeout
    - _Requirements: 10.3, 10.4_

- [x] 14. Checkpoint — Ensure all tool Lambdas compile and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. VPC and ECS PrivateLink stack
  - [x] 15.1 Implement PrivateLinkStack CDK
    - Create `lib/stacks/privatelink-stack.ts`
    - Provision VPC (10.0.0.0/16) with private subnets only (no public, no NAT, no IGW)
    - VPC Gateway Endpoints for S3 and DynamoDB, Interface Endpoints for CloudWatch and X-Ray
    - Provision ECS Fargate task (0.25 vCPU, 512 MB) running mock dealer service
    - Provision NLB on port 80 targeting ECS task (multi-AZ)
    - Provision VPC Endpoint Service with auto-accept enabled
    - Configure security groups: sg-nlb, sg-ecs, sg-lambda per design specs
    - Deny outbound to 0.0.0.0/0 except VPC CIDR + AWS endpoints
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 15.2 Implement ECS mock dealer service
    - Create `src/ecs/Dockerfile` (Node.js base image)
    - Create `src/ecs/server.ts` — HTTP server on port 80, GET `/dealer-parts` returns deterministic JSON mock dealer inventory response
    - _Requirements: 10.1_

- [x] 16. AgentCore stack
  - [x] 16.1 Implement AgentCoreStack CDK
    - Create `lib/stacks/agentcore-stack.ts`
    - Provision AgentCore Runtime (HTTP protocol, 900s idle timeout)
    - Define 5 agent prompt templates (Intake_Triage, Diagnostic_Research, Parts_Logistics, Warranty_Determination, Summary_Orchestrator)
    - Provision AgentCore Gateway (MCP protocol, AWS_IAM authorizer)
    - Register 4 MCP targets: kb_retrieval, parts_lookup, warranty_rules, privatelink_service (all Lambda-backed)
    - Dedicated IAM roles per MCP tool Lambda with least-privilege permissions
    - AgentCore Runtime role with only required Bedrock/AgentCore actions
    - _Requirements: 5.1, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 15.4_

- [x] 17. Pipeline Orchestrator Lambda
  - [x] 17.1 Implement Pipeline Orchestrator
    - Create `src/lambdas/pipeline-orchestrator/index.ts`
    - Sequential loop over 5 agent stages
    - For each stage: call Model Router → invoke AgentCore Runtime → publish in_progress status → await completion → publish completed status with output summary
    - On error: publish error status with stage name and reason, halt pipeline
    - 300s timeout, X-Ray subsegments per agent with annotations (agent_name, model_id, submission_id)
    - Emit structured logs for stage_started, stage_completed, model_routing_decision
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 14.2, 14.5_

  - [x] 17.2 Write property test: Pipeline failure halts subsequent execution
    - **Property 6: Pipeline failure at any stage halts subsequent execution**
    - Create `test/property/pipeline-sequencing.property.ts`
    - Generate random failure positions (1-5)
    - Assert no agent at position > K is invoked after failure at K
    - Assert error event contains stage name and failure reason
    - **Validates: Requirements 5.8, 5.9**

- [x] 18. Portal WebSocket integration and live status view
  - [x] 18.1 Implement live pipeline progress UI
    - Update `portal/app.js` to wire WebSocket status messages to the 5-stage progress indicator
    - Highlight completed stages, show agent output summaries
    - Display error state with stage name and reason on error messages
    - Handle reconnection notification display
    - _Requirements: 4.5, 4.6, 4.7, 4.8_

- [x] 19. Portal final report display and observability dashboard
  - [x] 19.1 Implement final report rendering
    - Add results screen to `portal/index.html` and `portal/app.js`
    - Display: vehicle info, triage classification/severity, top 3 TSB excerpts, parts availability table, warranty status/details, technician narrative
    - Display placeholder messages for missing agent data sections
    - Add "Start New Submission" button that resets form and clears results
    - _Requirements: 13.1, 13.3, 13.4_

  - [x] 19.2 Implement observability dashboard in Portal
    - Display: total pipeline duration, per-agent latency, model IDs per agent, active weights, token counts, estimated cost per step
    - Data sourced from WebSocket metadata fields
    - _Requirements: 13.2_

- [x] 20. Instructor Controls panel
  - [x] 20.1 Implement Instructor Controls UI
    - Create `portal/instructor.html` at `/instructor` path (not linked from main nav)
    - Create `portal/instructor.js`
    - Three range sliders (0 to 1, step 0.01): Cost Priority, Latency Priority, Quality Priority
    - Implement slider normalization: moved slider keeps value, others set to `(1.0 - moved_value) / 2`
    - Save button: disable on click, PUT weights to HTTP API, re-enable on response
    - Display success timestamp or error message
    - Load current weights via GET on page load
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.8_

  - [x] 20.2 Write property test: Slider normalization preserves sum invariant
    - **Property 7: Slider normalization preserves sum invariant**
    - Create `test/property/slider-normalization.property.ts`
    - Generate random slider values [0.0, 1.0], random slider index (0-2)
    - Assert resulting 3 values always sum to 1.0 ±0.001
    - Assert moved slider retains its value
    - **Validates: Requirements 12.3**

- [x] 21. Checkpoint — Ensure full pipeline flow works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Observability stack
  - [x] 22.1 Implement ObservabilityStack CDK
    - Create `lib/stacks/observability-stack.ts`
    - Configure X-Ray tracing on all Lambda functions
    - Create CloudWatch Log Groups with 7-day retention for all Lambdas and API Gateway access logs
    - Create CloudWatch custom metric namespace `VSI/ModelRouter` (ModelSelected count) and `VSI/Pipeline` (AgentLatency, PipelineCompleted, PipelineError)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 23. Architecture diagram
  - [x] 23.1 Create Mermaid architecture diagram
    - Create `docs/architecture.md` with valid Mermaid syntax
    - Include all required nodes: Portal, CloudFront, S3_Assets, HTTP_API, WebSocket_API, all Lambdas, AgentCore_Runtime, AgentCore_Gateway, Knowledge_Base, DynamoDB_Parts, PrivateLink_ECS, Model_Router, AppConfig_Extension, AppConfig, XRay, CloudWatch
    - Label all directed edges with protocol/service (HTTPS, OAC/S3, invoke, SDK, MCP, PrivateLink/HTTP, HTTP localhost)
    - _Requirements: 18.1, 18.2, 18.3_

- [x] 24. README and deployment scripts
  - [x] 24.1 Create README with deployment and teardown instructions
    - Create `README.md` with project overview
    - Numbered step-by-step redeploy instructions (prerequisites: Node.js, AWS CLI, CDK bootstrap)
    - Reset procedure (DynamoDB truncation, S3 re-upload, AppConfig default weights)
    - Teardown command sequence (`cdk destroy`)
    - Document CDK context values required (hosted zone ID)
    - _Requirements: 16.3_

- [x] 25. CDK assertion tests and cdk-nag validation
  - [x] 25.1 Write CDK assertion tests for all stacks
    - Create `test/unit/` test files for each stack
    - Assert expected resources are created
    - Assert no wildcard IAM actions or resources
    - Assert S3 bucket has no public access
    - Assert all Lambdas have X-Ray tracing enabled
    - Assert log groups have 7-day retention
    - _Requirements: 15.1, 15.2, 15.3, 15.5_

  - [x] 25.2 Add cdk-nag AwsSolutions validation
    - Install cdk-nag package
    - Add Aspects.of(app).add(new AwsSolutionsChecks()) to app entry
    - Verify zero ERROR-level violations for IAM, S3, CloudFront, Lambda resources
    - Add suppressions only where architecturally justified (demo no-auth)
    - _Requirements: 15.5_

- [x] 26. Integration testing
  - [x] 26.1 Write integration test suite
    - Create `test/integration/` directory
    - Test end-to-end submission flow (POST → WebSocket → 5 status messages)
    - Test AgentCore Gateway MCP tool invocations
    - Test Knowledge Base retrieval with sample queries
    - Test PrivateLink connectivity (Lambda → VPC Endpoint → ECS)
    - Test AppConfig weight update propagation (≤45s)
    - _Requirements: 5.1, 6.3, 7.4, 10.3, 11.7_

- [x] 27. Final checkpoint — Ensure all tests pass and full deployment succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The CDK stack dependency order is respected: DNS → Static Hosting → Data/KB/AppConfig → API → WebSocket → AgentCore → PrivateLink → Observability
- All Lambda handlers use TypeScript with esbuild bundling
- fast-check is the property-based testing library (TypeScript)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["3.1", "7.2", "7.3"] },
    { "id": 4, "tasks": ["4.1", "9.1", "9.3", "10.1", "11.1", "12.1"] },
    { "id": 5, "tasks": ["4.2", "9.2", "10.2", "10.3", "13.1", "13.2", "13.4", "13.6", "15.1", "15.2"] },
    { "id": 6, "tasks": ["10.4", "10.5", "13.3", "13.5", "16.1"] },
    { "id": 7, "tasks": ["17.1"] },
    { "id": 8, "tasks": ["17.2", "18.1"] },
    { "id": 9, "tasks": ["19.1", "19.2", "20.1"] },
    { "id": 10, "tasks": ["20.2", "22.1"] },
    { "id": 11, "tasks": ["23.1", "24.1"] },
    { "id": 12, "tasks": ["25.1", "25.2"] },
    { "id": 13, "tasks": ["26.1"] }
  ]
}
```
