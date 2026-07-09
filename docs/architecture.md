# Vehicle Service Intelligence (VSI) — Architecture Diagram

## System Architecture

```mermaid
flowchart TD
    %% ─────────────────────────────────────────────
    %% Client Layer
    %% ─────────────────────────────────────────────
    subgraph Client["Client Layer"]
        Portal["Portal SPA<br/>(HTML/CSS/JS)"]
    end

    %% ─────────────────────────────────────────────
    %% Edge / CDN Layer
    %% ─────────────────────────────────────────────
    subgraph Edge["Edge / CDN"]
        CF["CloudFront<br/>Distribution"]
        S3Assets["S3 Bucket<br/>(Static Assets)"]
    end

    %% ─────────────────────────────────────────────
    %% API Layer
    %% ─────────────────────────────────────────────
    subgraph APILayer["API Layer"]
        HTTPAPI["HTTP API Gateway<br/>(API Gateway v2)"]
        WSAPI["WebSocket API Gateway<br/>(API Gateway v2)"]
    end

    %% ─────────────────────────────────────────────
    %% Compute — API Handlers
    %% ─────────────────────────────────────────────
    subgraph Compute["Lambda Compute"]
        IntakeLambda["Intake Handler<br/>Lambda"]
        WeightsLambda["AppConfig Weights<br/>Updater Lambda"]
        PipelineLambda["Pipeline Orchestrator<br/>Lambda"]
        WSConnect["WebSocket Connect<br/>Lambda"]
        WSDisconnect["WebSocket Disconnect<br/>Lambda"]
        WSPublisher["WebSocket Publisher<br/>Lambda"]
    end

    %% ─────────────────────────────────────────────
    %% AgentCore
    %% ─────────────────────────────────────────────
    subgraph AgentCore["Amazon Bedrock AgentCore"]
        ACRuntime["AgentCore Runtime<br/>(5 Agent Stages)"]
        ACGateway["AgentCore Gateway<br/>(MCP / AWS_IAM)"]
    end

    subgraph Agents["5 Sequential Agent Stages"]
        A1["1. Intake Triage"]
        A2["2. Diagnostic Research"]
        A3["3. Parts & Logistics"]
        A4["4. Warranty Determination"]
        A5["5. Summary Orchestrator"]
    end

    %% ─────────────────────────────────────────────
    %% MCP Tool Lambdas
    %% ─────────────────────────────────────────────
    subgraph MCPTools["MCP Tool Lambdas"]
        KBLambda["KB Retrieval<br/>Lambda"]
        PartsLambda["Parts Lookup<br/>Lambda"]
        WarrantyLambda["Warranty Rules<br/>Lambda"]
        PLLambda["PrivateLink Service<br/>Lambda"]
    end

    %% ─────────────────────────────────────────────
    %% Data & AI Layer
    %% ─────────────────────────────────────────────
    subgraph DataAI["Data & AI"]
        KB["Bedrock Knowledge Base<br/>(Titan Embed v2)"]
        OSS["OpenSearch Serverless<br/>(Vector Store)"]
        S3TSB["S3 Bucket<br/>(Synthetic TSB Docs)"]
        DDBParts["DynamoDB<br/>(Parts Inventory Table)"]
        DDBConn["DynamoDB<br/>(Connections Table + GSI)"]
    end

    %% ─────────────────────────────────────────────
    %% Configuration
    %% ─────────────────────────────────────────────
    subgraph Config["Configuration"]
        AppConfig["AWS AppConfig<br/>(Model Routing Weights)"]
        AppConfigExt["AppConfig Lambda<br/>Extension (≤45s cache)"]
    end

    %% ─────────────────────────────────────────────
    %% Private Network / PrivateLink
    %% ─────────────────────────────────────────────
    subgraph PrivateNet["Private Network (VPC)"]
        VPCEndpoint["VPC Endpoint<br/>Service"]
        NLB["Network Load<br/>Balancer (port 80)"]
        ECS["ECS Fargate Task<br/>(Mock Dealer Service)"]
    end

    %% ─────────────────────────────────────────────
    %% Observability
    %% ─────────────────────────────────────────────
    subgraph Observability["Observability"]
        CWDashboard["CloudWatch<br/>Dashboard + Alarms"]
        CWLogs["CloudWatch Logs<br/>(7-day retention)"]
        XRay["AWS X-Ray<br/>(Distributed Tracing)"]
    end

    %% ═══════════════════════════════════════════════
    %% Data Flow Connections
    %% ═══════════════════════════════════════════════

    %% Client → Edge
    Portal -->|"HTTPS"| CF
    CF -->|"OAC / S3 GetObject"| S3Assets

    %% Client → APIs
    Portal -->|"HTTPS POST /submissions<br/>PUT/GET /config/weights"| HTTPAPI
    Portal -->|"WSS (submissionId query param)"| WSAPI

    %% HTTP API → Lambdas
    HTTPAPI -->|"invoke"| IntakeLambda
    HTTPAPI -->|"invoke"| WeightsLambda

    %% WebSocket API → Lambdas
    WSAPI -->|"$connect"| WSConnect
    WSAPI -->|"$disconnect"| WSDisconnect

    %% Intake Handler flow
    IntakeLambda -->|"async invoke"| PipelineLambda

    %% Pipeline Orchestrator flow
    PipelineLambda -->|"SDK: InvokeAgentRuntime"| ACRuntime
    PipelineLambda -->|"invoke (fan-out)"| WSPublisher

    %% WebSocket Publisher
    WSPublisher -->|"postToConnection"| WSAPI
    WSPublisher -->|"Query GSI / DeleteItem"| DDBConn

    %% WebSocket Connect/Disconnect → DynamoDB
    WSConnect -->|"PutItem"| DDBConn
    WSDisconnect -->|"DeleteItem"| DDBConn

    %% AgentCore Runtime ↔ Gateway
    ACRuntime -->|"sequential"| Agents
    ACRuntime -->|"MCP tool calls"| ACGateway

    %% AgentCore Gateway → MCP Tool Lambdas
    ACGateway -->|"invoke"| KBLambda
    ACGateway -->|"invoke"| PartsLambda
    ACGateway -->|"invoke"| WarrantyLambda
    ACGateway -->|"invoke"| PLLambda

    %% MCP Tool Lambdas → Data sources
    KBLambda -->|"bedrock:Retrieve"| KB
    KB -->|"vector search"| OSS
    KB -->|"data source"| S3TSB
    PartsLambda -->|"BatchGetItem"| DDBParts
    PLLambda -->|"HTTP GET /dealer-parts<br/>via PrivateLink"| VPCEndpoint

    %% PrivateLink chain
    VPCEndpoint -->|"TCP 80"| NLB
    NLB -->|"TCP 80"| ECS

    %% AppConfig
    WeightsLambda -->|"CreateHostedConfigVersion<br/>+ StartDeployment"| AppConfig
    AppConfigExt -->|"HTTP localhost:2772"| AppConfig
    PipelineLambda -.->|"reads weights via"| AppConfigExt

    %% Observability (dotted lines)
    IntakeLambda -.->|"traces"| XRay
    PipelineLambda -.->|"traces + metrics"| XRay
    PipelineLambda -.->|"structured logs"| CWLogs
    WSPublisher -.->|"logs"| CWLogs
    IntakeLambda -.->|"logs"| CWLogs
    ACRuntime -.->|"trace segments"| XRay
    CWLogs -.->|"feeds"| CWDashboard
    XRay -.->|"feeds"| CWDashboard
```

