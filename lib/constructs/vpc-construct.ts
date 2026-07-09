import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Props for the VsiVpc construct.
 */
export interface VsiVpcProps {
  /** VPC CIDR block. Defaults to 10.0.0.0/16. */
  readonly cidr?: string;

  /** Maximum number of AZs. Defaults to 2. */
  readonly maxAzs?: number;
}

/**
 * VsiVpc — VPC construct with private subnets only.
 *
 * Design requirements:
 * - CIDR: 10.0.0.0/16
 * - Private subnets only (no public subnets, no NAT Gateway, no Internet Gateway)
 * - Multi-AZ (at least 2 AZs)
 * - VPC Gateway Endpoints for S3 and DynamoDB
 * - Interface Endpoints for CloudWatch Logs and X-Ray
 */
export class VsiVpc extends Construct {
  /** The underlying VPC. */
  public readonly vpc: ec2.Vpc;

  /** Gateway endpoint for S3. */
  public readonly s3Endpoint: ec2.GatewayVpcEndpoint;

  /** Gateway endpoint for DynamoDB. */
  public readonly dynamoDbEndpoint: ec2.GatewayVpcEndpoint;

  /** Interface endpoint for CloudWatch Logs. */
  public readonly cloudWatchLogsEndpoint: ec2.InterfaceVpcEndpoint;

  /** Interface endpoint for X-Ray. */
  public readonly xRayEndpoint: ec2.InterfaceVpcEndpoint;

  constructor(scope: Construct, id: string, props?: VsiVpcProps) {
    super(scope, id);

    // VPC with private isolated subnets only — no NAT, no IGW
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props?.cidr ?? '10.0.0.0/16'),
      maxAzs: props?.maxAzs ?? 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // VPC Gateway Endpoint for S3
    this.s3Endpoint = this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // VPC Gateway Endpoint for DynamoDB
    this.dynamoDbEndpoint = this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface Endpoint for CloudWatch Logs
    this.cloudWatchLogsEndpoint = this.vpc.addInterfaceEndpoint(
      'CloudWatchLogsEndpoint',
      {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        privateDnsEnabled: true,
      },
    );

    // Interface Endpoint for X-Ray
    this.xRayEndpoint = this.vpc.addInterfaceEndpoint('XRayEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.XRAY,
      privateDnsEnabled: true,
    });
  }
}
