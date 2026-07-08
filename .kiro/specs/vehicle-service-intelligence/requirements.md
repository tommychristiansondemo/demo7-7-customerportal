# Requirements Document

## Introduction

Vehicle Service Intelligence is a full-stack demonstration application built for a 300-level AWS Generative AI course delivered to Nissan employees. The application simulates an AI-powered vehicle diagnostic and warranty assessment pipeline, showcasing Amazon Bedrock AgentCore, multi-agent orchestration, adaptive model routing via AWS AppConfig, RAG with Bedrock Knowledge Base, and real-time status streaming over WebSockets. All data is synthetic and fictional; no real VINs, customer data, or proprietary Nissan content are used. Infrastructure is provisioned with AWS CDK (TypeScript). The primary goal is educational clarity — students will read this code during class — so service boundaries must be explicit and code must be inspectable.

---

## Glossary

- **VSI**: Vehicle Service Intelligence — the name of the demonstration application.
- **Portal**: The React or plain HTML/CSS/JS single-page application served from CloudFront.
- **Intake Form**: The customer-facing form in the Portal where a user enters vehicle and symptom information.
- **Pipeline**: The sequential five-agent processing chain that transforms an intake submission into a technician-ready report.
- **Agent**: An Amazon Bedrock AgentCore Runtime-hosted component that performs a discrete diagnostic step.
- **Intake_Triage_Agent**: Agent 1 — parses the complaint and DTCs, classifies vehicle system and severity.
- **Diagnostic_Research_Agent**: Agent 2 — performs RAG retrieval against the Bedrock Knowledge Base.
- **Parts_Logistics_Agent**: Agent 3 — checks mock parts inventory in DynamoDB for availability and lead time.
- **Warranty_Determination_Agent**: Agent 4 — applies mock warranty coverage rules based on vehicle age and mileage.
- **Summary_Orchestrator_Agent**: Agent 5 — assembles the final technician-facing diagnostic report.
- **Model_Router**: The component that reads AppConfig weights and selects the appropriate Bedrock model ID for each LLM call.
- **AppConfig**: AWS AppConfig service used to store and distribute the cost/latency/quality priority weights.
- **Instructor_Controls**: A hidden UI tab at an obscure URL path that allows the course instructor to adjust AppConfig weights live.
- **WebSocket_API**: The API Gateway WebSocket API used to push real-time pipeline status events to the Portal.
- **HTTP_API**: The API Gateway v2 HTTP API that accepts intake form submissions and other REST calls.
- **Knowledge_Base**: The Amazon Bedrock Knowledge Base populated with synthetic TSB and service-manual documents.
- **TSB**: Technical Service Bulletin — a fictional synthetic document used to populate the Knowledge Base.
- **DTC**: Diagnostic Trouble Code — a standardized vehicle fault code (sample values only, no real vehicle data).
- **OAC**: Origin Access Control — the CloudFront mechanism for restricting S3 bucket access.
- **AppConfig_Extension**: The AWS AppConfig Lambda extension that caches configuration locally inside Lambda execution environments.
- **PrivateLink_Service**: A mock private backend service hosted as an ECS task, exposed to Lambda via AWS PrivateLink, demonstrating private connectivity patterns.
- **AgentCore_Gateway**: The Amazon Bedrock AgentCore Gateway instance through which all backend tool calls are routed as MCP tools.
- **AgentCore_Runtime**: The Amazon Bedrock AgentCore Runtime that hosts and orchestrates the five agents.
- **CDK_Stack**: The AWS CDK TypeScript stack that defines all infrastructure resources.
- **Submission**: A single user-initiated request containing vehicle information and a symptom description.
- **ConnectionId**: The API Gateway WebSocket connection identifier for a connected Portal client.
- **Observability_Dashboard**: The frontend view displaying agent handoffs, per-agent latency, and per-step token/cost data.

---

## Requirements

### Requirement 1: DNS and TLS Certificate Provisioning

