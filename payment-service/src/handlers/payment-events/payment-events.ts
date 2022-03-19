import * as AWS from "aws-sdk";

import { SQSEvent, SQSHandler } from "aws-lambda";

import { config } from "../../config";
import { v4 as uuid } from "uuid";

const eventBridge = new AWS.EventBridge();

// we pull the events of the payment queue and raise the relevant eventbridge events
export const paymentEventsHandler: SQSHandler = async ({
  Records,
}: SQSEvent): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "payment-events.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const eventBusName = config.paymentsEventBus;

    console.log(
      `${prefix} - ${Records.length} records to produce as events on ${eventBusName}`
    );

    // parse the records from the sqs message batch
    const events: AWS.EventBridge.PutEventsRequestEntryList = Records.map(
      (record) => {
        const item = record.body;
        const parseBody = JSON.parse(item);

        console.log(`${prefix} - item: ${item}`);

        return {
          Detail: item,
          DetailType: parseBody.event,
          EventBusName: eventBusName,
          Source: "app.payments",
        };
      }
    );

    const paymentsEvent: AWS.EventBridge.PutEventsRequest = {
      Entries: events,
    };

    // push the events to the payments event bus
    const result: AWS.EventBridge.PutEventsResponse = await eventBridge
      .putEvents(paymentsEvent)
      .promise();

    console.log(`${prefix} - result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
