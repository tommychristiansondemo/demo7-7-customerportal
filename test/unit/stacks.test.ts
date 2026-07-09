import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../../lib/stacks/data-stack';
import { WebSocketStack } from '../../lib/stacks/websocket-stack';
import { ObservabilityStack } from '../../lib/stacks/observability-stack';

/**
 * CDK assertion tests for the most critical VSI nested stacks.
 *
 * Verifies:
 * - DataStack: DynamoDB table with correct key schema
 * - WebSocketStack: WebSocket API + DynamoDB connections table + 3 Lambdas
 * - ObservabilityStack: CloudWatch dashboard + alarms + SNS topic
 * - RemovalPolicy DESTROY on S3 buckets and DynamoDB tables
 *
 * Requirements: 15.1, 15.2, 15.3, 15.5
 */

// ─────────────────────────────────────────────────────────────────────────────
// DataStack
// ─────────────────────────────────────────────────────────────────────────────

describe('DataStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const parentStack = new cdk.Stack(app, 'TestParent');
    const dataStack = new DataStack(parentStack, 'DataStack');
    template = Template.fromStack(dataStack);
  });

  it('creates DynamoDB table with part_number partition key (String)', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'part_number', KeyType: 'HASH' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'part_number', AttributeType: 'S' },
      ]),
    });
  });

  it('sets DynamoDB table billing to PAY_PER_REQUEST', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('sets RemovalPolicy to DESTROY on DynamoDB table', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  it('creates seed Lambda with TABLE_NAME environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('creates a custom resource for data seeding', () => {
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
  });

  it('exports table name and ARN', () => {
    template.hasOutput('*', {
      Export: { Name: 'VsiPartsTableName' },
    });
    template.hasOutput('*', {
      Export: { Name: 'VsiPartsTableArn' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketStack
// ─────────────────────────────────────────────────────────────────────────────

describe('WebSocketStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const parentStack = new cdk.Stack(app, 'TestParent', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const wsStack = new WebSocketStack(parentStack, 'WebSocketStack');
    template = Template.fromStack(wsStack);
  });

  // --- WebSocket API ---

  it('creates a WebSocket API with WEBSOCKET protocol', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'WEBSOCKET',
      RouteSelectionExpression: '$request.body.action',
    });
  });

  it('creates $connect, $disconnect, and $default routes', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$connect',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$disconnect',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$default',
      AuthorizationType: 'NONE',
    });
  });

  it('creates a prod stage with autoDeploy', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      AutoDeploy: true,
    });
  });

  // --- DynamoDB Connections Table ---

  it('creates DynamoDB connections table with connectionId partition key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'connectionId', KeyType: 'HASH' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'connectionId', AttributeType: 'S' },
      ]),
    });
  });

  it('creates submissionId-index GSI on connections table', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'submissionId-index',
          KeySchema: [
            { AttributeName: 'submissionId', KeyType: 'HASH' },
          ],
        }),
      ]),
    });
  });

  it('enables TTL on connections table ttl attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    });
  });

  it('sets RemovalPolicy to DESTROY on connections table', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  // --- Lambda Functions (3 total: connect, disconnect, publisher) ---

  it('creates at least 3 Lambda functions', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(3);
  });

  it('creates Lambda with CONNECTIONS_TABLE_NAME environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CONNECTIONS_TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('creates Lambda with WEBSOCKET_ENDPOINT environment variable (publisher)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WEBSOCKET_ENDPOINT: Match.anyValue(),
        }),
      },
    });
  });

  // --- Exports ---

  it('exports WebSocket endpoint URL', () => {
    template.hasOutput('*', {
      Export: { Name: 'VsiWebSocketEndpointUrl' },
    });
  });

  it('exports connections table name and ARN', () => {
    template.hasOutput('*', {
      Export: { Name: 'VsiConnectionsTableName' },
    });
    template.hasOutput('*', {
      Export: { Name: 'VsiConnectionsTableArn' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ObservabilityStack
// ─────────────────────────────────────────────────────────────────────────────

describe('ObservabilityStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const parentStack = new cdk.Stack(app, 'TestParent');
    const obsStack = new ObservabilityStack(parentStack, 'ObservabilityStack');
    template = Template.fromStack(obsStack);
  });

  // --- CloudWatch Dashboard ---

  it('creates a CloudWatch dashboard', () => {
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'VSI-Pipeline-Dashboard',
    });
  });

  // --- CloudWatch Alarms ---

  it('creates Lambda error rate alarm with >5% threshold', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'VSI-Lambda-ErrorRate-High',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
    });
  });

  it('creates Lambda duration P95 alarm with >25s threshold', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'VSI-Lambda-Duration-P95-High',
      Threshold: 25000,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
    });
  });

  it('creates at least 2 CloudWatch alarms', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(2);
  });

  // --- SNS Topic ---

  it('creates SNS topic for alarm notifications', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'vsi-pipeline-alarms',
      DisplayName: 'VSI Pipeline Alarms',
    });
  });

  it('configures alarms to notify SNS topic', () => {
    // Both alarms should have alarm actions pointing to SNS
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'VSI-Lambda-ErrorRate-High',
      AlarmActions: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'VSI-Lambda-Duration-P95-High',
      AlarmActions: Match.anyValue(),
    });
  });

  // --- Metric Filters ---

  it('creates metric filter for pipeline completions', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: 'VSI/Pipeline',
          MetricName: 'PipelineCompleted',
        }),
      ]),
    });
  });

  it('creates metric filter for pipeline errors', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: 'VSI/Pipeline',
          MetricName: 'PipelineError',
        }),
      ]),
    });
  });

  it('creates metric filter for agent latency', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: 'VSI/Pipeline',
          MetricName: 'AgentLatency',
        }),
      ]),
    });
  });

  it('creates metric filter for model routing decisions', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: 'VSI/ModelRouter',
          MetricName: 'ModelSelected',
        }),
      ]),
    });
  });
});
