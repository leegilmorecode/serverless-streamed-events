import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as docdb from "aws-cdk-lib/aws-docdb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as targets from "aws-cdk-lib/aws-events-targets";

import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

import path = require("path");

export class PaymentServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // create the vpc for the ecs and documentdb clusters
    const vpc: ec2.Vpc = new ec2.Vpc(this, "payment-service-vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "private-subnet",
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 24,
          name: "public-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // NOTE: get references to various bus's
    const paymentsEventBus = events.EventBus.fromEventBusName(
      this,
      "payments-event-bus",
      "payments-event-bus"
    );
    const stockEventBus = events.EventBus.fromEventBusName(
      this,
      "stock-event-bus",
      "stock-event-bus"
    );
    const subscriptionsEventBus = events.EventBus.fromEventBusName(
      this,
      "subscriptions-event-bus",
      "subscriptions-event-bus"
    );

    // create a dead letter queue for the payments bus -> stock bus event rule
    const paymentsToStockDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "payments-to-stock-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "payments-to-stock-dlq",
      }
    );

    // create a dead letter queue for the payments bus -> subscriptions bus event rule
    const paymentsToSubscriptionsDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "payments-to-subscriptions-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "payments-to-subscriptions-dlq",
      }
    );

    // mimic separate AWS accounts here which means payments bus --> stock bus
    new events.Rule(this, `PaymentsToStockRule`, {
      eventBus: paymentsEventBus,
      ruleName: "PaymentsToStockRule",
      description: "payments -> stock bus rule",
      eventPattern: {
        source: ["app.payments"],
        detailType: ["PaymentCancelled"],
      },
      targets: [
        new targets.EventBus(stockEventBus, {
          deadLetterQueue: paymentsToStockDeadLetterQueue,
        }),
      ],
    });

    // mimic separate AWS accounts here which means payments bus --> stock bus
    new events.Rule(this, `PaymentsToSubscriptionsRule`, {
      eventBus: paymentsEventBus,
      ruleName: "PaymentsToSubscriptionsRule",
      description: "payments -> subscriptions bus rule",
      eventPattern: {
        source: ["app.payments"],
        detailType: ["PaymentCancelled"],
      },
      targets: [
        new targets.EventBus(subscriptionsEventBus, {
          deadLetterQueue: paymentsToSubscriptionsDeadLetterQueue,
        }),
      ],
    });

    // write all of the events to logs so we can track
    const paymentsEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      "payments-event-logs",
      {
        logGroupName: "payments-event-logs",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // log all events to cloudwatch
    new events.Rule(this, "LogAllEventsToCloudwatch", {
      eventBus: paymentsEventBus,
      ruleName: "LogAllEventsToCloudwatch",
      description: "log all stock events",
      eventPattern: {
        source: ["app.subscriptions", "app.stock", "app.payments"],
      },
      targets: [new targets.CloudWatchLogGroup(paymentsEventLogs)],
    });

    // create the documentdb cluster i.e. payments database
    const docDbCluster: docdb.DatabaseCluster = new docdb.DatabaseCluster(
      this,
      "DocdbCluster",
      {
        masterUser: {
          username: "adminuser",
          secretName: "/payments-service/docdb/masterpassword",
          excludeCharacters: "'\"@/:`$<>#|%{}[]!?^\\.~*()",
        },
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MEDIUM
        ),
        dbClusterName: "docdb-payments-cluster",
        deletionProtection: false,
        removalPolicy: RemovalPolicy.DESTROY,
        storageEncrypted: true,
        engineVersion: "4.0.0",
        instances: 1,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        vpc,
      }
    );

    // get the generated secrets to pass to the fargate container tasks and lambda for ease of demo
    // (should use secrets manager in code but this is for the demo only)
    const username = docDbCluster.secret
      ?.secretValueFromJson("username")
      .toString() as string;

    const password = docDbCluster.secret
      ?.secretValueFromJson("password")
      .toString() as string;

    // create the dlq for failed payment events
    const paymentEventsDLQ: sqs.Queue = new sqs.Queue(
      this,
      "payment-events-dlq.fifo",
      {
        fifo: true,
        queueName: "payment-events-dlq.fifo",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // create the fifo queue for the payment events to go onto
    const paymentEventsFifoQueue: sqs.Queue = new sqs.Queue(
      this,
      "payment-events.fifo",
      {
        fifo: true,
        queueName: "payment-events.fifo",
        deduplicationScope: sqs.DeduplicationScope.QUEUE,
        removalPolicy: RemovalPolicy.DESTROY,
        deadLetterQueue: {
          queue: paymentEventsDLQ,
          maxReceiveCount: 3,
        },
      }
    );

    // create the 'payments-events' lambda for the sqs queue
    const paymentEventsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "payment-events-handler", {
        functionName: "payment-events-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/handlers/payment-events/payment-events.ts"
        ),
        memorySize: 1024,
        handler: "paymentEventsHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          PAYMENTS_EVENT_BUS: paymentsEventBus.eventBusName,
        },
      });

    // add the lambda event source for the payment fifo queue
    paymentEventsHandler.addEventSource(
      new SqsEventSource(paymentEventsFifoQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      })
    );

    // allow the lambda to read from the queue and write to the payments event bus
    paymentEventsFifoQueue.grantConsumeMessages(paymentEventsHandler);
    paymentsEventBus.grantPutEventsTo(paymentEventsHandler);

    // create the environment variables for both ecs tasks and lambdas
    const environment = {
      SERVICE_NAME: "docdb-caching-service",
      SERVER_PORT: "80",
      MONGO_DB: "test",
      MONGO_SERVER: docDbCluster.clusterEndpoint.hostname,
      MONGO_PORT: docDbCluster.clusterEndpoint.portAsString(),
      MONGO_USERNAME: username,
      MONGO_PASSWORD: password,
      MONGO_COLLECTION: "payments",
    };

    // create a lambda layer containing the pem file for lambdas to connect to docdb
    const docdbPemFileLayer: lambda.LayerVersion = new lambda.LayerVersion(
      this,
      "doc-db-pem-file-layer",
      {
        compatibleRuntimes: [lambda.Runtime.NODEJS_14_X],
        code: lambda.Code.fromAsset("src/layer/rds-combined-ca-bundle.pem.zip"),
        description: "documentdb pem file layer",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // create the payment subscription when a new subscription is created
    const createPaymentSubscriptionHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(
        this,
        "create-payment-subscription-handler",
        {
          functionName: "create-payment-subscription-handler",
          runtime: lambda.Runtime.NODEJS_14_X,
          entry: path.join(
            __dirname,
            "/../src/handlers/create-payment-subscription/create-payment-subscription.ts"
          ),
          memorySize: 1024,
          handler: "createPaymentSubscriptionHandler",
          layers: [docdbPemFileLayer],
          bundling: {
            minify: true,
            externalModules: ["aws-sdk"],
          },
          vpc: vpc,
          vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          },
          environment: {
            ...environment,
            PAYMENTS_EVENT_BUS: paymentsEventBus.eventBusName,
          },
        }
      );

    // create a dead letter queue for the create payment sub lambda
    const createPaymentSubDeadLetterQueue: sqs.Queue = new sqs.Queue(
      this,
      "create-payment-subscription-dlq",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        queueName: "create-payment-subscription-dlq",
      }
    );

    // payments event bus rule that listens to the 'SubscriptionCreated' event
    new events.Rule(this, `SubscriptionCreatedRule`, {
      eventBus: paymentsEventBus,
      ruleName: "SubscriptionCreatedRule",
      description: "When the subscription is created we create a payment",
      eventPattern: {
        source: ["app.subscriptions"],
        detailType: ["SubscriptionCreated"],
      },
      targets: [
        new targets.LambdaFunction(createPaymentSubscriptionHandler, {
          deadLetterQueue: createPaymentSubDeadLetterQueue,
        }),
      ],
    });

    // create the 'cancel-payment' lambda for the api
    const cancelPaymentHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "cancel-payment-handler", {
        functionName: "cancel-payment-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        layers: [docdbPemFileLayer],
        entry: path.join(
          __dirname,
          "/../src/handlers/cancel-payment/cancel-payment.ts"
        ),
        memorySize: 1024,
        handler: "cancelPaymentHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          ...environment,
        },
      });

    // create the rest API for payments
    const paymentsApi: apigw.RestApi = new apigw.RestApi(this, "payments-api", {
      description: "payments api gateway",
      deploy: true,
      deployOptions: {
        stageName: "prod",
        dataTraceEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: true,
        metricsEnabled: true,
      },
    });

    // add a /payments resource
    const payments: apigw.Resource = paymentsApi.root.addResource("payments");

    const payment = payments.addResource("{id}");

    // integrate the lambda to the method - PATCH /payments/{id} (i.e. cancel payment)
    payment.addMethod(
      "PATCH",
      new apigw.LambdaIntegration(cancelPaymentHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    const cluster: ecs.Cluster = new ecs.Cluster(
      this,
      "payment-service-cluster",
      {
        vpc: vpc,
        clusterName: "payment-service-cluster",
        containerInsights: true,
      }
    );

    const loadBalancedFargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "payment-stream-service",
        {
          cluster: cluster,
          serviceName: "payment-stream-service",
          cpu: 256,
          desiredCount: 1,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../src/stream/")
            ),
            environment: {
              ...environment,
              PAYMENTS_EVENTS_QUEUE: paymentEventsFifoQueue.queueUrl,
            },
          },
          memoryLimitMiB: 512,
          publicLoadBalancer: false,
        }
      );

    loadBalancedFargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 1,
    });

    // allow the ecs tasks to send messages to the sqs queue for payments
    loadBalancedFargateService.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        effect: iam.Effect.ALLOW,
        resources: [paymentEventsFifoQueue.queueArn],
      })
    );

    // allow inbound connections from ecs service to the database cluster
    docDbCluster.connections.allowFrom(
      loadBalancedFargateService.service,
      ec2.Port.tcp(27017),
      "allow inbound from ecs only"
    );

    // allow inbound connections from lambda to the database cluster
    docDbCluster.connections.allowFrom(
      cancelPaymentHandler,
      ec2.Port.tcp(27017),
      "allow inbound from lambda only"
    );

    // allow inbound connections from lambda to the database cluster
    docDbCluster.connections.allowFrom(
      createPaymentSubscriptionHandler,
      ec2.Port.tcp(27017),
      "allow inbound from lambda only"
    );
  }
}