**User Story:** As a course instructor, I want the application reachable at https://nissan.awsteach.com with a valid TLS certificate, so that students access a professional HTTPS endpoint without browser security warnings.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision an ACM certificate for the domain `nissan.awsteach.com` in the `us-east-1` AWS region using DNS validation.
2. THE CDK_Stack SHALL create the required DNS CNAME validation records in the existing Route 53 hosted zone for `awsteach.com`.
3. WHEN the CloudFront distribution is created, THE CDK_Stack SHALL create a Route 53 A-record ALIAS for `nissan.awsteach.com` pointing to the CloudFront distribution domain name.
4. THE CDK_Stack SHALL NOT create a new Route 53 hosted zone; it SHALL import and reference the existing `awsteach.com` zone by zone ID.
5. WHEN `cdk synth` is executed, THE CDK_Stack SHALL fail with a descriptive error if the Route 53 hosted zone ID for `awsteach.com` is not provided as a CDK context value or environment variable.

---

### Requirement 2: Static Front-End Hosting

**User Story:** As a student, I want to load the Portal over HTTPS from a fast CDN, so that the demo application is responsive regardless of student location.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision an S3 bucket for Portal static assets with all public access blocked and no bucket policy granting public read.
2. THE CDK_Stack SHALL configure a CloudFront distribution with an OAC that grants CloudFront read access to the S3 bucket without a public bucket policy.
3. THE CDK_Stack SHALL configure the CloudFront distribution to redirect all HTTP requests to HTTPS.
4. THE CDK_Stack SHALL set `index.html` as the default root object on the CloudFront distribution.
5. WHEN CloudFront receives a request that returns a 403 or 404 response from the origin for any path that does not match a known static asset, THE CloudFront_Distribution SHALL rewrite the response to serve `index.html` with HTTP status 200 to support SPA client-side routing.
6. THE CDK_Stack SHALL attach the ACM certificate provisioned in Requirement 1 to the CloudFront distribution.
7. THE CDK_Stack SHALL add `nissan.awsteach.com` as an alternate domain name (CNAME) on the CloudFront distribution so that the attached ACM certificate is presented for requests to that domain.

---

### Requirement 3: Intake Form Submission

**User Story:** As a student acting as a vehicle owner, I want to submit vehicle and symptom information through a web form, so that the AI pipeline can generate a diagnostic report.

#### Acceptance Criteria

1. THE Portal SHALL render an intake form containing fields for: vehicle model (text), model year (numeric, four digits), VIN or mock telematics ID (text), free-text symptom description, and an optional dropdown of sample DTCs.
2. WHEN the user clicks the Submit button, THE Portal SHALL POST the form data as JSON to the HTTP_API intake endpoint.
3. WHEN the HTTP_API receives a valid intake submission, THE HTTP_API SHALL return a response containing a unique Submission ID and a WebSocket connection URL within 2 seconds.
4. IF the intake submission is missing required fields (vehicle model, model year, symptom description), THEN THE Portal SHALL display a field-level validation error message identifying the missing field(s) without submitting to the HTTP_API.
5. WHILE the form submission is in flight and before the WebSocket connection is established, THE Portal SHALL display a loading indicator; WHEN the WebSocket connection is established or an error is returned, THE Portal SHALL remove the loading indicator.
6. IF the HTTP_API returns a non-2xx response to the intake POST, THEN THE Portal SHALL display an error message and re-enable the Submit button without clearing the form fields.
7. IF the WebSocket connection cannot be established within 10 seconds of receiving the Submission ID, THEN THE Portal SHALL display an error message and offer a retry option.

---

### Requirement 4: Real-Time Pipeline Status via WebSocket

**User Story:** As a student, I want to watch the pipeline stages update live as the agents process the submission, so that I can see how multi-agent orchestration works step by step.

#### Acceptance Criteria

