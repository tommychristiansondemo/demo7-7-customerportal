import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../../lib/stacks/data-stack';

describe('DataStack', () => {
  let template: Template;
  let dataStack: DataStack;

  beforeAll(() => {
    const app = new cdk.App();
    const parentStack = new cdk.Stack(app, 'TestParentStack');
    dataStack = new DataStack(parentStack, 'DataStack');
    // For nested stacks, we need to get the template from the nested stack itself
    template = Template.fromStack(dataStack);
  });

  it('creates DynamoDB table with part_number partition key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        {
          AttributeName: 'part_number',
          KeyType: 'HASH',
        },
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'part_number',
          AttributeType: 'S',
        },
      ],
    });
  });

  it('sets DynamoDB table to PAY_PER_REQUEST billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('sets DynamoDB table removal policy to DESTROY', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  it('creates a seed Lambda function with TABLE_NAME environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('creates a custom resource for seeding data', () => {
    template.hasResource('AWS::CloudFormation::CustomResource', {
      Properties: Match.objectLike({
        version: '1.0.0',
      }),
    });
  });

  it('exports table name and ARN', () => {
    template.hasOutput('*', {
      Export: {
        Name: 'VsiPartsTableName',
      },
    });
    template.hasOutput('*', {
      Export: {
        Name: 'VsiPartsTableArn',
      },
    });
  });
});