## Component Summary

| Component | Service | Purpose |
|-----------|---------|---------|
| Portal | S3 + CloudFront | Single-page application served via CDN |
| HTTP API | API Gateway v2 (HTTP) | REST endpoints for submissions and config |
| WebSocket API | API Gateway v2 (WebSocket) | Real-time pipeline status push |
| Intake Handler | Lambda | Validates intake, starts pipeline |
| Pipeline Orchestrator | Lambda | Sequences 5 agents, publishes status |
| WebSocket Publisher | Lambda | Fan-out status to connected clients |
| AgentCore Runtime | Bedrock AgentCore | Hosts 5 sequential diagnostic agents |
| AgentCore Gateway | Bedrock AgentCore (MCP) | Routes tool calls to Lambda targets |
| KB Retrieval | Lambda (MCP tool) | Queries Bedrock Knowledge Base |
| Parts Lookup | Lambda (MCP tool) | Queries DynamoDB parts inventory |
| Warranty Rules | Lambda (MCP tool) | Applies deterministic warranty logic |
| PrivateLink Service | Lambda (MCP tool) | Calls ECS mock dealer via PrivateLink |
| Knowledge Base | Bedrock KB + OpenSearch Serverless | RAG over synthetic TSB documents |
| DynamoDB | Parts Inventory + Connections | Structured data storage |
| AppConfig | AWS AppConfig | Model routing weight distribution |
| ECS Fargate | Mock Dealer Service + NLB + PrivateLink | Private backend service pattern |
| CloudWatch | Dashboard + Alarms + Logs | Monitoring and structured logging |
| X-Ray | Distributed Tracing | End-to-end trace visibility |

## Data Flow

1. **User submits intake form** → Portal POSTs to HTTP API → Intake Handler validates and generates Submission ID
2. **Pipeline starts** → Intake Handler asynchronously invokes Pipeline Orchestrator
3. **WebSocket connects** → Portal opens WSS connection using Submission ID; Connect Lambda stores ConnectionId in DynamoDB
4. **Agent execution** → Pipeline Orchestrator loops through 5 agents sequentially via AgentCore Runtime
5. **Tool calls** → Agents invoke MCP tools through AgentCore Gateway → target Lambdas access data sources
6. **Status streaming** → Pipeline Orchestrator calls WebSocket Publisher → fan-out to all connections for that submission
7. **Report display** → After all 5 stages complete, Portal renders the final diagnostic report
8. **Model routing** → Each agent invocation uses AppConfig weights (cached via Lambda Extension) to select the optimal model
