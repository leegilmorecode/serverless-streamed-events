import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as targets from "aws-cdk-lib/aws-events-targets";

import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";
import path from "path";

export class StockServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // NOTE: get reference to the stock internal bus - we would use fromEventBusArn when cross AWS account
    // and use a policy between the two
    const stockEventBus: events.IEventBus = events.EventBus.fromEventBusName(
      this,
      "stock-event-bus",
      "stock-event-bus"
    );

    // create the dynamodb table for stock (allocating and de-allocating)
    const stockTable: dynamodb.Table = new dynamodb.Table(this, "stock-table", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false,
      tableName: "stock-table",
      contributorInsightsEnabled: true,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // create the 'allocate-stock' lambda
    const allocateStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "allocate-stock-handler", {
        functionName: "allocate-stock-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/handlers/allocate-stock/allocate-stock.ts"
        ),
        memorySize: 1024,
        handler: "allocateStockHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          TABLE_NAME: stockTable.tableName,
          STOCK_EVENT_BUS: stockEventBus.eventBusName,
        },
      });

    // create the 'deallocate-stock' lambda
    const deallocateStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "deallocate-stock-handler", {
        functionName: "deallocate-stock-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/handlers/deallocate-stock/deallocate-stock.ts"
        ),
        memorySize: 1024,
        handler: "deallocateStockHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          TABLE_NAME: stockTable.tableName,
          STOCK_EVENT_BUS: stockEventBus.eventBusName,
        },
      });

    // allow the allocate and deallocate stock lambdas to write to dynamodb
    stockTable.grantReadWriteData(allocateStockHandler);
    stockTable.grantReadWriteData(deallocateStockHandler);

    // create a dead letter queue for the allocate lambda
    const subCreatedDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "subscriptions-created-dlq",
      {
        queueName: "subscriptions-created-dlq",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // create a dead letter queue for the deallocate lambda
    const paymentCancelledDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "payment-cancelled-dlq",
      {
        queueName: "payment-cancelled-dlq",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // stock event bus rule that listens to the 'PaymentCancelled' event
    new events.Rule(this, `PaymentCancelledRule`, {
      eventBus: stockEventBus,
      ruleName: "PaymentCancelledRule",
      description: "When the payment is cancelled we deallocate stock",
      eventPattern: {
        source: ["app.payments"],
        detailType: ["PaymentCancelled"],
      },
      targets: [
        new targets.LambdaFunction(deallocateStockHandler, {
          deadLetterQueue: paymentCancelledDeadLetterQueue,
        }),
      ],
    });

    // stock event bus rule that listens to the 'SubscriptionCreated' event
    new events.Rule(this, `SubscriptionCreatedRule`, {
      eventBus: stockEventBus,
      ruleName: "SubscriptionCreatedRule",
      description: "When the subscription is created we allocate stock",
      eventPattern: {
        source: ["app.subscriptions"],
        detailType: ["SubscriptionCreated"],
      },
      targets: [
        new targets.LambdaFunction(allocateStockHandler, {
          deadLetterQueue: subCreatedDeadLetterQueue,
        }),
      ],
    });

    // write all of the events to logs so we can track
    const stockEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      "stock-event-logs",
      {
        logGroupName: "stock-event-logs",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch
    new events.Rule(this, "LogAllEventsToCloudwatch", {
      eventBus: stockEventBus,
      ruleName: "LogAllEventsToCloudwatch",
      description: "log all stock events",
      eventPattern: {
        source: ["app.subscriptions", "app.stock", "app.payments"],
      },
      targets: [new targets.CloudWatchLogGroup(stockEventLogs)],
    });
  }
}
