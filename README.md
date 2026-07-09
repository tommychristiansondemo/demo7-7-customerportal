# Vehicle Service Intelligence (VSI)

AI-powered vehicle diagnostic pipeline demo built for a 300-level AWS Generative AI course. The application simulates a five-agent orchestration workflow using Amazon Bedrock AgentCore, adaptive model routing via AWS AppConfig, RAG with Bedrock Knowledge Base, and real-time status streaming over WebSockets.

All data is synthetic and fictional — no real VINs, customer data, or proprietary content is used.

## Architecture Overview

The system accepts a vehicle intake form submission via a plain HTML/JS SPA, orchestrates five sequential agents through Amazon Bedrock AgentCore Runtime, streams real-time progress over WebSocket, and produces a structured technician-facing diagnostic report.

See [docs/architecture.md](docs/architecture.md) for the full Mermaid component diagram.

**Key architectural tenets:**

- Sequential five-agent pipeline (not parallel) for teaching visibility
- All tool calls routed through AgentCore Gateway (MCP protocol)
- Adaptive model routing via AppConfig with ≤45s propagation
- Real-time status via API Gateway WebSocket API
- No authentication (demo environment, instructor-trusted network)
- Entire infrastructure defined as CDK TypeScript

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| AWS CDK CLI | 2.170+ |
| AWS CLI | 2.x (configured with appropriate profile) |
| Docker | Required for ECS Fargate container builds |
| AWS Account | With Bedrock model access enabled (Nova Lite, Nova Pro, Claude Sonnet) |

Ensure your AWS account has access to the following Bedrock models:
- Amazon Nova Lite
- Amazon Nova Pro
- Claude Sonnet 3.5
- Amazon Titan Embed Text v2

## Deployment

### 1. Install dependencies

```bash
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

### 3. Configure CDK context

The stack requires the Route 53 hosted zone ID for `awsteach.com`. Pass it as a CDK context value:

```bash
# Option A: Command-line context
npx cdk deploy --all -c hostedZoneId=Z0123456789ABCDEFGHIJ

# Option B: Add to cdk.json context (persistent)
# Add "hostedZoneId": "Z0123456789ABCDEFGHIJ" to the "context" block in cdk.json
```

### 4. Deploy all stacks

```bash
npx cdk deploy --all -c hostedZoneId=<YOUR_HOSTED_ZONE_ID>
```

This deploys the following nested stacks in dependency order:
1. `DnsCertificateStack` — ACM certificate + DNS validation
2. `StaticHostingStack` — S3 + CloudFront + OAC
3. `DataStack` — DynamoDB parts inventory (auto-seeded with 20+ records)
4. `KnowledgeBaseStack` — Bedrock KB + OpenSearch Serverless
5. `AppConfigStack` — Model routing weights
6. `ApiStack` — HTTP API + Lambda integrations
7. `WebSocketStack` — WebSocket API + connections table
8. `AgentCoreStack` — AgentCore Runtime + Gateway + MCP tools
9. `PrivateLinkStack` — VPC + ECS Fargate + NLB + VPC Endpoint Service
10. `ObservabilityStack` — X-Ray, CloudWatch log groups, metrics

### 5. Upload portal assets to S3

After deployment, upload the static portal files to the S3 bucket created by `StaticHostingStack`:

```bash
# Get the bucket name from stack outputs
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name VsiStack \
  --query "Stacks[0].Outputs[?contains(OutputKey,'PortalBucket')].OutputValue" \
  --output text)

# Upload portal assets
aws s3 sync portal/ s3://$BUCKET_NAME/ --delete
```

### 6. Upload TSB documents to the Knowledge Base S3 bucket

```bash
# Get the TSB bucket name from stack outputs
TSB_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name VsiStack \
  --query "Stacks[0].Outputs[?contains(OutputKey,'TsbBucket')].OutputValue" \
  --output text)

