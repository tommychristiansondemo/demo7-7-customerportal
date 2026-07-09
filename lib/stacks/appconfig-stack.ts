import * as cdk from 'aws-cdk-lib';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import { Construct } from 'constructs';

/**
 * AppConfigStack — Provisions AppConfig resources for adaptive model routing.
 *
 * Creates:
 *   - AppConfig Application (vsi-model-routing)
 *   - Environment (production)
 *   - Freeform JSON Configuration Profile (model-weights)
 *   - Hosted Configuration Version with default weights
 *   - Immediate deployment strategy (0-minute bake, all-at-once)
 *   - Initial deployment to production environment
 *
 * Lambda functions read configuration via the AppConfig Lambda Extension at:
 *   http://localhost:2772/applications/vsi-model-routing/environments/production/configurations/model-weights
 *
 * Validates: Requirements 11.1, 11.7
 */
export class AppConfigStack extends cdk.NestedStack {
  /** AppConfig Application ID */
  public readonly applicationId: string;
  /** AppConfig Environment ID */
  public readonly environmentId: string;
  /** AppConfig Configuration Profile ID */
  public readonly configurationProfileId: string;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // --- Application ---
    const application = new appconfig.CfnApplication(this, 'Application', {
      name: 'vsi-model-routing',
      description: 'Adaptive model routing weights for VSI pipeline agents',
    });

    // --- Environment ---
    const environment = new appconfig.CfnEnvironment(this, 'Environment', {
      applicationId: application.ref,
      name: 'production',
      description: 'Production environment for model routing configuration',
    });

    // --- Configuration Profile (Freeform JSON) ---
    const configProfile = new appconfig.CfnConfigurationProfile(this, 'ConfigProfile', {
      applicationId: application.ref,
      name: 'model-weights',
      locationUri: 'hosted',
      description: 'Cost/latency/quality priority weights for model selection',
    });

    // --- Hosted Configuration Version (default weights) ---
    const configVersion = new appconfig.CfnHostedConfigurationVersion(this, 'ConfigVersion', {
      applicationId: application.ref,
      configurationProfileId: configProfile.ref,
      contentType: 'application/json',
      content: JSON.stringify({
        cost_priority: 0.33,
        latency_priority: 0.33,
        quality_priority: 0.34,
      }),
      description: 'Default balanced weights (cost=0.33, latency=0.33, quality=0.34)',
    });

    // --- Deployment Strategy (Immediate: 0-minute bake, all-at-once) ---
    const deploymentStrategy = new appconfig.CfnDeploymentStrategy(this, 'ImmediateDeploymentStrategy', {
      name: 'vsi-immediate',
      deploymentDurationInMinutes: 0,
      finalBakeTimeInMinutes: 0,
      growthFactor: 100,
      growthType: 'LINEAR',
      replicateTo: 'NONE',
      description: 'Immediate deployment — all-at-once with 0-minute bake time',
    });

    // --- Initial Deployment ---
    const deployment = new appconfig.CfnDeployment(this, 'InitialDeployment', {
      applicationId: application.ref,
      environmentId: environment.ref,
      configurationProfileId: configProfile.ref,
      configurationVersion: configVersion.attrVersionNumber,
      deploymentStrategyId: deploymentStrategy.ref,
      description: 'Initial deployment of default model routing weights',
    });

    // Ensure deployment happens after all dependencies are created
    deployment.addDependency(configVersion);
    deployment.addDependency(deploymentStrategy);

    // --- Store IDs for cross-stack references ---
    this.applicationId = application.ref;
    this.environmentId = environment.ref;
    this.configurationProfileId = configProfile.ref;

    // --- CloudFormation Outputs ---
    new cdk.CfnOutput(this, 'AppConfigApplicationId', {
      value: application.ref,
      description: 'AppConfig Application ID for vsi-model-routing',
      exportName: 'VSI-AppConfig-ApplicationId',
    });

    new cdk.CfnOutput(this, 'AppConfigEnvironmentId', {
      value: environment.ref,
      description: 'AppConfig Environment ID for production',
      exportName: 'VSI-AppConfig-EnvironmentId',
    });

    new cdk.CfnOutput(this, 'AppConfigConfigurationProfileId', {
      value: configProfile.ref,
      description: 'AppConfig Configuration Profile ID for model-weights',
      exportName: 'VSI-AppConfig-ConfigurationProfileId',
    });
  }
}