1. WHEN the Portal receives a Submission ID from the HTTP_API, THE Portal SHALL establish a WebSocket connection to the WebSocket_API using that Submission ID as a query parameter.
2. THE WebSocket_API SHALL support `$connect`, `$disconnect`, and `$default` route keys.
3. WHEN a Lambda function processes a pipeline stage completion event, THE Lambda SHALL publish a status update message to all WebSocket connections associated with the corresponding Submission ID.
4. THE status update message SHALL include at minimum: stage name (one of: Triage, Diagnostic Research, Parts & Logistics, Warranty Determination, Summary), stage status (one of: in_progress, completed, error), agent output summary, and ISO 8601 timestamp.
5. THE Portal SHALL display a visual progress indicator with five labelled stages that updates in real time as status messages arrive over the WebSocket.
6. WHEN a stage transitions to `completed`, THE Portal SHALL highlight that stage and display its agent output summary.
7. WHEN all five stages reach `completed` status, THE Portal SHALL automatically transition to the final results screen.
8. WHEN the WebSocket connection drops unexpectedly before pipeline completion, THE Portal SHALL display a reconnection notification and attempt to reconnect once.

---

### Requirement 5: Multi-Agent Pipeline Orchestration

**User Story:** As a course instructor, I want the backend to demonstrate a real five-agent orchestration pattern using AgentCore, so that students understand how to compose multiple specialized agents into a coherent workflow.

#### Acceptance Criteria

1. THE AgentCore_Runtime SHALL host and orchestrate the five agents: Intake_Triage_Agent, Diagnostic_Research_Agent, Parts_Logistics_Agent, Warranty_Determination_Agent, and Summary_Orchestrator_Agent.
2. WHEN a Submission arrives at the AgentCore_Runtime, THE Intake_Triage_Agent SHALL parse the symptom description and any provided DTCs, then classify the vehicle system (one of: powertrain, EV battery, ADAS, infotainment, other) and severity (one of: low, medium, high, critical). WHERE DTCs are present, they SHALL be included in the classification context.
3. WHEN the Intake_Triage_Agent completes, THE Diagnostic_Research_Agent SHALL invoke the Knowledge Base retrieval MCP tool via AgentCore_Gateway using the classified system and symptom as the query, and SHALL include the KB response in its output before signalling completion.
4. IF the Knowledge Base retrieval MCP tool returns zero results, THEN THE Diagnostic_Research_Agent SHALL record an empty excerpts list in its output and signal completion without halting the pipeline.
5. WHEN the Diagnostic_Research_Agent completes, THE Parts_Logistics_Agent SHALL invoke the parts lookup MCP tool via AgentCore_Gateway using part numbers identified in the Diagnostic_Research_Agent output, and SHALL record availability_status and estimated_lead_time_days per part in its output.
6. WHEN the Parts_Logistics_Agent completes, THE Warranty_Determination_Agent SHALL invoke the warranty rules MCP tool via AgentCore_Gateway, applying mock coverage rules based on the submitted model year and a synthetic mileage value generated by the AgentCore_Runtime at pipeline start from the telematics ID.
7. WHEN the Warranty_Determination_Agent completes, THE Summary_Orchestrator_Agent SHALL compose a structured technician-facing report containing at minimum: vehicle classification and severity (from Agent 1), TSB excerpts retrieved (from Agent 2), parts availability per part number (from Agent 3), warranty status and coverage details (from Agent 4), and a free-text technician narrative synthesising all findings.
8. IF any agent step fails, THEN THE AgentCore_Runtime SHALL emit an error status event for that stage identifying the stage name and failure reason, and SHALL halt the pipeline without executing subsequent stages.
9. WHEN the AgentCore_Runtime emits an error status event, THE Lambda SHALL propagate that error status, stage name, and failure reason over the WebSocket to all connected clients associated with the Submission ID.
10. THE AgentCore_Gateway SHALL expose all backend tool calls (Knowledge Base retrieval, parts lookup, warranty rules, PrivateLink_Service mock call) as MCP tools; no agent SHALL invoke these tools via direct Lambda invocation or direct AWS SDK calls.

---

### Requirement 6: AgentCore Gateway MCP Tool Registration

