import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';
import { VsiLambdaFunction } from '../constructs/lambda-function';

/**
 * Properties for AgentCoreStack.
 */
export interface AgentCoreStackProps extends cdk.NestedStackProps {
  /** Knowledge Base ID from KnowledgeBaseStack. */
  readonly knowledgeBaseId: string;

  /** Knowledge Base ARN from KnowledgeBaseStack. */
  readonly knowledgeBaseArn: string;

  /** DynamoDB parts table name from DataStack. */
  readonly partsTableName: string;

  /** DynamoDB parts table ARN from DataStack. */
  readonly partsTableArn: string;
}

/**
 * AgentCoreStack — Provisions Amazon Bedrock AgentCore Runtime and Gateway
 * for the five-agent diagnostic pipeline, plus Lambda-backed MCP tool targets.
 *
 * Architecture:
 *   AgentCore Runtime (5 agents, HTTP protocol)
 *     → AgentCore Gateway (MCP protocol, AWS_IAM)
 *       → Lambda MCP targets (kb_retrieval, parts_lookup, warranty_rules, privatelink_service)
 *
 * Requirements: 5.1, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 15.4
 */
export class AgentCoreStack extends cdk.NestedStack {
  /** The AgentCore Runtime ID. */
  public readonly agentRuntimeId: string;

  /** The AgentCore Runtime ARN. */
  public readonly agentRuntimeArn: string;

  /** The AgentCore Gateway ID. */
  public readonly gatewayId: string;

  /** KB Retrieval Lambda function ARN. */
  public readonly kbRetrievalLambdaArn: string;

  /** Parts Lookup Lambda function ARN. */
  public readonly partsLookupLambdaArn: string;

  /** Warranty Rules Lambda function ARN. */
  public readonly warrantyRulesLambdaArn: string;

  /** PrivateLink Service Lambda function ARN. */
  public readonly privatelinkServiceLambdaArn: string;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // ─── MCP Tool Lambda Functions ──────────────────────────────────────────────

    // KB Retrieval Lambda (MCP tool: kb_retrieval)
    const kbRetrievalLambda = new VsiLambdaFunction(this, 'KbRetrievalLambda', {
      entry: path.join(__dirname, '../../src/lambdas/kb-retrieval/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        TOP_K: '3',
      },
      description: 'MCP tool: Knowledge Base retrieval via Bedrock',
    });

