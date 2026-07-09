import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * DataStack — Provisions the DynamoDB parts inventory table and seeds it
 * with fictional part records for the Parts & Logistics Agent demo.
 *
 * Requirements: 8.1, 8.2, 16.5
 */
export class DataStack extends cdk.NestedStack {
  /** The DynamoDB parts inventory table. */
  public readonly partsTable: dynamodb.Table;

  /** Exported table name. */
  public readonly tableNameOutput: cdk.CfnOutput;

  /** Exported table ARN. */
  public readonly tableArnOutput: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // DynamoDB table with partition key `part_number` (String)
    this.partsTable = new dynamodb.Table(this, 'PartsInventoryTable', {
      tableName: 'vsi-parts-inventory',
      partitionKey: {
        name: 'part_number',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Log group for the seed Lambda (7-day retention)
    const seedLogGroup = new logs.LogGroup(this, 'SeedFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Custom resource Lambda to seed data on stack creation
    const seedFunction = new lambdaNode.NodejsFunction(this, 'SeedFunction', {
      entry: path.join(__dirname, '../../src/lambdas/seed-parts-inventory/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.partsTable.tableName,
      },
      logGroup: seedLogGroup,
      description: 'Seeds the parts inventory DynamoDB table with fictional records',
    });

    // Grant the seed Lambda write access to the parts table
    this.partsTable.grantWriteData(seedFunction);

    // Custom resource that triggers the seed Lambda on Create/Update
    const providerLogGroup = new logs.LogGroup(this, 'SeedProviderLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const provider = new cr.Provider(this, 'SeedProvider', {
      onEventHandler: seedFunction,
      logGroup: providerLogGroup,
    });

    new cdk.CustomResource(this, 'SeedPartsData', {
      serviceToken: provider.serviceToken,
      properties: {
        // Change this value to force re-seed on stack updates
        version: '1.0.0',
      },
    });

    // CloudFormation outputs
    this.tableNameOutput = new cdk.CfnOutput(this, 'PartsTableName', {
      value: this.partsTable.tableName,
      description: 'DynamoDB parts inventory table name',
      exportName: 'VsiPartsTableName',
    });

    this.tableArnOutput = new cdk.CfnOutput(this, 'PartsTableArn', {
      value: this.partsTable.tableArn,
      description: 'DynamoDB parts inventory table ARN',
      exportName: 'VsiPartsTableArn',
    });
  }
}