**User Story:** As a course instructor, I want all backend tools routed through AgentCore Gateway, so that students see the MCP tool pattern rather than scattered direct service calls.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision an AgentCore_Gateway with MCP protocol type and AWS_IAM authorizer.
2. THE CDK_Stack SHALL register the following MCP targets on the AgentCore_Gateway: Knowledge Base retrieval (Lambda-backed), parts inventory lookup (Lambda-backed, querying DynamoDB), warranty rules evaluation (Lambda-backed), and PrivateLink_Service tool (Lambda-backed, invoking the ECS PrivateLink endpoint and returning its response without modification).
3. WHEN an agent invokes an MCP tool via AgentCore_Gateway, THE AgentCore_Gateway SHALL route the call to the registered target Lambda and return the Lambda's response payload to the invoking agent within 30 seconds.
4. IF a registered target Lambda invocation fails or returns an error, THEN THE AgentCore_Gateway SHALL return an error response to the invoking agent indicating the tool name and failure reason, without modifying agent session state.
5. THE CDK_Stack SHALL configure IAM roles for each MCP tool target Lambda, where each role grants only the AWS service permissions that role's Lambda directly invokes: the Knowledge Base retrieval role grants `bedrock:Retrieve` on the Knowledge Base resource only; the parts inventory role grants `dynamodb:GetItem` and `dynamodb:BatchGetItem` on the parts table only; the warranty rules role grants read access to its data source only; and the PrivateLink_Service role grants VPC endpoint invocation access only.

---

### Requirement 7: Bedrock Knowledge Base with Synthetic TSB Documents

**User Story:** As a student, I want the Diagnostic Research Agent to retrieve relevant TSB excerpts via RAG, so that I can see how Knowledge Base retrieval integrates into an agent pipeline.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision a Bedrock Knowledge Base backed by an S3 data source containing synthetic TSB and service-manual documents.
2. THE CDK_Stack SHALL use Amazon Titan or Cohere Embed as the embedding model for the Knowledge Base; Claude models SHALL NOT be used for embeddings.
3. THE Knowledge_Base source S3 bucket SHALL contain between 10 and 20 synthetic TSB documents, each using fictional manufacturer names and fictional part numbers that do not match real OEM formats; at least one document SHALL cover each of the following vehicle systems: powertrain, EV battery, ADAS, and infotainment.
4. WHEN the Diagnostic_Research_Agent invokes the Knowledge Base retrieval MCP tool with a query string, THE Knowledge_Base SHALL return exactly k document excerpts where k is a configurable integer in the range 1–10 with a default value of 3.
5. THE synthetic TSB documents SHALL include non-empty, non-null metadata fields: document_id, vehicle_system, severity_keywords, and tsb_number.

---

### Requirement 8: Mock Parts Inventory (DynamoDB)

**User Story:** As a student, I want to see the Parts & Logistics Agent query a realistic parts inventory, so that I understand how agents integrate with structured data stores.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision a DynamoDB table for mock parts inventory with partition key `part_number` (String).
2. THE CDK_Stack SHALL seed the DynamoDB table with at least 20 fictional part records, each containing: part_number, description, vehicle_systems (list), availability_status (one of: in_stock, backordered, discontinued), estimated_lead_time_days (integer in range 0–365), and unit_cost_usd (number in range 0.01–9999.99).
3. WHEN the Parts_Logistics_Agent invokes the parts lookup MCP tool with a list of up to 50 part numbers, THE Parts_Lookup_Lambda SHALL query DynamoDB and return part_number, availability_status, and estimated_lead_time_days for each found part number.
4. IF a requested part number does not exist in the DynamoDB table, THEN THE Parts_Lookup_Lambda SHALL return a response entry containing the requested part_number, availability_status set to `not_found`, and no other fields populated.

---

### Requirement 9: Mock Warranty Rules Evaluation

**User Story:** As a student, I want to see warranty eligibility determined by a rules engine, so that I understand how agents can apply business logic in a pipeline.

#### Acceptance Criteria