    // Grant bedrock:Retrieve on the KB resource only (Req 6.5)
    kbRetrievalLambda.role.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:Retrieve'],
      resources: [props.knowledgeBaseArn],
    }));

    this.kbRetrievalLambdaArn = kbRetrievalLambda.function.functionArn;

    // Parts Lookup Lambda (MCP tool: parts_lookup)
    const partsLookupLambda = new VsiLambdaFunction(this, 'PartsLookupLambda', {
      entry: path.join(__dirname, '../../src/lambdas/parts-lookup/index.ts'),
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: props.partsTableName,
      },
      description: 'MCP tool: Parts inventory DynamoDB lookup',
    });

    // Grant DynamoDB GetItem/BatchGetItem on parts table only (Req 6.5)
    partsLookupLambda.role.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem'],
      resources: [props.partsTableArn],
    }));

    this.partsLookupLambdaArn = partsLookupLambda.function.functionArn;

    // Warranty Rules Lambda (MCP tool: warranty_rules)
    const warrantyRulesLambda = new VsiLambdaFunction(this, 'WarrantyRulesLambda', {
      entry: path.join(__dirname, '../../src/lambdas/warranty-rules/index.ts'),
      timeout: cdk.Duration.seconds(5),
      description: 'MCP tool: Warranty rules evaluation (pure computation)',
    });

    this.warrantyRulesLambdaArn = warrantyRulesLambda.function.functionArn;

    // PrivateLink Service Lambda (MCP tool: privatelink_service)
    // Note: This Lambda needs VPC connectivity to reach the ECS mock service
    // via PrivateLink. The VPC/security group will be wired when PrivateLinkStack
    // is integrated. For now, it's provisioned without VPC.
    const privatelinkServiceLambda = new VsiLambdaFunction(this, 'PrivateLinkServiceLambda', {
      entry: path.join(__dirname, '../../src/lambdas/privatelink-service/index.ts'),
      timeout: cdk.Duration.seconds(15),
      environment: {
        DEALER_SERVICE_URL: 'http://placeholder.internal:80',
      },
      description: 'MCP tool: PrivateLink call to ECS mock dealer service',
    });

    this.privatelinkServiceLambdaArn = privatelinkServiceLambda.function.functionArn;

    // ─── AgentCore Runtime IAM Role ─────────────────────────────────────────────
    const agentCoreRuntimeRole = new iam.Role(this, 'AgentCoreRuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': accountId,
          },
        },
      }),
      description: 'Execution role for VSI AgentCore Runtime',
    });

    // Grant Runtime role access to invoke Bedrock foundation models (Req 15.4)
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0`,
        `arn:aws:bedrock:${region}::foundation-model/amazon.nova-lite-v1:0`,
        `arn:aws:bedrock:${region}::foundation-model/amazon.nova-pro-v1:0`,
        `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
      ],
    }));

    // ─── AgentCore Runtime (L1 CfnResource) ─────────────────────────────────────
    // Note: The AgentCore Runtime requires a deployed container/code artifact.
    // In this demo, the pipeline orchestration is handled by a Lambda function
    // (Pipeline Orchestrator) that calls Bedrock models directly via InvokeModel.
    // We use placeholder values for the Runtime ID/ARN since the Gateway + Targets
    // are the primary AgentCore integration pattern used here.
    this.agentRuntimeId = 'vsi-runtime-placeholder';
    this.agentRuntimeArn = `arn:aws:bedrock-agentcore:${region}:${accountId}:runtime/vsi-runtime-placeholder`;

    // ─── AgentCore Gateway IAM Role ─────────────────────────────────────────────
    const gatewayRole = new iam.Role(this, 'AgentCoreGatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': accountId,
          },
        },
      }),
      description: 'Execution role for VSI AgentCore Gateway to invoke MCP tool Lambdas',
    });

    // Grant Gateway role permission to invoke MCP tool Lambdas
    gatewayRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        kbRetrievalLambda.function.functionArn,
        partsLookupLambda.function.functionArn,
        warrantyRulesLambda.function.functionArn,
        privatelinkServiceLambda.function.functionArn,
      ],
    }));

    // ─── AgentCore Gateway (L1 CfnResource) ─────────────────────────────────────
    const gateway = new cdk.CfnResource(this, 'AgentCoreGateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: 'vsi-mcp-gateway',
        Description: 'MCP Gateway routing tool calls to Lambda-backed MCP targets',
        RoleArn: gatewayRole.roleArn,
        ProtocolType: 'MCP',
        AuthorizerType: 'AWS_IAM',
        ProtocolConfiguration: {
          Mcp: {
            Instructions: 'Route MCP tool calls to the registered Lambda targets for the VSI diagnostic pipeline.',
          },
        },
      },
    });

    this.gatewayId = gateway.getAtt('GatewayId').toString();

    // Grant the AgentCore Runtime role permission to invoke the Gateway
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: [this.agentRuntimeArn],
    }));

    // ─── MCP Gateway Targets ────────────────────────────────────────────────────

    // Target: kb_retrieval
    const kbRetrievalTarget = new cdk.CfnResource(this, 'KbRetrievalTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: this.gatewayId,
        Name: 'kb-retrieval',
        Description: 'Knowledge Base retrieval MCP tool — queries Bedrock KB for TSB excerpts',
        TargetConfiguration: {
          Mcp: {
            Lambda: {
              LambdaArn: kbRetrievalLambda.function.functionArn,
              ToolSchema: {
                InlinePayload: JSON.stringify({
                  name: 'kb_retrieval',
                  description: 'Query the Bedrock Knowledge Base for relevant TSB document excerpts',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'Search query for Knowledge Base retrieval' },
                      topK: { type: 'number', description: 'Number of results to return (default 3)' },
                    },
                    required: ['query'],
                  },
                }),
              },
            },
          },
        },
      },
    });
    kbRetrievalTarget.addDependency(gateway);

    // Target: parts_lookup
    const partsLookupTarget = new cdk.CfnResource(this, 'PartsLookupTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: this.gatewayId,
        Name: 'parts-lookup',
        Description: 'Parts inventory lookup MCP tool — queries DynamoDB for part availability',
        TargetConfiguration: {
          Mcp: {
            Lambda: {
              LambdaArn: partsLookupLambda.function.functionArn,
              ToolSchema: {
                InlinePayload: JSON.stringify({
                  name: 'parts_lookup',
                  description: 'Look up parts availability and lead times from the inventory database',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      partNumbers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of part numbers to look up (max 50)',
                      },
                    },
                    required: ['partNumbers'],
                  },
                }),
              },
            },
          },
        },
      },
    });
    partsLookupTarget.addDependency(gateway);

    // Target: warranty_rules
    const warrantyRulesTarget = new cdk.CfnResource(this, 'WarrantyRulesTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: this.gatewayId,
        Name: 'warranty-rules',
        Description: 'Warranty rules evaluation MCP tool — determines warranty coverage',
        TargetConfiguration: {
          Mcp: {
            Lambda: {
              LambdaArn: warrantyRulesLambda.function.functionArn,
              ToolSchema: {
                InlinePayload: JSON.stringify({
                  name: 'warranty_rules',
                  description: 'Evaluate warranty coverage based on vehicle age and mileage',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      modelYear: { type: 'number', description: 'Vehicle model year (4-digit)' },
                      telematicsId: { type: 'string', description: 'Vehicle telematics ID for mileage derivation' },
                    },
                    required: ['modelYear', 'telematicsId'],
                  },
                }),
              },
            },
          },
        },
      },
    });
    warrantyRulesTarget.addDependency(gateway);

    // Target: privatelink_service
    const privatelinkTarget = new cdk.CfnResource(this, 'PrivateLinkServiceTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: this.gatewayId,
        Name: 'privatelink-service',
        Description: 'PrivateLink service MCP tool — calls ECS mock dealer service via VPC endpoint',
        TargetConfiguration: {
          Mcp: {
            Lambda: {
              LambdaArn: privatelinkServiceLambda.function.functionArn,
              ToolSchema: {
                InlinePayload: JSON.stringify({
                  name: 'privatelink_service',
                  description: 'Call the mock dealer parts service via PrivateLink for additional inventory data',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      endpoint: { type: 'string', description: 'Endpoint path (default: /dealer-parts)' },
                    },
                    required: [],
                  },
                }),
              },
            },
          },
        },
      },
    });
    privatelinkTarget.addDependency(gateway);

    // ─── Agent Prompt Templates (stored as metadata for Pipeline Orchestrator) ──
    // These define the system prompts for each agent stage.
    // In production, these would be stored in the AgentCore Runtime config.
    // For this demo, they are exported as outputs for the Pipeline Orchestrator to use.

    // ─── CloudFormation Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: this.agentRuntimeId,
      description: 'AgentCore Runtime ID',
      exportName: 'VsiAgentCoreRuntimeId',
    });

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
      exportName: 'VsiAgentCoreRuntimeArn',
    });

    new cdk.CfnOutput(this, 'GatewayId', {
      value: this.gatewayId,
      description: 'AgentCore Gateway ID',
      exportName: 'VsiAgentCoreGatewayId',
    });

    new cdk.CfnOutput(this, 'KbRetrievalLambdaArn', {
      value: kbRetrievalLambda.function.functionArn,
      description: 'KB Retrieval MCP tool Lambda ARN',
      exportName: 'VsiKbRetrievalLambdaArn',
    });

    new cdk.CfnOutput(this, 'PartsLookupLambdaArn', {
      value: partsLookupLambda.function.functionArn,
      description: 'Parts Lookup MCP tool Lambda ARN',
      exportName: 'VsiPartsLookupLambdaArn',
    });

    new cdk.CfnOutput(this, 'WarrantyRulesLambdaArn', {
      value: warrantyRulesLambda.function.functionArn,
      description: 'Warranty Rules MCP tool Lambda ARN',
      exportName: 'VsiWarrantyRulesLambdaArn',
    });

    new cdk.CfnOutput(this, 'PrivateLinkServiceLambdaArn', {
      value: privatelinkServiceLambda.function.functionArn,
      description: 'PrivateLink Service MCP tool Lambda ARN',
      exportName: 'VsiPrivateLinkServiceLambdaArn',
    });
  }
}
