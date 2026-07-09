import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DnsCertificateStack } from '../../lib/stacks/dns-certificate-stack';

describe('DnsCertificateStack', () => {
  it('provisions ACM certificate for nissan.awsteach.com with DNS validation', () => {
    const app = new cdk.App({
      context: { hostedZoneId: 'Z0123456789ABCDEFGHIJ' },
    });
    const parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const nested = new DnsCertificateStack(parentStack, 'DnsCertStack');

    const template = Template.fromStack(nested);

    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'nissan.awsteach.com',
      ValidationMethod: 'DNS',
    });
  });

  it('exports certificate ARN as CloudFormation output', () => {
    const app = new cdk.App({
      context: { hostedZoneId: 'Z0123456789ABCDEFGHIJ' },
    });
    const parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const nested = new DnsCertificateStack(parentStack, 'DnsCertStack');

    const template = Template.fromStack(nested);

    template.hasOutput('CertificateArn', {
      Export: { Name: 'VsiCertificateArn' },
    });
  });

  it('throws descriptive error when hostedZoneId context is missing', () => {
    const app = new cdk.App({ context: {} });
    const parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    expect(() => {
      new DnsCertificateStack(parentStack, 'DnsCertStack');
    }).toThrow(/Missing required CDK context value "hostedZoneId"/);
  });

  it('does not create a new hosted zone', () => {
    const app = new cdk.App({
      context: { hostedZoneId: 'Z0123456789ABCDEFGHIJ' },
    });
    const parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const nested = new DnsCertificateStack(parentStack, 'DnsCertStack');

    const template = Template.fromStack(nested);

    // Req 1.4: SHALL NOT create a new hosted zone
    expect(template.findResources('AWS::Route53::HostedZone')).toEqual({});
  });

  it('exposes certificate and hostedZone properties', () => {
    const app = new cdk.App({
      context: { hostedZoneId: 'Z0123456789ABCDEFGHIJ' },
    });
    const parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const nested = new DnsCertificateStack(parentStack, 'DnsCertStack');

    expect(nested.certificate).toBeDefined();
    expect(nested.hostedZone).toBeDefined();
    expect(nested.hostedZone.hostedZoneId).toBe('Z0123456789ABCDEFGHIJ');
  });
});