# Upload synthetic TSB documents
aws s3 sync docs/synthetic-tsbs/ s3://$TSB_BUCKET/
```

### 7. Trigger Knowledge Base data source sync

```bash
# Get the KB ID and data source ID from stack outputs
KB_ID=$(aws cloudformation describe-stacks \
  --stack-name VsiStack \
  --query "Stacks[0].Outputs[?contains(OutputKey,'KnowledgeBaseId')].OutputValue" \
  --output text)

DATA_SOURCE_ID=$(aws cloudformation describe-stacks \
  --stack-name VsiStack \
  --query "Stacks[0].Outputs[?contains(OutputKey,'DataSourceId')].OutputValue" \
  --output text)

# Start ingestion job
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id $KB_ID \
  --data-source-id $DATA_SOURCE_ID
```

### 8. Access the application

Once deployed, the application is available at: `https://nissan.awsteach.com`

The instructor controls panel is at: `https://nissan.awsteach.com/instructor.html`

## Testing

### Unit tests

```bash
npm run test:unit
```

Runs Jest unit tests for all Lambda handlers, shared modules, and CDK constructs.

### Property-based tests

```bash
npm run test:property
```

Runs fast-check property-based tests that validate correctness properties across many random inputs:
- Model Router scoring and tie-breaking
- Weight validation (valid/invalid triples)
- Warranty determination determinism and correctness
- Parts lookup response completeness
- WebSocket fan-out delivery
- Pipeline failure halts execution
- Slider normalization sum invariant
- Pipeline status message field completeness

### Integration tests

```bash
npm run test:integration
```

Runs end-to-end tests against deployed resources (requires a deployed stack).

### All tests

```bash
npm test
```

## Reset Procedure

Between class sections, reset the demo state:

### Reset DynamoDB parts inventory

The parts table is auto-seeded on deployment. To re-seed manually:

```bash
# The seed Lambda runs as a CloudFormation custom resource.
# To force re-seed, update the stack (change a description or similar):
npx cdk deploy --all -c hostedZoneId=<YOUR_HOSTED_ZONE_ID>
```

### Re-upload portal assets

```bash
aws s3 sync portal/ s3://$BUCKET_NAME/ --delete
```

### Reset AppConfig to default weights

```bash
# PUT default weights via the HTTP API
API_URL=$(aws cloudformation describe-stacks \
  --stack-name VsiStack \
  --query "Stacks[0].Outputs[?contains(OutputKey,'HttpApiUrl')].OutputValue" \
  --output text)

curl -X PUT "$API_URL/config/weights" \
  -H "Content-Type: application/json" \
  -d '{"cost_priority": 0.33, "latency_priority": 0.33, "quality_priority": 0.34}'
```

## Teardown

Remove all deployed resources:

```bash
npx cdk destroy --all -c hostedZoneId=<YOUR_HOSTED_ZONE_ID>
```

All S3 buckets are configured with `autoDeleteObjects: true` and `removalPolicy: DESTROY`, so objects are cleaned up automatically. The DynamoDB table also uses `removalPolicy: DESTROY`.

## Technology Stack

| Category | Technology |
|---|---|
| Infrastructure as Code | AWS CDK (TypeScript) |
| Compute | AWS Lambda (Node.js 20), ECS Fargate |
| AI/ML | Amazon Bedrock (Nova Lite, Nova Pro, Claude Sonnet), Bedrock Knowledge Base, Titan Embed v2 |
| Agent Orchestration | Amazon Bedrock AgentCore Runtime + Gateway (MCP) |
| API | API Gateway v2 (HTTP API + WebSocket API) |
| Database | Amazon DynamoDB |
| Vector Store | Amazon OpenSearch Serverless |
| Configuration | AWS AppConfig (with Lambda extension) |
| Static Hosting | Amazon S3 + CloudFront (OAC) |
| DNS/TLS | Route 53 + ACM |
| Networking | VPC, NLB, VPC Endpoint Service (PrivateLink) |
| Observability | AWS X-Ray, CloudWatch Logs/Metrics |
| Testing | Jest, fast-check (property-based testing) |
| Language | TypeScript (CDK + Lambdas), HTML/CSS/JS (Portal) |

