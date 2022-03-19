import * as AWS from "aws-sdk";

import { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda";

import { config } from "../../config";
import { v4 as uuid } from "uuid";

const eventBridge = new AWS.EventBridge();

export const subscriptionsEventHandler: DynamoDBStreamHandler = async ({
  Records,
}: DynamoDBStreamEvent): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "subscriptions-events.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const eventBusName = config.subscriptionsEventBus;

    console.log(
      `${prefix} - ${Records.length} records to produce as events on ${eventBusName}`
    );

    // parse the records from the stream
    const events: AWS.EventBridge.PutEventsRequestEntryList = Records.map(
      (record) => {
        if (!record.dynamodb?.NewImage) return {};

        const item = AWS.DynamoDB.Converter.unmarshall(
          record.dynamodb?.NewImage
        );

        console.log(`${prefix} - item: ${JSON.stringify(item)}`);

        return {
          Detail: JSON.stringify(item),
          DetailType: item.event,
          EventBusName: eventBusName,
          Source: "app.subscriptions",
        };
      }
    ).filter((item) => item !== {});

    // push the events to the subscriptions event bus
    const subscriptionEvent: AWS.EventBridge.PutEventsRequest = {
      Entries: events,
    };
    const result: AWS.EventBridge.PutEventsResponse = await eventBridge
      .putEvents(subscriptionEvent)
      .promise();

    console.log(`${prefix} - result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
