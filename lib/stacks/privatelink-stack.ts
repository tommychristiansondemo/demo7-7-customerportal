import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { VsiVpc } from '../constructs/vpc-construct';

/**
 * PrivateLinkStack — Provisions the VPC, ECS Fargate mock dealer service,
 * Network Load Balancer, and VPC Endpoint Service for the PrivateLink pattern demo.
 *
 * Architecture:
 *   Lambda (sg-lambda) → VPC Endpoint → NLB (sg-nlb) → ECS Fargate (sg-ecs)
 *
 * All traffic stays within private IP space. No public subnets, no NAT, no IGW.
 * Uses the VsiVpc construct from lib/constructs/vpc-construct.ts.
 *
 * Requirements: 10.1, 10.2, 10.5
 */
export class PrivateLinkStack extends cdk.NestedStack {
  /** The VPC hosting the PrivateLink infrastructure. */
  public readonly vpc: ec2.Vpc;

  /** Security group for the Lambda ENI (consumer side). */
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  /** The VPC Endpoint Service name for consumers to connect. */
  public readonly endpointServiceName: cdk.CfnOutput;

  /** The NLB DNS name for direct reference. */
  public readonly nlbDnsName: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // ─── VPC (via reusable VsiVpc construct) ─────────────────────────────────────
    // Private subnets only, no NAT Gateway, no Internet Gateway
    // Includes Gateway Endpoints for S3/DynamoDB, Interface Endpoints for CloudWatch/X-Ray
    const vsiVpc = new VsiVpc(this, 'PrivateLinkVpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 2,
    });
    this.vpc = vsiVpc.vpc;

    // ─── Security Groups ────────────────────────────────────────────────────────
    const vpcCidr = ec2.Peer.ipv4('10.0.0.0/16');

    // sg-lambda: attached to Lambda ENIs in this VPC
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'SgLambda', {
      vpc: this.vpc,
      securityGroupName: 'vsi-sg-lambda',
      description: 'Security group for PrivateLink Service Lambda ENIs',
      allowAllOutbound: false,
    });

    // sg-nlb: attached to the Network Load Balancer
    const nlbSecurityGroup = new ec2.SecurityGroup(this, 'SgNlb', {
      vpc: this.vpc,
      securityGroupName: 'vsi-sg-nlb',
      description: 'Security group for NLB fronting ECS dealer service',
      allowAllOutbound: false,
    });

    // sg-ecs: attached to ECS Fargate tasks
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'SgEcs', {
      vpc: this.vpc,
      securityGroupName: 'vsi-sg-ecs',
      description: 'Security group for ECS Fargate mock dealer service',
      allowAllOutbound: false,
    });

    // sg-lambda: outbound TCP 80 to sg-nlb, TCP 443 to VPC endpoints
    this.lambdaSecurityGroup.addEgressRule(
      nlbSecurityGroup,
      ec2.Port.tcp(80),
      'Allow outbound to NLB on port 80',
    );
    this.lambdaSecurityGroup.addEgressRule(
      vpcCidr,
      ec2.Port.tcp(443),
      'Allow outbound HTTPS to VPC endpoints',
    );

    // sg-nlb: inbound TCP 80 from sg-lambda
    nlbSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(80),
      'Allow inbound TCP 80 from Lambda',
    );
    // sg-nlb: outbound TCP 80 to sg-ecs
    nlbSecurityGroup.addEgressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(80),
      'Allow outbound TCP 80 to ECS tasks',
    );

    // sg-ecs: inbound TCP 80 from sg-nlb
    ecsSecurityGroup.addIngressRule(
      nlbSecurityGroup,
      ec2.Port.tcp(80),
      'Allow inbound TCP 80 from NLB',
    );
    // sg-ecs: outbound only to VPC CIDR (deny 0.0.0.0/0 except VPC + AWS endpoints)
    ecsSecurityGroup.addEgressRule(
      vpcCidr,
      ec2.Port.tcp(443),
      'Allow outbound HTTPS to VPC CIDR for AWS endpoints',
    );

    // ─── ECS Cluster + Fargate Task ─────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'DealerServiceCluster', {
      vpc: this.vpc,
      clusterName: 'vsi-dealer-service',
    });

    // Log group for ECS tasks
    const ecsLogGroup = new logs.LogGroup(this, 'EcsTaskLogGroup', {
      logGroupName: '/vsi/ecs/dealer-service',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Fargate task definition: 0.25 vCPU, 512 MB
    const taskDef = new ecs.FargateTaskDefinition(this, 'DealerServiceTask', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    // Container using the Docker image built from src/ecs/
    taskDef.addContainer('DealerServiceContainer', {
      image: ecs.ContainerImage.fromAsset('src/ecs'),
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({
        logGroup: ecsLogGroup,
        streamPrefix: 'dealer-service',
      }),
      essential: true,
    });

    // Fargate service with multi-AZ placement
    const fargateService = new ecs.FargateService(this, 'DealerFargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      assignPublicIp: false,
    });

    // ─── Network Load Balancer ──────────────────────────────────────────────────
    const nlb = new elbv2.NetworkLoadBalancer(this, 'DealerNlb', {
      vpc: this.vpc,
      internetFacing: false,
      crossZoneEnabled: true,
      securityGroups: [nlbSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Listener on port 80
    const listener = nlb.addListener('DealerListener', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
    });

    // Target group pointing at ECS Fargate tasks
    listener.addTargets('DealerTargets', {
      port: 80,
      targets: [fargateService],
      healthCheck: {
        enabled: true,
        protocol: elbv2.Protocol.HTTP,
        path: '/dealer-parts',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
    });

    // ─── VPC Endpoint Service ───────────────────────────────────────────────────
    const endpointService = new ec2.VpcEndpointService(this, 'DealerEndpointService', {
      vpcEndpointServiceLoadBalancers: [nlb],
      acceptanceRequired: false, // auto-accept within same account
    });

    // ─── VPC Interface Endpoint (consumer side) ─────────────────────────────────
    // Creates an Interface Endpoint in this VPC so Lambdas can reach the dealer
    // service through PrivateLink without traversing the public internet.
    const interfaceEndpoint = new ec2.InterfaceVpcEndpoint(this, 'DealerInterfaceEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(endpointService.vpcEndpointServiceName, 80),
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: false, // No private DNS; we use the endpoint-specific DNS name
      securityGroups: [this.lambdaSecurityGroup],
    });

    // ─── Outputs ────────────────────────────────────────────────────────────────
    this.endpointServiceName = new cdk.CfnOutput(this, 'EndpointServiceName', {
      value: endpointService.vpcEndpointServiceName,
      description: 'VPC Endpoint Service name for consumer stacks',
      exportName: 'VsiPrivateLinkServiceName',
    });

    this.nlbDnsName = new cdk.CfnOutput(this, 'NlbDnsName', {
      value: nlb.loadBalancerDnsName,
      description: 'NLB DNS name',
      exportName: 'VsiPrivateLinkNlbDns',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'PrivateLink VPC ID',
      exportName: 'VsiPrivateLinkVpcId',
    });

    new cdk.CfnOutput(this, 'VpcEndpointDnsName', {
      value: cdk.Fn.select(0, interfaceEndpoint.vpcEndpointDnsEntries),
      description: 'VPC Endpoint DNS name for PrivateLink Service Lambda to use',
      exportName: 'VsiPrivateLinkEndpointDns',
    });
  }
}
