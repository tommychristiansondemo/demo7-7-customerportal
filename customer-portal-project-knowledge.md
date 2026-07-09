# Vehicle Service Intelligence (VSI) — Project Knowledge

## Overview

This is an AI-powered vehicle diagnostic portal built for a 300-level AWS Generative AI course. It demonstrates a five-stage inference pipeline using Amazon Bedrock foundation models, adaptive model routing via AWS AppConfig, and RAG (Retrieval-Augmented Generation) backed by a Bedrock Knowledge Base with real NHTSA vehicle complaint data.

**Live URL:** https://nissan.awsteach.com
**Instructor Controls:** https://nissan.awsteach.com/instructor.html

---

## Architecture

### User Flow

1. Technician selects vehicle (cascading Model → Year → Trim dropdowns)
2. Describes symptoms in free text, optionally selects DTC codes
3. Submits → API Gateway → Intake Handler Lambda → generates submissionId
4. Pipeline Orchestrator Lambda invoked asynchronously
5. Orchestrator runs 5 sequential stages, each calling Bedrock InvokeModel
6. After each stage, status published via WebSocket to the portal in real-time
7. Final diagnostic report rendered with TSB references, parts, warranty, and narrative

### AWS Services Deployed

| Service | Resource | Purpose |
|---------|----------|---------|
| CloudFront + S3 | Distribution + Portal Bucket | Static hosting for the SPA |
| Route 53 + ACM | nissan.awsteach.com | Custom domain + TLS |
| API Gateway v2 (HTTP) | POST /submissions, PUT/GET /config/weights | REST API |
| API Gateway v2 (WebSocket) | $connect/$disconnect/$default | Real-time pipeline status streaming |
| Lambda | Intake Handler | Validates form, generates submissionId, triggers pipeline |
| Lambda | Pipeline Orchestrator | 5-stage sequential Bedrock inference + KB retrieval |
| Lambda | WebSocket Publisher | Fan-out status messages to connected clients |
| Lambda | WebSocket Connect/Disconnect | Manage connection records in DynamoDB |
| Lambda | Weights Updater | Read/write AppConfig model routing weights |
| DynamoDB | vsi-parts-inventory | Seeded parts catalog (20+ records) |
| DynamoDB | vsi-websocket-connections | WebSocket connection tracking (GSI on submissionId) |
| AppConfig | vsi-model-routing | Model priority weights (quality/latency/cost, sum=100) |
| Bedrock Knowledge Base | PYSVGD1RHN | 138 documents (NHTSA + synthetic TSBs) |
| OpenSearch Serverless | vsi-kb-vectors | Vector store for KB embeddings (Titan Embed v2) |
| Bedrock Runtime | InvokeModel | Foundation model inference (Claude Sonnet 4.5 default) |
| CloudWatch | Dashboard + Alarms | Monitoring and structured log analysis |

### Resource Identifiers

| Resource | ID/ARN |
|----------|--------|
| CloudFront Distribution | E26XEMXMOXFIEG |
| HTTP API | 37seg0a8vd |
| WebSocket API | sbhw8hcv2c |
| Knowledge Base | PYSVGD1RHN |
| Knowledge Base Data Source | CBETD0THYI (AOSS-backed) |
| AOSS Collection | 5el47fxuu01af13e2ooe |
| AppConfig Application | 9f423wc |
| Pipeline Orchestrator Lambda | vsi-pipeline-orchestrator |
| Portal S3 Bucket | vsistack-statichostingstackne-portalbucketf34416c0-h1ncvkk8j2t9 |
| KB Documents S3 Bucket | vsi-kb-documents-154833006816-us-east-1 |
| Route 53 Hosted Zone | Z02882605B7GUS0L3VHX (awsteach.com) |

---

## Model Router — Adaptive Model Selection

### How It Works

The model router scores 5 LLM candidates against three priority weights stored in AppConfig. Weights are integers on a 100-point scale (must sum to 100):

- **quality_priority** — favors higher-quality output (default: 70)
- **latency_priority** — favors faster response time (default: 15)
- **cost_priority** — favors cheaper models (default: 15)

**Scoring formula:**
```
score = (quality_weight × model_quality + latency_weight × model_latency + cost_weight × model_cost) / 100
```

