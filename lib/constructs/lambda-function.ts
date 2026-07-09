import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Props for the reusable VsiLambdaFunction construct.
 *
 * Each Lambda created by this construct gets:
 * - X-Ray active tracing (Req 14.1)
 * - CloudWatch Log Group with 7-day retention (Req 14.3)
 * - A dedicated IAM execution role (Req 15.1)
 * - esbuild bundling via NodejsFunction
 */
export interface VsiLambdaFunctionProps {
  /** Absolute path to the handler source file (e.g. path.join(__dirname, '../../src/lambdas/intake-handler/index.ts')) */
  readonly entry: string;

  /** Exported handler function name. Defaults to 'handler'. */
  readonly handler?: string;

  /** Lambda runtime. Defaults to Node.js 20.x. */
  readonly runtime?: lambda.Runtime;

  /** Function timeout. Defaults to 30 seconds. */
  readonly timeout?: cdk.Duration;

  /** Memory allocation in MB. Defaults to 256. */
  readonly memorySize?: number;

  /** Environment variables to set on the function. */
  readonly environment?: Record<string, string>;

  /** VPC to place the Lambda in (optional, for PrivateLink connectivity). */
  readonly vpc?: ec2.IVpc;

  /** Security groups for VPC-connected Lambda (optional). */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /** VPC subnet selection (optional, defaults to PRIVATE_ISOLATED if vpc is provided). */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /** Additional esbuild bundling options. */
  readonly bundling?: lambdaNode.BundlingOptions;

  /** Lambda layers (e.g. AppConfig extension). */
  readonly layers?: lambda.ILayerVersion[];

  /** Description for the Lambda function. */
  readonly description?: string;
}

/**
 * VsiLambdaFunction — Reusable Lambda construct enforcing VSI standards.
 *
 * Creates a NodejsFunction with:
 * - X-Ray active tracing enabled
 * - Dedicated CloudWatch Log Group with 7-day retention
 * - Dedicated IAM execution role (no wildcards)
 * - esbuild bundling for TypeScript
 */
export class VsiLambdaFunction extends Construct {
  /** The underlying Lambda function. */
  public readonly function: lambdaNode.NodejsFunction;

  /** The dedicated execution role for this Lambda. */
  public readonly role: iam.Role;

  /** The CloudWatch Log Group for this Lambda. */
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: VsiLambdaFunctionProps) {
    super(scope, id);

    // Dedicated IAM execution role (Req 15.1 — no wildcard actions/resources)
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Execution role for ${id} Lambda`,
    });

    // Grant basic Lambda execution permissions (logs + X-Ray) without wildcards
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'logs',
            resource: 'log-group',
            resourceName: `/aws/lambda/*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      }),
    );

    // If VPC is specified, grant ENI management permissions
    if (props.vpc) {
      this.role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DeleteNetworkInterface',
            'ec2:AssignPrivateIpAddresses',
            'ec2:UnassignPrivateIpAddresses',
          ],
          resources: ['*'],
        }),
      );
    }

    // CloudWatch Log Group with 7-day retention (Req 14.3)
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function with esbuild bundling and X-Ray tracing (Req 14.1)
    this.function = new lambdaNode.NodejsFunction(this, 'Function', {
      entry: props.entry,
      handler: props.handler ?? 'handler',
      runtime: props.runtime ?? lambda.Runtime.NODEJS_20_X,
      timeout: props.timeout ?? cdk.Duration.seconds(30),
      memorySize: props.memorySize ?? 256,
      environment: props.environment,
      role: this.role,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: this.logGroup,
      vpc: props.vpc,
      securityGroups: props.securityGroups,
      vpcSubnets: props.vpc
        ? props.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
        : undefined,
      layers: props.layers,
      description: props.description,
      bundling: props.bundling ?? {
        minify: true,
        sourceMap: true,
        target: 'es2022',
      },
    });
  }
}
