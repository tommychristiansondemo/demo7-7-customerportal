import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/**
 * ObservabilityStack — CloudWatch monitoring for the VSI pipeline.
 *
 * Creates:
 *   - CloudWatch Dashboard with widgets for Lambda, API Gateway, DynamoDB, and WebSocket metrics
 *   - CloudWatch Alarms for Lambda error rate (>5%) and P95 duration (>25s)
 *   - SNS Topic for alarm notifications
 *   - Metric filters on Lambda log groups for structured log analysis
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
export class ObservabilityStack extends cdk.NestedStack {
  /** The CloudWatch Dashboard */
  public readonly dashboard: cloudwatch.Dashboard;

  /** SNS Topic for alarm notifications */
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────────────────
    // SNS Topic for Alarm Notifications
    // ─────────────────────────────────────────────────────────────────────────

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'vsi-pipeline-alarms',
      displayName: 'VSI Pipeline Alarms',
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda Function Names (used for metric references)
    // ─────────────────────────────────────────────────────────────────────────

    const lambdaFunctionNames = [
      'IntakeHandler',
      'PipelineOrchestrator',
      'WebSocketPublisher',
      'WebSocketConnect',
      'WebSocketDisconnect',
      'KbRetrieval',
      'PartsLookup',
      'WarrantyRules',
      'PrivateLinkService',
      'WeightsUpdater',
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // CloudWatch Alarms
    // ─────────────────────────────────────────────────────────────────────────

    // Lambda Error Rate Alarm (>5%)
    const lambdaErrorsMetric = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      usingMetrics: {
        errors: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        invocations: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Invocations',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
      },
      period: cdk.Duration.minutes(5),
    });

    const errorRateAlarm = new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
      alarmName: 'VSI-Lambda-ErrorRate-High',
      alarmDescription: 'Lambda error rate exceeds 5% over 5 minutes',
      metric: lambdaErrorsMetric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    errorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // Lambda Duration P95 Alarm (>25s)
    const lambdaDurationMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      statistic: 'p95',
      period: cdk.Duration.minutes(5),
    });

    const durationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationP95Alarm', {
      alarmName: 'VSI-Lambda-Duration-P95-High',
      alarmDescription: 'Lambda P95 duration exceeds 25 seconds',
      metric: lambdaDurationMetric,
      threshold: 25000, // 25 seconds in milliseconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // ─────────────────────────────────────────────────────────────────────────
    // Metric Filters on Lambda Log Groups
    // ─────────────────────────────────────────────────────────────────────────

    // Create metric filters for structured log analysis on the Pipeline Orchestrator log group
    const pipelineLogGroup = new logs.LogGroup(this, 'PipelineLogGroup', {
      logGroupName: '/aws/lambda/PipelineOrchestrator',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Metric filter: Count pipeline completions
    new logs.MetricFilter(this, 'PipelineCompletedFilter', {
      logGroup: pipelineLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.event_type = "pipeline_completed" }'),
      metricNamespace: 'VSI/Pipeline',
      metricName: 'PipelineCompleted',
      metricValue: '1',
      defaultValue: 0,
    });

    // Metric filter: Count pipeline errors
    new logs.MetricFilter(this, 'PipelineErrorFilter', {
      logGroup: pipelineLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.event_type = "error" }'),
      metricNamespace: 'VSI/Pipeline',
      metricName: 'PipelineError',
      metricValue: '1',
      defaultValue: 0,
    });

    // Metric filter: Agent latency (from structured logs)
    new logs.MetricFilter(this, 'AgentLatencyFilter', {
      logGroup: pipelineLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.event_type = "agent_stage_completed" }'),
      metricNamespace: 'VSI/Pipeline',
      metricName: 'AgentLatency',
      metricValue: '$.latency_ms',
      defaultValue: 0,
    });

    // Metric filter: Model routing decisions
    new logs.MetricFilter(this, 'ModelRoutingDecisionFilter', {
      logGroup: pipelineLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.event_type = "model_routing_decision" }'),
      metricNamespace: 'VSI/ModelRouter',
      metricName: 'ModelSelected',
      metricValue: '1',
      defaultValue: 0,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // CloudWatch Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    this.dashboard = new cloudwatch.Dashboard(this, 'VsiDashboard', {
      dashboardName: 'VSI-Pipeline-Dashboard',
    });

    // Apply RemovalPolicy.DESTROY on the dashboard
    const dashboardCfn = this.dashboard.node.defaultChild as cdk.CfnResource;
    dashboardCfn.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // --- Lambda Invocation Counts Widget ---
    const invocationsWidget = new cloudwatch.GraphWidget({
      title: 'Lambda Invocation Counts',
      width: 12,
      height: 6,
      left: lambdaFunctionNames.map(
        (name) =>
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            dimensionsMap: { FunctionName: name },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: name,
          }),
      ),
    });

    // --- Lambda Error Rates Widget ---
    const errorsWidget = new cloudwatch.GraphWidget({
      title: 'Lambda Error Rates',
      width: 12,
      height: 6,
      left: lambdaFunctionNames.map(
        (name) =>
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: { FunctionName: name },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: name,
          }),
      ),
    });

    // --- Lambda Duration Widget ---
    const durationWidget = new cloudwatch.GraphWidget({
      title: 'Lambda Duration (P95)',
      width: 12,
      height: 6,
      left: lambdaFunctionNames.map(
        (name) =>
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: { FunctionName: name },
            statistic: 'p95',
            period: cdk.Duration.minutes(1),
            label: name,
          }),
      ),
    });

    // --- API Gateway Request Counts Widget ---
    const apiGatewayWidget = new cloudwatch.GraphWidget({
      title: 'API Gateway Request Counts',
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: { ApiName: 'vsi-http-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'HTTP API Requests',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '4xx',
          dimensionsMap: { ApiName: 'vsi-http-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'HTTP API 4xx',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '5xx',
          dimensionsMap: { ApiName: 'vsi-http-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'HTTP API 5xx',
        }),
      ],
    });

    // --- DynamoDB Read/Write Units Widget ---
    const dynamoDbWidget = new cloudwatch.GraphWidget({
      title: 'DynamoDB Read/Write Capacity Units',
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedReadCapacityUnits',
          dimensionsMap: { TableName: 'vsi-parts-inventory' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Parts Table - Read Units',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedWriteCapacityUnits',
          dimensionsMap: { TableName: 'vsi-parts-inventory' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Parts Table - Write Units',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedReadCapacityUnits',
          dimensionsMap: { TableName: 'vsi-websocket-connections' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Connections Table - Read Units',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedWriteCapacityUnits',
          dimensionsMap: { TableName: 'vsi-websocket-connections' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Connections Table - Write Units',
        }),
      ],
    });

    // --- WebSocket Connection Counts Widget ---
    const webSocketWidget = new cloudwatch.GraphWidget({
      title: 'WebSocket Connection Counts',
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'ConnectCount',
          dimensionsMap: { ApiId: 'vsi-websocket-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Connections',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'DisconnectCount',
          dimensionsMap: { ApiId: 'vsi-websocket-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Disconnections',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'MessageCount',
          dimensionsMap: { ApiId: 'vsi-websocket-api' },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Messages Sent',
        }),
      ],
    });

    // --- VSI Custom Metrics Widget (Pipeline + Model Router) ---
    const customMetricsWidget = new cloudwatch.GraphWidget({
      title: 'VSI Pipeline Custom Metrics',
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: 'VSI/Pipeline',
          metricName: 'PipelineCompleted',
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Pipeline Completed',
        }),
        new cloudwatch.Metric({
          namespace: 'VSI/Pipeline',
          metricName: 'PipelineError',
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Pipeline Errors',
        }),
        new cloudwatch.Metric({
          namespace: 'VSI/Pipeline',
          metricName: 'AgentLatency',
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Avg Agent Latency (ms)',
        }),
        new cloudwatch.Metric({
          namespace: 'VSI/ModelRouter',
          metricName: 'ModelSelected',
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Model Routing Decisions',
        }),
      ],
    });

    // --- Alarm Status Widget ---
    const alarmStatusWidget = new cloudwatch.AlarmStatusWidget({
      title: 'Alarm Status',
      width: 24,
      height: 3,
      alarms: [errorRateAlarm, durationAlarm],
    });

    // Add widgets to dashboard in rows
    this.dashboard.addWidgets(alarmStatusWidget);
    this.dashboard.addWidgets(invocationsWidget, errorsWidget);
    this.dashboard.addWidgets(durationWidget, apiGatewayWidget);
    this.dashboard.addWidgets(dynamoDbWidget, webSocketWidget);
    this.dashboard.addWidgets(customMetricsWidget);

    // ─────────────────────────────────────────────────────────────────────────
    // CloudFormation Outputs
    // ─────────────────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'DashboardName', {
      value: this.dashboard.dashboardName,
      description: 'CloudWatch Dashboard name for VSI pipeline monitoring',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS Topic ARN for VSI pipeline alarm notifications',
    });
  }
}
