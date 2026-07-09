import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';
import { VsiLambdaFunction } from '../constructs/lambda-function';

/**
 * Props for the ApiStack nested stack.
 */
export interface ApiStackProps extends cdk.NestedStackProps {
  /** AppConfig Application ID for weights updater Lambda */
  readonly appConfigApplicationId: string;
  /** AppConfig Environment ID for weights updater Lambda */
  readonly appConfigEnvironmentId: string;
  /** AppConfig Configuration Profile ID for weights updater Lambda */
  readonly appConfigConfigurationProfileId: string;
  /** AppConfig Deployment Strategy ID for weights updater Lambda */
  readonly appConfigDeploymentStrategyId?: string;
  /** WebSocket API endpoint URL (passed to intake handler for response) */
  readonly websocketEndpoint?: string;
}

/**
 * ApiStack — Provisions the HTTP API (API Gateway v2) and associated Lambda functions.
 *
 * Creates:
 *   - HTTP API with CORS configured for https://nissan.awsteach.com
 *   - POST /submissions route → Intake Handler Lambda
 *   - PUT /config/weights route → Weights Updater Lambda
 *   - GET /config/weights route → Weights Updater Lambda
 *   - X-Ray tracing on the HTTP API (via CfnStage override)
 *   - Dedicated IAM role for Intake Handler (invoke pipeline Lambda, InvokeAgentRuntime)
 *   - Exports HTTP API endpoint URL
 *
 * Validates: Requirements 14.1, 15.1, 15.2, 16.2
 */
export class ApiStack extends cdk.NestedStack {
  /** The HTTP API construct */
  public readonly httpApi: apigatewayv2.HttpApi;

  /** The Intake Handler Lambda construct */
  public readonly intakeHandler: VsiLambdaFunction;

  /** The Weights Updater Lambda construct */
  public readonly weightsUpdater: VsiLambdaFunction;

  /** The HTTP API endpoint URL */
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // --- AppConfig Lambda Extension Layer ---
    // AWS-provided AppConfig extension layer ARN for Node.js in us-east-1
    const appConfigExtensionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'AppConfigExtension',
      `arn:aws:lambda:${cdk.Stack.of(this).region}:027255383542:layer:AWS-AppConfig-Extension:128`,
    );

    // --- Intake Handler Lambda ---
    this.intakeHandler = new VsiLambdaFunction(this, 'IntakeHandler', {
      entry: path.join(__dirname, '../../src/lambdas/intake-handler/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      description: 'Receives POST /submissions, validates payload, invokes pipeline asynchronously',
      environment: {
        WEBSOCKET_ENDPOINT: props.websocketEndpoint ?? '',
        PIPELINE_FUNCTION_NAME: '', // Set via addEnvironment after pipeline Lambda is created
      },
      layers: [appConfigExtensionLayer],
    });

    // Grant Intake Handler permission to invoke pipeline Lambda and InvokeAgentRuntime
    this.intakeHandler.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokePipelineLambda',
        actions: ['lambda:InvokeFunction'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'lambda',
            resource: 'function',
            resourceName: '*pipeline*',
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    this.intakeHandler.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeAgentRuntime',
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'bedrock-agentcore',
            resource: 'runtime',
            resourceName: '*',
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );

    // --- Weights Updater Lambda ---
    this.weightsUpdater = new VsiLambdaFunction(this, 'WeightsUpdater', {
      entry: path.join(__dirname, '../../src/lambdas/appconfig-weights-updater/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      description: 'PUT/GET /config/weights — updates or reads AppConfig model routing weights',
      environment: {
        APPCONFIG_APPLICATION_ID: props.appConfigApplicationId,
        APPCONFIG_ENVIRONMENT_ID: props.appConfigEnvironmentId,
        APPCONFIG_CONFIGURATION_PROFILE_ID: props.appConfigConfigurationProfileId,
        APPCONFIG_DEPLOYMENT_STRATEGY_ID: props.appConfigDeploymentStrategyId ?? '',
        AWS_APPCONFIG_EXTENSION_POLL_INTERVAL_SECONDS: '45',
      },
      layers: [appConfigExtensionLayer],
    });

    // Grant Weights Updater permissions for AppConfig operations
    this.weightsUpdater.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AppConfigWrite',
        actions: [
          'appconfig:CreateHostedConfigurationVersion',
          'appconfig:StartDeployment',
        ],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'appconfig',
            resource: 'application',
            resourceName: `${props.appConfigApplicationId}/*`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
          cdk.Stack.of(this).formatArn({
            service: 'appconfig',
            resource: 'application',
            resourceName: `${props.appConfigApplicationId}`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
          cdk.Stack.of(this).formatArn({
            service: 'appconfig',
            resource: 'deploymentstrategy',
            resourceName: '*',
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );

    this.weightsUpdater.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AppConfigRead',
        actions: [
          'appconfig:GetLatestConfiguration',
          'appconfig:StartConfigurationSession',
        ],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'appconfig',
            resource: 'application',
            resourceName: `${props.appConfigApplicationId}/environment/${props.appConfigEnvironmentId}/configuration/${props.appConfigConfigurationProfileId}`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );

    // --- HTTP API (API Gateway v2) ---
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'vsi-http-api',
      description: 'Vehicle Service Intelligence HTTP API — intake submissions and config routes',
      corsPreflight: {
        allowOrigins: ['https://nissan.awsteach.com'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Enable detailed metrics on the HTTP API default stage (Req 14.1)
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.addPropertyOverride('DefaultRouteSettings.DetailedMetricsEnabled', true);
    }

    // --- Routes ---

    // POST /submissions → Intake Handler
    this.httpApi.addRoutes({
      path: '/submissions',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        'IntakeHandlerIntegration',
        this.intakeHandler.function,
      ),
    });

    // PUT /config/weights → Weights Updater
    this.httpApi.addRoutes({
      path: '/config/weights',
      methods: [apigatewayv2.HttpMethod.PUT],
      integration: new integrations.HttpLambdaIntegration(
        'WeightsUpdaterPutIntegration',
        this.weightsUpdater.function,
      ),
    });

    // GET /config/weights → Weights Updater
    this.httpApi.addRoutes({
      path: '/config/weights',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'WeightsUpdaterGetIntegration',
        this.weightsUpdater.function,
      ),
    });

    // --- Store endpoint ---
    this.apiEndpoint = this.httpApi.apiEndpoint;

    // --- CloudFormation Outputs ---
    new cdk.CfnOutput(this, 'HttpApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API endpoint URL for VSI',
      exportName: 'VSI-HttpApi-Endpoint',
    });

    new cdk.CfnOutput(this, 'HttpApiId', {
      value: this.httpApi.httpApiId,
      description: 'HTTP API ID',
      exportName: 'VSI-HttpApi-Id',
    });
  }
}