## Project Structure

```
nissan/
├── bin/
│   └── app.ts                          # CDK app entry point
├── lib/
│   ├── stacks/
│   │   ├── vsi-stack.ts                # Root stack (composes nested stacks)
│   │   ├── dns-certificate-stack.ts    # ACM + Route 53
│   │   ├── static-hosting-stack.ts     # S3 + CloudFront + OAC
│   │   ├── api-stack.ts               # HTTP API + routes
│   │   ├── websocket-stack.ts         # WebSocket API
│   │   ├── agentcore-stack.ts         # AgentCore Runtime + Gateway
│   │   ├── knowledge-base-stack.ts    # Bedrock KB + S3 data source
│   │   ├── data-stack.ts             # DynamoDB + seed
│   │   ├── privatelink-stack.ts       # ECS + NLB + VPC Endpoint
│   │   ├── appconfig-stack.ts         # AppConfig resources
│   │   └── observability-stack.ts     # X-Ray, CloudWatch
│   └── constructs/
│       ├── lambda-function.ts          # Reusable Lambda construct (X-Ray, logs)
│       └── vpc-construct.ts            # VPC with private subnets
├── src/
│   ├── lambdas/
│   │   ├── intake-handler/             # POST /submissions handler
│   │   ├── pipeline-orchestrator/      # Sequential 5-agent invocation
│   │   ├── websocket-publisher/        # Fan-out status messages
│   │   ├── websocket-connect/          # $connect: store ConnectionId
│   │   ├── websocket-disconnect/       # $disconnect: remove ConnectionId
│   │   ├── kb-retrieval/               # MCP tool: Knowledge Base query
│   │   ├── parts-lookup/               # MCP tool: DynamoDB parts query
│   │   ├── warranty-rules/             # MCP tool: Warranty determination
│   │   ├── privatelink-service/        # MCP tool: PrivateLink ECS call
│   │   ├── appconfig-weights-updater/  # PUT/GET model routing weights
│   │   └── seed-parts-inventory/       # Custom resource: seed DynamoDB
│   ├── shared/
│   │   ├── model-router.ts            # Model selection scoring logic
│   │   ├── types.ts                   # Shared TypeScript interfaces
│   │   └── logger.ts                  # Structured JSON logger
│   └── ecs/
│       ├── Dockerfile                  # Mock dealer service container
│       └── server.ts                   # HTTP server for /dealer-parts
├── portal/
│   ├── index.html                      # Intake form + pipeline progress + report
│   ├── styles.css                      # Responsive layout and styling
│   ├── app.js                          # Main SPA logic
│   ├── websocket.js                    # WebSocket connection management
│   ├── progress.js                     # Pipeline progress indicator
│   ├── report.js                       # Final report rendering
│   ├── observability.js                # Observability dashboard
│   ├── instructor.html                 # Instructor controls (hidden path)
│   └── instructor.js                   # Slider normalization + weight updates
├── docs/
│   ├── architecture.md                 # Mermaid architecture diagram
│   └── synthetic-tsbs/                 # 15 fictional TSB documents
├── test/
│   ├── unit/                           # Jest unit tests
│   ├── property/                       # fast-check property-based tests
│   └── integration/                    # End-to-end integration tests
├── cdk.json                            # CDK configuration
├── tsconfig.json                       # TypeScript configuration
├── jest.config.ts                      # Jest test runner configuration
├── package.json                        # Dependencies and scripts
└── README.md                           # This file
```

## CloudFormation Outputs

After deployment, the stack exports:

| Output | Description |
|---|---|
| CloudFront Distribution URL | `https://nissan.awsteach.com` |
| HTTP API Endpoint URL | REST API base URL for submissions and config |
| WebSocket API Endpoint URL | WSS URL for real-time pipeline status |
| AppConfig Configuration Profile ARN | ARN for the model routing weights config |

## License

This is an educational demo application. All data is synthetic and fictional.