Highest score wins. Ties broken by highest cost_score (cheapest model).

### 5 LLM Candidates

| Model | Quality | Latency | Cost | When It Wins |
|-------|---------|---------|------|--------------|
| Claude Sonnet 4.5 | 98 | 25 | 10 | Quality > 65 |
| Claude Haiku 4.5 | 72 | 80 | 65 | Balanced (quality 40-65) |
| Amazon Nova Pro | 70 | 55 | 55 | Moderate balance |
| Amazon Nova Lite | 45 | 85 | 85 | Cost/speed focused |
| Amazon Nova Micro | 25 | 95 | 95 | Maximum cost savings |

### Default Configuration (quality=70, latency=15, cost=15)

With these defaults, **Claude Sonnet 4.5** wins (score: 73.85). This gives the best quality diagnostic output.

### Demo Scenarios for Class

1. **Start:** quality=70, latency=15, cost=15 → Sonnet wins (best quality)
2. **Shift to cost:** quality=10, latency=25, cost=65 → Nova Micro wins (cheapest)
3. **Balance:** quality=33, latency=34, cost=33 → Haiku wins (best all-around)

Changes propagate via AppConfig Lambda Extension within ~45 seconds.

---

## Knowledge Base

### Content

138 documents total:
- **123 NHTSA-sourced documents** — real public-domain complaint data from NHTSA.gov for Nissan vehicles (Armada, Altima, Rogue, Sentra, Pathfinder, Frontier, Murano, Maxima, LEAF, Titan, Versa, Kicks)
- **15 synthetic TSB documents** — fictional but realistic Technical Service Bulletins covering EV battery, powertrain, ADAS, infotainment, and general systems

### How RAG Works in the Pipeline

During the "Diagnostic Research" stage:
1. The orchestrator calls `bedrock-agent-runtime:Retrieve` with a query built from the vehicle model + year + symptom description
2. Top 5 relevant document chunks are returned (cosine similarity via Titan Embed v2)
3. These chunks are injected into the LLM prompt as context
4. The LLM synthesizes findings into a diagnostic research summary referencing specific TSBs

### Document Format

NHTSA documents contain:
- Affected models and years
- Real complaint summaries from vehicle owners
- Component system classification
- Complaint volume statistics
- Diagnostic guidance and known remedies

---

## Pipeline Stages

| # | Stage | What It Does | Typical Latency |
|---|-------|-------------|-----------------|
| 1 | Triage | Classifies vehicle system + severity | ~5s |
| 2 | Diagnostic Research | KB retrieval + TSB synthesis | ~25s |
| 3 | Parts & Logistics | Identifies needed parts | ~20s |
| 4 | Warranty Determination | Evaluates coverage based on age/mileage | ~5s |
| 5 | Summary | Generates technician-facing report | ~60s |

Total pipeline: ~2-3 minutes with Claude Sonnet 4.5.

---

## Portal UI

### Intake Form
- **Model dropdown** — 18 Nissan models (Altima through Z, including discontinued Juke/Quest/Xterra)
- **Year dropdown** — cascades from model (only years that model was offered)
- **Trim dropdown** — cascades from model+year (only trims for that year range)
- **Symptom description** — free text (required)
- **DTC codes** — optional multi-select (8 common codes)

### Pipeline Progress View
- 5 numbered stages with animated states (pending → spinning → checkmark/X)
- Real-time elapsed timer per stage
- Model ID and latency metadata displayed per stage
- Agent output summaries in a scrollable feed

### Results View
- **Diagnostic Report tab** — vehicle info, triage, TSBs, parts table, warranty, technician narrative
- **Observability tab** — execution timeline, model selection breakdown, latency bars

### Instructor Controls (separate page)
- Three sliders (quality/latency/cost) summing to 100
- Live scoring visualization showing all 5 models ranked with formula breakdown
- "Save Weights" button writes to AppConfig via PUT /config/weights

---

## Demo Mode Fallback

If the WebSocket connection fails or no pipeline activity is detected within 5 seconds, `demo-mode.js` activates and runs a simulated pipeline with canned responses. This ensures the UI demo works even if the backend has issues.

---

## Deployment

