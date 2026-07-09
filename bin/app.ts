#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VsiStack } from '../lib/stacks/vsi-stack';

const app = new cdk.App();

new VsiStack(app, 'VsiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Vehicle Service Intelligence — AI-powered diagnostic pipeline demo',
});

app.synth();
