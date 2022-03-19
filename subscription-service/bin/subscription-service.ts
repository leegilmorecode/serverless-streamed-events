#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { SubscriptionServiceStack } from "../lib/subscription-service-stack";

const app = new cdk.App();
new SubscriptionServiceStack(app, "SubscriptionServiceStack", {});