1. WHEN a Submission is received, THE Warranty_Determination_Agent SHALL evaluate warranty eligibility using the following mock rules: new-vehicle limited warranty covers vehicles whose model year is within 3 years of the current calendar year with synthetic mileage under 36,000; powertrain warranty covers vehicles whose model year is within 5 years of the current calendar year with synthetic mileage under 60,000; all other vehicles are classified as not_covered.
2. WHEN the Warranty_Determination_Agent invokes the warranty rules MCP tool, THE Warranty_Rules_Lambda SHALL return: warranty_status (one of: covered, partially_covered, not_covered), applicable_warranty_type (one of: new_vehicle_limited, powertrain, none), and coverage_details (a human-readable summary of the applicable warranty rule, or "No warranty coverage applies" when not_covered).
3. THE Warranty_Rules_Lambda SHALL derive the synthetic mileage value deterministically from the telematics ID using the formula: `synthetic_mileage = (numeric_hash(telematics_id) % 100_000)`, producing a value in the range 0–99,999.
4. IF the model year or telematics ID is absent or non-parseable in the Submission, THEN THE Warranty_Rules_Lambda SHALL return warranty_status `not_covered`, applicable_warranty_type `none`, and coverage_details `"Unable to determine warranty: missing or invalid vehicle data"`.

---

### Requirement 10: PrivateLink Private Service Pattern

**User Story:** As a course instructor, I want one backend tool to call a private ECS-hosted service via PrivateLink, so that students see the pattern for connecting agents to private internal services.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision an ECS Fargate task running a simple HTTP mock service that responds to GET `/dealer-parts` with HTTP 200 and a deterministic JSON payload simulating a dealer parts system response.
2. THE CDK_Stack SHALL expose the ECS service via an AWS PrivateLink VPC Endpoint Service backed by a Network Load Balancer on port 80, with auto-accept enabled for connections from the same account.
3. WHEN an agent invokes the PrivateLink tool, THE PrivateLink_Service_Lambda SHALL send a GET request to the ECS mock service through the PrivateLink VPC endpoint and return the HTTP response body to the invoking agent.
4. IF the ECS mock service returns a non-2xx response or does not respond within 10 seconds, THEN THE PrivateLink_Service_Lambda SHALL return an error response to the invoking agent with the HTTP status code or timeout reason; no retry SHALL be attempted.
5. THE CDK_Stack SHALL configure VPC security groups such that the PrivateLink_Service_Lambda and the ECS task communicate only through private IP space; security groups SHALL explicitly deny outbound traffic to public internet IP ranges (0.0.0.0/0 except VPC CIDR and AWS service endpoints).

---

### Requirement 11: Adaptive Model Routing via AppConfig

**User Story:** As a course instructor, I want to adjust cost, latency, and quality priority weights live from the Instructor Controls panel, so that students can observe how model selection changes in real time based on operational priorities.

#### Acceptance Criteria

1. THE CDK_Stack SHALL provision an AppConfig application, environment, and freeform JSON configuration profile with default content `{"cost_priority": 0.33, "latency_priority": 0.33, "quality_priority": 0.34}`.
2. WHEN a Lambda function is invoked, THE Model_Router SHALL read the current AppConfig configuration via the AppConfig_Extension (Lambda layer), not via direct AppConfig API calls per request.
3. THE Model_Router SHALL score the following three candidate models against the current weights and select the highest-scoring model: Amazon Nova Lite (low-cost/fast), Amazon Nova Pro (balanced), and Amazon Claude Sonnet (higher-quality). In the event of a tie score, THE Model_Router SHALL select the lowest-cost model.
4. THE Model_Router scoring function SHALL compute a weighted score for each candidate using the formula: `score = (cost_weight × cost_score) + (latency_weight × latency_score) + (quality_weight × quality_score)`, where each model's cost_score, latency_score, and quality_score are static values in the range [0.0, 1.0], and the three weight values each SHALL be in the range [0.0, 1.0] and SHALL sum to 1.0.
5. WHEN the Model_Router selects a model, THE Model_Router SHALL log the selected model ID, active weights, candidate scores, and ISO 8601 timestamp to CloudWatch Logs in structured JSON format.
6. WHEN the Instructor_Controls panel submits updated weights, THE HTTP_API SHALL validate that each weight is in [0.0, 1.0] and that all three weights sum to 1.0 (±0.001 tolerance), then write the validated values to AppConfig so that subsequent Lambda invocations pick up the updated configuration without redeployment.
7. THE AppConfig_Extension SHALL cache configuration for no more than 45 seconds, ensuring instructor weight changes propagate to agents within 45 seconds.
8. IF the HTTP_API receives a weights update where any weight is outside [0.0, 1.0] or the three weights do not sum to 1.0 (±0.001), THEN THE HTTP_API SHALL return HTTP 400 with a descriptive error message and SHALL NOT write to AppConfig.

