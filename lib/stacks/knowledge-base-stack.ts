import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';

/**
 * KnowledgeBaseStack — Provisions the Bedrock Knowledge Base backed by
 * an S3 data source (synthetic TSB documents) and OpenSearch Serverless
 * vector store with Titan Embed Text v2 embeddings.
 *
 * Requirements: 7.1, 7.2
 */
export class KnowledgeBaseStack extends cdk.NestedStack {
  /** The S3 bucket holding synthetic TSB documents. */
  public readonly tsbBucket: s3.Bucket;

  /** The Bedrock Knowledge Base ID. */
  public readonly knowledgeBaseId: string;

  /** The Bedrock Knowledge Base ARN. */
  public readonly knowledgeBaseArn: string;

  /** Exported TSB bucket name output. */
  public readonly tsbBucketNameOutput: cdk.CfnOutput;

  /** Exported Knowledge Base ID output. */
  public readonly kbIdOutput: cdk.CfnOutput;

  /** Exported Knowledge Base ARN output. */
  public readonly kbArnOutput: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // --- S3 Bucket for TSB documents ---
    this.tsbBucket = new s3.Bucket(this, 'TsbDocumentsBucket', {
      bucketName: `vsi-tsb-documents-${accountId}-${region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // --- OpenSearch Serverless Collection (vector store) ---
    const collectionName = 'vsi-kb-vectors';

    // Encryption policy (required before collection creation)
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: 'vsi-kb-encryption',
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
          },
        ],
        AWSOwnedKey: true,
      }),
    });

    // Network policy (allow public access for Bedrock service integration)
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: 'vsi-kb-network',
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${collectionName}`],
            },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    // OpenSearch Serverless collection
    const collection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: 'Vector store for VSI Bedrock Knowledge Base',
    });

    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);

    // --- IAM Role for Bedrock Knowledge Base ---
    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': accountId,
          },
        },
      }),
      description: 'Execution role for VSI Bedrock Knowledge Base',
    });

    // Grant KB role access to S3 TSB bucket
    this.tsbBucket.grantRead(kbRole);

    // Grant KB role access to OpenSearch Serverless collection
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['aoss:APIAccessAll'],
      resources: [
        `arn:aws:aoss:${region}:${accountId}:collection/${collection.attrId}`,
      ],
    }));

    // Grant KB role access to the embedding model
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    // Data access policy for OpenSearch Serverless (grants KB role index/document access)
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: 'vsi-kb-data-access',
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems',
              ],
            },
          ],
          Principal: [kbRole.roleArn],
        },
      ]),
    });

    dataAccessPolicy.node.addDependency(collection);

    // --- Bedrock Knowledge Base (L1 construct) ---
    const knowledgeBase = new cdk.CfnResource(this, 'KnowledgeBase', {
      type: 'AWS::Bedrock::KnowledgeBase',
      properties: {
        Name: 'vsi-diagnostic-kb',
        Description: 'Knowledge Base for vehicle diagnostic TSB documents',
        RoleArn: kbRole.roleArn,
        KnowledgeBaseConfiguration: {
          Type: 'VECTOR',
          VectorKnowledgeBaseConfiguration: {
            EmbeddingModelArn: `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
          },
        },
        StorageConfiguration: {
          Type: 'OPENSEARCH_SERVERLESS',
          OpensearchServerlessConfiguration: {
            CollectionArn: collection.attrArn,
            VectorIndexName: 'vsi-tsb-index',
            FieldMapping: {
              VectorField: 'embedding',
              TextField: 'text',
              MetadataField: 'metadata',
            },
          },
        },
      },
    });

    knowledgeBase.node.addDependency(collection);
    knowledgeBase.node.addDependency(dataAccessPolicy);

    this.knowledgeBaseId = knowledgeBase.getAtt('KnowledgeBaseId').toString();
    this.knowledgeBaseArn = knowledgeBase.getAtt('KnowledgeBaseArn').toString();

    // --- S3 Data Source for the Knowledge Base ---
    const dataSource = new cdk.CfnResource(this, 'KnowledgeBaseDataSource', {
      type: 'AWS::Bedrock::DataSource',
      properties: {
        KnowledgeBaseId: this.knowledgeBaseId,
        Name: 'vsi-tsb-documents',
        Description: 'Synthetic TSB documents stored in S3',
        DataSourceConfiguration: {
          Type: 'S3',
          S3Configuration: {
            BucketArn: this.tsbBucket.bucketArn,
          },
        },
        VectorIngestionConfiguration: {
          ChunkingConfiguration: {
            ChunkingStrategy: 'FIXED_SIZE',
            FixedSizeChunkingConfiguration: {
              MaxTokens: 300,
              OverlapPercentage: 20,
            },
          },
        },
      },
    });

    dataSource.node.addDependency(knowledgeBase);

    // --- CloudFormation Outputs ---
    this.tsbBucketNameOutput = new cdk.CfnOutput(this, 'TsbBucketName', {
      value: this.tsbBucket.bucketName,
      description: 'S3 bucket name for TSB documents',
      exportName: 'VsiTsbBucketName',
    });

    this.kbIdOutput = new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
      exportName: 'VsiKnowledgeBaseId',
    });

    this.kbArnOutput = new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: this.knowledgeBaseArn,
      description: 'Bedrock Knowledge Base ARN',
      exportName: 'VsiKnowledgeBaseArn',
    });
  }
}
