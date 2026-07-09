import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

/**
 * DnsCertificateStack — Provisions ACM certificate and DNS validation records.
 *
 * - Imports existing Route 53 hosted zone by ID from CDK context (Req 1.4)
 * - Provisions ACM certificate for nissan.awsteach.com with DNS validation (Req 1.1)
 * - Creates CNAME validation records in the hosted zone (Req 1.2)
 * - Fails with descriptive error if hosted zone ID context value is missing (Req 1.5)
 * - Exports certificate ARN and hosted zone for use by StaticHostingStack
 */
export class DnsCertificateStack extends cdk.NestedStack {
  /** The ACM certificate for nissan.awsteach.com */
  public readonly certificate: acm.ICertificate;

  /** The imported Route 53 hosted zone */
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // Read hosted zone ID from CDK context (Req 1.4, 1.5)
    const hostedZoneId = this.node.tryGetContext('hostedZoneId');

    if (!hostedZoneId) {
      throw new Error(
        'Missing required CDK context value "hostedZoneId". ' +
        'Provide the Route 53 hosted zone ID for awsteach.com via ' +
        '-c hostedZoneId=ZXXXXXXXXXX or in cdk.json context. ' +
        'A new hosted zone will NOT be created; the existing zone must be referenced by ID.'
      );
    }

    // Import existing hosted zone — do NOT create a new one (Req 1.4)
    this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: 'awsteach.com',
    });

    // Provision ACM certificate with DNS validation in us-east-1 (Req 1.1, 1.2)
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'nissan.awsteach.com',
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
      certificateName: 'vsi-nissan-awsteach-cert',
    });

    // Export certificate ARN as CloudFormation output
    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'ACM certificate ARN for nissan.awsteach.com',
      exportName: 'VsiCertificateArn',
    });
  }
}