---

### Requirement 12: Instructor Controls Panel

**User Story:** As a course instructor, I want a hidden control panel to adjust model routing weights live, so that I can demonstrate cost/latency/quality tradeoffs to students during class.

#### Acceptance Criteria

1. THE Portal SHALL render the Instructor_Controls panel only at a non-obvious URL path (e.g., `/instructor`) that is NOT linked from the main navigation.
2. THE Instructor_Controls panel SHALL display three range sliders labelled Cost Priority, Latency Priority, and Quality Priority, each with a value range of 0 to 1 in increments of 0.01.
3. WHEN the instructor moves a slider, THE Portal SHALL normalize the three values so they sum to 1.0 using the formula: the moved slider retains its new value; the remaining two sliders are each set to `(1.0 - moved_value) / 2`; if both remaining sliders were 0, they are each set to `(1.0 - moved_value) / 2` regardless.
4. WHEN the instructor clicks Save, THE Portal SHALL disable the Save button, POST the normalized weights to the HTTP_API AppConfig update endpoint, and re-enable the Save button only after a response is received.
5. WHEN the HTTP_API receives a weights update, THE HTTP_API_Handler_Lambda SHALL call AppConfig to create a new hosted configuration version and deploy it to the active environment.
6. IF the HTTP_API returns a non-2xx response to the weights POST, THEN THE Portal SHALL display an error message, re-enable the Save button, and leave all slider values unchanged.
7. IF the AppConfig deployment call fails inside the HTTP_API_Handler_Lambda, THEN THE Lambda SHALL return HTTP 500 to the Portal; THE Portal SHALL display the error message returned by the API.
8. WHEN the HTTP_API returns a 2xx response to the weights POST, THE Instructor_Controls panel SHALL display the ISO 8601 timestamp of that successful update.

---

### Requirement 13: Final Diagnostic Report Display

**User Story:** As a student acting as a service technician, I want to see a structured diagnostic report after the pipeline completes, so that I understand the synthesized output of the multi-agent workflow.

#### Acceptance Criteria

1. WHEN the Portal transitions to the final results screen, THE Portal SHALL display: vehicle information (model, year, VIN/telematics ID), classified vehicle system and severity from the Intake_Triage_Agent, the top 3 retrieved TSB excerpts (title and excerpt text) from the Diagnostic_Research_Agent, parts availability summary (part name, availability_status, estimated_lead_time_days per part) from the Parts_Logistics_Agent, warranty eligibility determination (one of: eligible, not eligible, indeterminate) and coverage details from the Warranty_Determination_Agent, and the full technician narrative from the Summary_Orchestrator_Agent.
2. WHEN the Portal transitions to the final results screen, THE Portal SHALL display the Observability_Dashboard alongside the final report, showing: total pipeline duration (ms), per-agent latency (ms), selected model IDs per agent, active AppConfig weights at time of request, and estimated token counts and cost per agent step in USD.
3. IF any agent returns no data for its section, THEN THE Portal SHALL display a placeholder message for that section (e.g., "No data returned by [Agent Name]") without affecting the display of other sections.
4. WHEN the user activates the "Start New Submission" button, THE Portal SHALL reset the intake form to its initial empty state and clear the diagnostic report, Observability_Dashboard, and all session results from the display.

