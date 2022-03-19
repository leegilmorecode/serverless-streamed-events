import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as targets from "aws-cdk-lib/aws-events-targets";

import {
  DynamoEventSource,
  SqsDlq,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import path from "path";

export class SubscriptionServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // NOTE: get reference to the bus's - we would use fromEventBusArn when cross AWS account and use a policy between the two
    const subscriptionsEventBus: events.IEventBus =
      events.EventBus.fromEventBusName(
        this,
        "subscriptions-event-bus",
        "subscriptions-event-bus"
      );
    const stockEventBus: events.IEventBus = events.EventBus.fromEventBusName(
      this,
      "stock-event-bus",
      "stock-event-bus"
    );
    const paymentsEventBus: events.IEventBus = events.EventBus.fromEventBusName(
      this,
      "payments-event-bus",
      "payments-event-bus"
    );

    // create the dynamodb table for subscriptions
    const subscriptionsTable: dynamodb.Table = new dynamodb.Table(
      this,
      "subscriptions-table",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: "subscriptions-table",
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: "id",
          type: dynamodb.AttributeType.STRING,
        },
        stream: StreamViewType.NEW_IMAGE, // get the new image so we cab raise events on the changes
      }
    );

    // create the 'create-subscription' lambda
    const createSubscriptionHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "create-subscription-handler", {
        functionName: "create-subscription-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/handlers/create-subscription/create-subscription.ts"
        ),
        memorySize: 1024,
        handler: "createSubscriptionHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          TABLE_NAME: subscriptionsTable.tableName,
        },
      });

    // allow the crete subscriptions handler to write to the database
    subscriptionsTable.grantWriteData(createSubscriptionHandler);

    // create the 'subscriptions-events' lambda
    const subscriptionsEventsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "subscriptions-events-handler", {
        functionName: "subscriptions-events-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/streams/subscription-events/subscription-events.ts"
        ),
        memorySize: 1024,
        handler: "subscriptionsEventHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          SUBSCRIPTIONS_EVENT_BUS: subscriptionsEventBus.eventBusName,
        },
      });

    // give the subscriptions events stream handler access to put events onto the bus
    subscriptionsEventBus.grantPutEventsTo(subscriptionsEventsHandler);

    // create the 'cancel-subscription' lambda
    const cancelSubscriptionHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "cancel-subscription-handler", {
        functionName: "cancel-subscription-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/handlers/cancel-subscription/cancel-subscription.ts"
        ),
        memorySize: 1024,
        handler: "cancelSubscriptionHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          TABLE_NAME: subscriptionsTable.tableName,
        },
      });

    // allow the cancel subscription lambda to write to the database
    subscriptionsTable.grantWriteData(cancelSubscriptionHandler);

    // create a dead letter queue for the stream
    const deadLetterQueue = new sqs.Queue(this, "subscriptions-dlq", {
      removalPolicy: RemovalPolicy.DESTROY,
      queueName: "subscriptions-dlq",
    });

    // add the dynamodb streams to invoke the lambda to produce events on eventbridge
    subscriptionsEventsHandler.addEventSource(
      new DynamoEventSource(subscriptionsTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(deadLetterQueue),
        retryAttempts: 10,
      })
    );

    // create the rest API for creating subscriptions
    const subscriptionsApi: apigw.RestApi = new apigw.RestApi(
      this,
      "subscriptions-api",
      {
        description: "subscriptions api gateway",
        deploy: true,
        deployOptions: {
          stageName: "prod",
          dataTraceEnabled: true,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: true,
          metricsEnabled: true,
        },
      }
    );

    // add a /subscriptions resource
    const subscriptions: apigw.Resource =
      subscriptionsApi.root.addResource("subscriptions");

    // integrate the lambda to the method - POST /subscriptions (create subscriptions)
    subscriptions.addMethod(
      "POST",
      new apigw.LambdaIntegration(createSubscriptionHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // write all of the subscriptions events to logs so we can track
    const subscriptionsEventBusLog: logs.LogGroup = new logs.LogGroup(
      this,
      "subscriptions-event-logs",
      {
        logGroupName: "subscriptions-event-logs",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch
    new events.Rule(this, "LogAllSubscriptionEventsToCloudwatch", {
      eventBus: subscriptionsEventBus,
      ruleName: "LogAllSubscriptionEventsToCloudwatch",
      description: "log all subscription events to cloudwatch",
      eventPattern: {
        source: ["app.subscriptions"],
      },
      targets: [new targets.CloudWatchLogGroup(subscriptionsEventBusLog)],
    });

    // create a dead letter queue for the cancel subscription event rule
    const cancelSubscriptionDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "cancel-subscription-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "cancel-subscription-dlq",
      }
    );

    // cancel subscription when payment is cancelled
    new events.Rule(this, "SubscriptionCancelledRule", {
      eventBus: subscriptionsEventBus,
      ruleName: "SubscriptionCancelledRule",
      description: "cancel subscription if payment is cancelled",
      eventPattern: {
        source: ["app.payments"],
        detailType: ["PaymentCancelled"],
      },
      targets: [
        new targets.LambdaFunction(cancelSubscriptionHandler, {
          deadLetterQueue: cancelSubscriptionDeadLetterQueue,
        }),
      ],
    });

    // create a dead letter queue for the sub bus to stock bus event rule
    const subToStockDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "subscriptions-to-stock-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "subscriptions-to-stock-dlq",
      }
    );

    // create a dead letter queue for the sub bus to payments bus event rule
    const subToPaymentsDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "subscriptions-to-payments-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "subscriptions-to-payments-dlq",
      }
    );

    // mimic separate AWS accounts here which means subscriptions bus --> stock bus
    new events.Rule(this, `SubscriptionToStockRule`, {
      eventBus: subscriptionsEventBus,
      ruleName: "SubscriptionToStockRule",
      description: "subscriptions -> stock bus rule",
      eventPattern: {
        source: ["app.subscriptions"],
        detailType: ["SubscriptionCreated"],
      },
      targets: [
        new targets.EventBus(stockEventBus, {
          deadLetterQueue: subToStockDeadLetterQueue,
        }),
      ],
    });

    // mimic separate AWS accounts here which means subscriptions bus --> payments bus
    new events.Rule(this, `SubscriptionToPaymentsRule`, {
      eventBus: subscriptionsEventBus,
      ruleName: "SubscriptionToPaymentsRule",
      description: "subscriptions -> payments bus rule",
      eventPattern: {
        source: ["app.subscriptions"],
        detailType: ["SubscriptionCreated"],
      },
      targets: [
        new targets.EventBus(paymentsEventBus, {
          deadLetterQueue: subToPaymentsDeadLetterQueue,
        }),
      ],
    });
  }
}
