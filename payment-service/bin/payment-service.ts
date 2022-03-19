#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { PaymentServiceStack } from "../lib/payment-service-stack";

const app = new cdk.App();
new PaymentServiceStack(app, "PaymentServiceStack", {});