---

### Requirement 14: Observability and X-Ray Tracing

**User Story:** As a course instructor, I want end-to-end distributed tracing and per-step observability, so that students can see how to instrument a multi-agent workload on AWS.

#### Acceptance Criteria

1. THE CDK_Stack SHALL enable AWS X-Ray active tracing on all Lambda functions and the HTTP_API.
2. WHEN the AgentCore_Runtime processes a Submission, THE AgentCore_Runtime SHALL emit X-Ray trace segments for each agent invocation, annotated with: Submission ID, agent name, model ID selected, and stage duration in milliseconds.
3. THE CDK_Stack SHALL configure CloudWatch Log Groups with a retention period of 7 days for all Lambda functions and API Gateway access logs.
4. WHEN a Model_Router decision is made, THE Lambda SHALL emit a structured CloudWatch metric to the custom namespace `VSI/ModelRouter` with unit `Count` and dimensions: ModelSelected (string), CostPriority (rounded to 2 decimal places), LatencyPriority (rounded to 2 decimal places), QualityPriority (rounded to 2 decimal places).
5. THE Lambda functions SHALL emit structured JSON logs to CloudWatch for the following event types: intake submission received, each agent stage started, each agent stage completed, each model routing decision, each MCP tool call initiated and completed, and all errors. Each log entry SHALL include at minimum: event_type (string), submission_id (string), timestamp (ISO 8601), and relevant context fields for that event type.

---

### Requirement 15: IAM Least-Privilege and Security

**User Story:** As a course instructor, I want all IAM roles to follow least-privilege principles, so that students learn secure IAM patterns from the reference implementation.

#### Acceptance Criteria

1. THE CDK_Stack SHALL define a separate IAM execution role for each Lambda function; no role SHALL contain a wildcard (`*`) in its IAM policy Action or Resource fields.
2. THE CDK_Stack SHALL NOT attach any AWS managed policy whose Action field contains a wildcard (`*`) to any Lambda execution role; the named examples `AdministratorAccess` and `AmazonDynamoDBFullAccess` are prohibited.
3. THE S3 bucket for Portal static assets SHALL NOT have a bucket policy statement with `Principal: "*"` granting `s3:GetObject`.
4. THE AgentCore_Runtime execution role SHALL grant only the Bedrock and AgentCore API actions required to invoke the registered agents and MCP tools; no wildcard actions or resources SHALL be present in that role's policies.
5. WHEN the CDK_Stack is synthesized, THE CDK_Stack SHALL produce zero `cdk-nag` AwsSolutions rule violations at ERROR severity for IAM, S3, CloudFront, or Lambda resources.
6. THE S3 bucket for Portal static assets SHALL have a bucket policy granting `s3:GetObject` exclusively to the CloudFront OAC principal using a `aws:SourceArn` condition scoped to the CloudFront distribution ARN.

---

### Requirement 16: CDK Infrastructure Completeness

**User Story:** As a course instructor, I want the entire infrastructure defined as CDK TypeScript, so that students can redeploy, inspect, and tear down the demo with a single set of commands.

#### Acceptance Criteria

1. THE CDK_Stack SHALL define all AWS resources described in Requirements 1–15 in a single deployable CDK TypeScript application.
2. THE CDK_Stack SHALL export CloudFormation outputs for: CloudFront distribution URL, HTTP_API endpoint URL, WebSocket_API endpoint URL, and AppConfig configuration profile ARN.
3. THE README SHALL include: numbered step-by-step redeploy instructions covering prerequisites (Node.js version, AWS CLI profile, CDK bootstrap), a reset procedure specifying which resources to clear between class sections (DynamoDB table truncation, S3 portal bucket re-upload, AppConfig reset to default weights), and a teardown command sequence.
4. WHEN `cdk synth` is executed, THE CDK_Stack SHALL compile TypeScript before synthesis as specified by the `app` command in `cdk.json`.
5. WHEN `cdk destroy` is executed, THE CDK_Stack SHALL result in removal of: all S3 bucket objects and the bucket itself (via `autoDeleteObjects: true` and `removalPolicy: DESTROY`), the DynamoDB table and all its items, all Lambda functions and their associated CloudWatch Log Groups (via a custom resource or explicit `removalPolicy: DESTROY`), and all other stack resources; no orphaned CloudFormation resources SHALL remain after a successful destroy.

