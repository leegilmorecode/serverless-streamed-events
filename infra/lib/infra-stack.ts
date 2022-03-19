import * as events from "aws-cdk-lib/aws-events";

import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";

import { Construct } from "constructs";

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // create the subscriptions event bus and archive
    const subscriptionsEventBus: events.EventBus = new events.EventBus(
      this,
      "subscriptions-event-bus",
      {
        eventBusName: "subscriptions-event-bus",
      }
    );
    subscriptionsEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    subscriptionsEventBus.archive("subscriptions-bus-archive", {
      archiveName: "subscriptions-bus-archive",
      description: "Subscriptions Bus Archive",
      eventPattern: {
        detailType: ["SubscriptionCreated", "SubscriptionCancelled"],
        account: [Stack.of(this).account],
      },
      retention: Duration.days(20),
    });

    // create the stock event bus and archive
    const stockEventBus: events.EventBus = new events.EventBus(
      this,
      "stock-event-bus",
      {
        eventBusName: "stock-event-bus",
      }
    );

    stockEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    stockEventBus.archive("stock-bus-archive", {
      archiveName: "stock-bus-archive",
      description: "Stock Bus Archive",
      eventPattern: {
        detailType: ["StockAllocated", "StockDeallocated"],
        account: [Stack.of(this).account],
      },
      retention: Duration.days(20),
    });

    // create the payments event bus and archive
    const paymentsEventBus: events.EventBus = new events.EventBus(
      this,
      "payments-event-bus",
      {
        eventBusName: "payments-event-bus",
      }
    );

    paymentsEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);
    paymentsEventBus.archive("payments-bus-archive", {
      archiveName: "payments-bus-archive",
      description: "Payments Bus Archive",
      eventPattern: {
        detailType: ["PaymentCancelled", "PaymentSetup"],
        account: [Stack.of(this).account],
      },
      retention: Duration.days(365),
    });
  }
}
