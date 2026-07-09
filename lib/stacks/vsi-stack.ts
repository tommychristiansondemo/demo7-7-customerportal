import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiStack } from './api-stack';
import { AppConfigStack } from './appconfig-stack';
import { DataStack } from './data-stack';
import { DnsCertificateStack } from './dns-certificate-stack';
import { ObservabilityStack } from './observability-stack';
import { StaticHostingStack } from './static-hosting-stack';
import { WebSocketStack } from './websocket-stack';

/**
 * VsiStack — Root stack for Vehicle Service Intelligence.
 *
 * Composes nested stacks for logical separation while deploying
 * as a single CloudFormation stack for simplicity.
 *
 * Nested stacks will be added incrementally as each feature is built:
 *   - DnsCertificateStack (Req 1)
 *   - StaticHostingStack (Req 2)
 *   - DataStack (Req 8)
 *   - KnowledgeBaseStack (Req 7)
 *   - AppConfigStack (Req 11)
 *   - ApiStack (Req 3, 12)
 *   - WebSocketStack (Req 4)
 *   - AgentCoreStack (Req 5, 6)
 *   - PrivateLinkStack (Req 10)
 *   - ObservabilityStack (Req 14)
 */
export class VsiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DnsCertificateStack — ACM certificate + Route 53 validation (Req 1)
    const dnsCertificateStack = new DnsCertificateStack(this, 'DnsCertificateStack');

    // StaticHostingStack — S3 + CloudFront + OAC + Route 53 alias (Req 2)
    const staticHostingStack = new StaticHostingStack(this, 'StaticHostingStack', {
      certificate: dnsCertificateStack.certificate,
      hostedZone: dnsCertificateStack.hostedZone,
    });
    staticHostingStack.addDependency(dnsCertificateStack);

    // DataStack — DynamoDB parts inventory table + seed data (Req 8)
    const dataStack = new DataStack(this, 'DataStack');

    // AppConfigStack — AppConfig application, environment, config profile (Req 11)
    const appConfigStack = new AppConfigStack(this, 'AppConfigStack');

    // ApiStack — HTTP API + Intake Handler + Weights Updater (Req 3, 12)
    const apiStack = new ApiStack(this, 'ApiStack', {
      appConfigApplicationId: appConfigStack.applicationId,
      appConfigEnvironmentId: appConfigStack.environmentId,
      appConfigConfigurationProfileId: appConfigStack.configurationProfileId,
    });
    apiStack.addDependency(appConfigStack);

    // WebSocketStack — WebSocket API + connections table (Req 4)
    const webSocketStack = new WebSocketStack(this, 'WebSocketStack');

    // NOTE: KnowledgeBaseStack and AgentCoreStack are temporarily excluded from
    // automated deployment due to OpenSearch Serverless data access policy
    // propagation timing issues with CloudFormation. These can be deployed
    // manually via the AWS console or CLI after the AOSS collection is active.
    // The core demo flow (Portal → API → WebSocket → Progress UI) works without them.

    // ObservabilityStack — CloudWatch dashboard, alarms, metric filters (Req 14)
    const observabilityStack = new ObservabilityStack(this, 'ObservabilityStack');
    observabilityStack.addDependency(apiStack);
    observabilityStack.addDependency(webSocketStack);
  }
}