---

### Requirement 17: Synthetic TSB Document Set

**User Story:** As a course instructor, I want a realistic-looking set of fictional service documents, so that the Knowledge Base returns plausible diagnostic content without using any proprietary Nissan material.

#### Acceptance Criteria

1. THE repository SHALL contain between 10 and 20 synthetic TSB documents in plain text or Markdown format in a `/docs/synthetic-tsbs/` directory.
2. EACH synthetic TSB document SHALL contain, expressed in one or more complete sentences each: a fictional TSB number, a vehicle system classification, a symptom description, a root cause description, a corrective action description, and a parts list containing between 2 and 10 fictional part numbers.
3. THE synthetic TSB documents SHALL cover at minimum the following vehicle systems: EV battery management, powertrain/engine, ADAS (advanced driver assistance systems), and infotainment.
4. THE synthetic TSB documents SHALL NOT contain: any real automotive brand or model names, any part numbers matching the real OEM format (5 digits, hyphen, 5 digits), or any 17-character strings matching VIN format (alphanumeric, excluding I, O, Q).
5. EACH synthetic TSB document SHALL include a disclaimer as its first line or first heading block stating that it is fictional and for educational demonstration purposes only.
6. EACH synthetic TSB document SHALL have a TSB number that is unique across the entire document set.

---

### Requirement 18: Architecture Diagram

**User Story:** As a course instructor, I want a Mermaid architecture diagram in the repository, so that students have a visual reference for the system they are studying.

#### Acceptance Criteria

1. THE repository SHALL contain a Mermaid architecture diagram in `docs/architecture.md`, using valid Mermaid diagram syntax that renders without errors in standard Mermaid renderers.
2. THE architecture diagram SHALL include a labeled node for each of the following components and a directed edge for each connection: nodes — Portal, CloudFront, S3_Assets, HTTP_API, WebSocket_API, Intake_Lambda, Pipeline_Lambda, WebSocket_Lambda, AgentCore_Runtime, AgentCore_Gateway, KB_Retrieval_Lambda, Parts_Lookup_Lambda, Warranty_Rules_Lambda, PrivateLink_Lambda, Knowledge_Base, DynamoDB_Parts, PrivateLink_ECS, Model_Router, AppConfig_Extension, AppConfig, XRay, CloudWatch; edges connecting each node pair in the data flow.
3. THE architecture diagram SHALL label each directed edge with the protocol or AWS service used: Portal→CloudFront (HTTPS), CloudFront→S3_Assets (OAC/S3), Portal→HTTP_API (HTTPS), Portal→WebSocket_API (WebSocket), HTTP_API→Intake_Lambda (invoke), Intake_Lambda→AgentCore_Runtime (SDK), AgentCore_Runtime→AgentCore_Gateway (MCP), AgentCore_Gateway→KB_Retrieval_Lambda (invoke), AgentCore_Gateway→Parts_Lookup_Lambda (invoke), AgentCore_Gateway→Warranty_Rules_Lambda (invoke), AgentCore_Gateway→PrivateLink_Lambda (invoke), KB_Retrieval_Lambda→Knowledge_Base (SDK), Parts_Lookup_Lambda→DynamoDB_Parts (SDK), PrivateLink_Lambda→PrivateLink_ECS (PrivateLink/HTTP), Model_Router→AppConfig_Extension (HTTP localhost), AppConfig_Extension→AppConfig (SDK), Intake_Lambda→XRay (SDK), Intake_Lambda→CloudWatch (SDK).
