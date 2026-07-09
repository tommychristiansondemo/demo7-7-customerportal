import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/**
 * Props for StaticHostingStack.
 * Receives certificate and hosted zone from DnsCertificateStack.
 */
export interface StaticHostingStackProps extends cdk.NestedStackProps {
  certificate: acm.ICertificate;
  hostedZone: route53.IHostedZone;
}

/**
 * StaticHostingStack — S3 + CloudFront + OAC for Portal SPA hosting.
 *
 * - S3 bucket with all public access blocked (Req 2.1, 15.3)
 * - CloudFront distribution with OAC (no public bucket policy) (Req 2.2, 15.6)
 * - HTTP → HTTPS redirect (Req 2.3)
 * - index.html as default root object (Req 2.4)
 * - Custom error response for 403/404 → index.html with 200 (SPA routing) (Req 2.5)
 * - ACM certificate attached (Req 2.6)
 * - nissan.awsteach.com as CNAME (Req 2.7)
 * - Route 53 A-record alias pointing to CloudFront (Req 1.3)
 * - autoDeleteObjects + removalPolicy DESTROY (Req 16.5)
 */
export class StaticHostingStack extends cdk.NestedStack {
  /** The CloudFront distribution URL */
  public readonly distributionUrl: string;
  /** The S3 bucket name for Portal assets */
  public readonly bucketName: string;

  constructor(scope: Construct, id: string, props: StaticHostingStackProps) {
    super(scope, id, props);

    // S3 bucket for Portal static assets (Req 2.1, 15.3, 16.5)
    const siteBucket = new s3.Bucket(this, 'PortalBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront distribution with S3BucketOrigin (auto-creates OAC) (Req 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 15.6)
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      certificate: props.certificate,
      domainNames: ['nissan.awsteach.com'],
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Route 53 A-record alias pointing to CloudFront (Req 1.3)
    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: props.hostedZone,
      recordName: 'nissan.awsteach.com',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    // Store distribution URL and bucket name for export
    this.distributionUrl = `https://${distribution.distributionDomainName}`;
    this.bucketName = siteBucket.bucketName;

    // Export CloudFront distribution URL (Req 16.2)
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: this.distributionUrl,
      description: 'CloudFront distribution URL for the Portal',
      exportName: 'VsiDistributionUrl',
    });

    // Export S3 bucket name
    new cdk.CfnOutput(this, 'PortalBucketName', {
      value: siteBucket.bucketName,
      description: 'S3 bucket name for Portal static assets',
      exportName: 'VsiPortalBucketName',
    });
  }
}
