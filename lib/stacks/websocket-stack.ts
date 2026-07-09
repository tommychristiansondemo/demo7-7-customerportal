import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';
import { VsiLambdaFunction } from '../constructs/lambda-function';

/**
 * WebSocketStack — Provisions the WebSocket API Gateway and supporting
 * DynamoDB connections table for real-time pipeline status streaming.
 *
 * Resources:
 * - WebSocket API with $connect, $disconnect, $default routes
 * - DynamoDB connections table (PK: connectionId, GSI: submissionId-index, TTL on `ttl`)
 * - Dedicated IAM roles for connect (PutItem) and disconnect (DeleteItem) Lambdas
 * - WebSocket Publisher Lambda for fan-out status messages
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 16.2
 */
export class WebSocketStack extends cdk.NestedStack {
  /** The WebSocket API. */
  public readonly webSocketApi: apigatewayv2.CfnApi;

  /** The WebSocket API stage. */
  public readonly webSocketStage: apigatewayv2.CfnStage;

  /** The DynamoDB connections table. */
  public readonly connectionsTable: dynamodb.Table;

  /** The connect Lambda construct. */
  public readonly connectLambda: VsiLambdaFunction;

  /** The disconnect Lambda construct. */
  public readonly disconnectLambda: VsiLambdaFunction;

  /** The WebSocket Publisher Lambda construct. */
  public readonly publisherLambda: VsiLambdaFunction;

  /** Exported WebSocket API endpoint URL. */
  public readonly webSocketEndpointOutput: cdk.CfnOutput;

  /** Exported connections table name. */
  public readonly connectionsTableNameOutput: cdk.CfnOutput;

  /** Exported connections table ARN. */
  public readonly connectionsTableArnOutput: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────────────────
    // DynamoDB Connections Table
    // ─────────────────────────────────────────────────────────────────────────

    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'vsi-websocket-connections',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI: submissionId-index — allows lookup of all connections for a given submission
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'submissionId-index',
      partitionKey: {
        name: 'submissionId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket Connect Lambda
    // ─────────────────────────────────────────────────────────────────────────

    this.connectLambda = new VsiLambdaFunction(this, 'WebSocketConnect', {
      entry: path.join(__dirname, '../../src/lambdas/websocket-connect/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      description: 'WebSocket $connect handler — stores connection record in DynamoDB',
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
      },
    });

    // Grant PutItem only on the connections table (least-privilege, Req 15.1)
    this.connectLambda.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [this.connectionsTable.tableArn],
      }),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket Disconnect Lambda
    // ─────────────────────────────────────────────────────────────────────────

    this.disconnectLambda = new VsiLambdaFunction(this, 'WebSocketDisconnect', {
      entry: path.join(__dirname, '../../src/lambdas/websocket-disconnect/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      description: 'WebSocket $disconnect handler — removes connection record from DynamoDB',
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
      },
    });

    // Grant DeleteItem only on the connections table (least-privilege, Req 15.1)
    this.disconnectLambda.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:DeleteItem'],
        resources: [this.connectionsTable.tableArn],
      }),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket API (API Gateway v2)
    // ─────────────────────────────────────────────────────────────────────────

    this.webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
      name: 'vsi-websocket-api',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
      description: 'VSI WebSocket API for real-time pipeline status streaming',
    });

    // $connect integration
    const connectIntegration = new apigatewayv2.CfnIntegration(this, 'ConnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.connectLambda.function.functionArn}/invocations`,
    });

    // $disconnect integration
    const disconnectIntegration = new apigatewayv2.CfnIntegration(this, 'DisconnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.disconnectLambda.function.functionArn}/invocations`,
    });

    // $default integration (uses disconnect Lambda as a no-op handler)
    const defaultIntegration = new apigatewayv2.CfnIntegration(this, 'DefaultIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.disconnectLambda.function.functionArn}/invocations`,
    });

    // Routes
    const connectRoute = new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    const disconnectRoute = new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${disconnectIntegration.ref}`,
    });

    const defaultRoute = new apigatewayv2.CfnRoute(this, 'DefaultRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$default',
      authorizationType: 'NONE',
      target: `integrations/${defaultIntegration.ref}`,
    });

    // Stage (auto-deploy)
    this.webSocketStage = new apigatewayv2.CfnStage(this, 'WebSocketStage', {
      apiId: this.webSocketApi.ref,
      stageName: 'prod',
      autoDeploy: true,
      description: 'Production stage for VSI WebSocket API',
    });

    // Deployment — ensures routes are created before deploying
    const deployment = new apigatewayv2.CfnDeployment(this, 'WebSocketDeployment', {
      apiId: this.webSocketApi.ref,
    });
    deployment.addDependency(connectRoute);
    deployment.addDependency(disconnectRoute);
    deployment.addDependency(defaultRoute);

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda permissions for API Gateway to invoke
    // ─────────────────────────────────────────────────────────────────────────

    this.connectLambda.function.addPermission('ApiGatewayInvokeConnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$connect`,
    });

    this.disconnectLambda.function.addPermission('ApiGatewayInvokeDisconnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$disconnect`,
    });

    this.disconnectLambda.function.addPermission('ApiGatewayInvokeDefault', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$default`,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket Publisher Lambda
    // ─────────────────────────────────────────────────────────────────────────

    this.publisherLambda = new VsiLambdaFunction(this, 'WebSocketPublisher', {
      entry: path.join(__dirname, '../../src/lambdas/websocket-publisher/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      description: 'WebSocket Publisher — fans out pipeline status messages to connected clients',
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        WEBSOCKET_ENDPOINT: `https://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`,
      },
    });

    // Grant Query on the GSI (submissionId-index) + DeleteItem for stale connections
    this.publisherLambda.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${this.connectionsTable.tableArn}/index/submissionId-index`],
      }),
    );

    this.publisherLambda.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:DeleteItem'],
        resources: [this.connectionsTable.tableArn],
      }),
    );

    // Grant execute-api:ManageConnections to post messages to WebSocket clients
    this.publisherLambda.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/prod/POST/@connections/*`,
        ],
      }),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // CloudFormation Outputs
    // ─────────────────────────────────────────────────────────────────────────

    this.webSocketEndpointOutput = new cdk.CfnOutput(this, 'WebSocketEndpointUrl', {
      value: `wss://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`,
      description: 'WebSocket API endpoint URL',
      exportName: 'VsiWebSocketEndpointUrl',
    });

    this.connectionsTableNameOutput = new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      description: 'DynamoDB WebSocket connections table name',
      exportName: 'VsiConnectionsTableName',
    });

    this.connectionsTableArnOutput = new cdk.CfnOutput(this, 'ConnectionsTableArn', {
      value: this.connectionsTable.tableArn,
      description: 'DynamoDB WebSocket connections table ARN',
      exportName: 'VsiConnectionsTableArn',
    });
  }
}