### CDK Stack (7 nested stacks deployed via CloudFormation)
```
npx cdk deploy --all --require-approval never -c hostedZoneId=Z02882605B7GUS0L3VHX
```

### Manually Deployed Resources
- **Pipeline Orchestrator Lambda** — deployed via `aws lambda create-function` (not in CDK stack)
- **Knowledge Base** — created via `aws bedrock-agent create-knowledge-base`
- **OpenSearch Serverless Collection** — created via `aws opensearchserverless create-collection`

### Upload Portal Assets
```bash
aws s3 sync portal/ s3://vsistack-statichostingstackne-portalbucketf34416c0-h1ncvkk8j2t9/ --delete
aws cloudfront create-invalidation --distribution-id E26XEMXMOXFIEG --paths "/*"
```

---

## Teardown (End of Class)

```bash
# 1. Delete Pipeline Orchestrator Lambda
aws lambda delete-function --function-name vsi-pipeline-orchestrator

# 2. Delete Knowledge Base
aws bedrock-agent delete-knowledge-base --knowledge-base-id PYSVGD1RHN

# 3. Delete AOSS collection + policies
aws opensearchserverless delete-collection --id 5el47fxuu01af13e2ooe
aws opensearchserverless delete-security-policy --name vsi-enc --type encryption
aws opensearchserverless delete-security-policy --name vsi-net --type network
aws opensearchserverless delete-access-policy --name vsi-data --type data

# 4. Delete KB documents bucket
aws s3 rm s3://vsi-kb-documents-154833006816-us-east-1 --recursive
aws s3 rb s3://vsi-kb-documents-154833006816-us-east-1

# 5. Delete IAM role
aws iam delete-role-policy --role-name vsi-bedrock-kb-role --policy-name vsi-kb-permissions
aws iam delete-role --role-name vsi-bedrock-kb-role

# 6. Destroy CDK stack (handles all remaining resources)
npx cdk destroy --all -c hostedZoneId=Z02882605B7GUS0L3VHX
```

---

## Cost Estimate (1 Day, ~100 Queries)

| Component | Estimated Cost |
|-----------|---------------|
| OpenSearch Serverless (2 OCU × 8hr) | ~$3.84 |
| Bedrock InvokeModel (500 calls, Sonnet 4.5) | ~$2.50 |
| Bedrock Titan Embed v2 (retrieval queries) | ~$0.01 |
| Lambda invocations | ~$0.10 |
| API Gateway / WebSocket | ~$0.01 |
| CloudFront / S3 / DynamoDB | ~$0.01 |
| **Total** | **~$6.50** |

**Important:** Delete the AOSS collection promptly after class — it's the biggest cost driver at $0.24/hr/OCU.

---

## Testing

```bash
# Unit + property tests (runs without deployed infrastructure)
npx jest --forceExit

# Results: 204 passed, 9 skipped (integration tests)
```

Property-based tests validate:
- Model router always selects highest-scoring candidate
- Weight validation accepts/rejects correctly on 100-point scale
- Warranty determination is deterministic
- Parts lookup returns correct statuses
- WebSocket fan-out delivers to all connections
- Pipeline failure halts subsequent stages
- Slider normalization preserves sum=100 invariant
- Pipeline status messages have all required fields

---

## Key Files

| Path | Purpose |
|------|---------|
| `portal/index.html` | Main SPA with intake form + progress + report |
| `portal/app.js` | Cascading dropdowns, form validation, submission |
| `portal/vehicle-data.js` | Nissan model/year/trim data |
| `portal/demo-mode.js` | Fallback simulated pipeline |
| `portal/instructor.html` + `instructor.js` | Weight sliders + scoring visualization |
| `src/lambdas/pipeline-orchestrator/index.ts` | 5-stage Bedrock inference pipeline |
| `src/shared/model-router.ts` | Adaptive model selection (5 candidates, 100-point scoring) |
| `src/shared/types.ts` | All TypeScript interfaces |
| `lib/stacks/vsi-stack.ts` | Root CDK stack composing nested stacks |
| `data/nhtsa/complaints_raw.json` | 9,873 raw NHTSA complaints (source data) |
| `data/kb-documents/` | 138 processed documents for the Knowledge Base |
