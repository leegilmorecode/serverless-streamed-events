import * as AWS from "aws-sdk";

import { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda";

import { config } from "../../config";
import { v4 as uuid } from "uuid";

const eventBridge = new AWS.EventBridge();

export const subscriptionsEventHandler: DynamoDBStreamHandler =
  async ({}: DynamoDBStreamEvent): Promise<void> => {
    try {
      const correlationId = uuid();
      const method = "subscriptions-events.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      const eventBusName = config.subscriptionsEventBus;

      const Records: any = [
        {
          accountNumber: "x1",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x2",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x3",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x4",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x5",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x6",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x7",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x8",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x9",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
        {
          accountNumber: "x10",
          accountName: "Bob Jamison",
          accountSortCode: "12-12-34",
          customerFirstName: "Lee",
          customerSurname: "Gilmore",
          id: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          subscriptionId: "cc8058e3-a3b9-4ad4-83ac-2178f0510edb",
          event: "SubscriptionCreated",
          status: "active",
          updated: "2022-08-04T18:29:47.213Z",
        },
      ];

      console.log(
        `${prefix} - ${Records.length} records to produce as events on ${eventBusName}`
      );

      // parse the records from the stream
      const events: AWS.EventBridge.PutEventsRequestEntryList = Records.map(
        (record: any) => {
          // if (!record.dynamodb?.NewImage) return {};

          // const item = AWS.DynamoDB.Converter.unmarshall(
          //   record.dynamodb?.NewImage
          // );

          // console.log(`${prefix} - item: ${JSON.stringify(item)}`);

          return {
            Detail: JSON.stringify(record),
            DetailType: "SubscriptionCreated",
            EventBusName: eventBusName,
            Source: "app.subscriptions",
          };
        }
      ).filter((item: any) => item !== {});

      // push the events to the subscriptions event bus
      const subscriptionEvent: AWS.EventBridge.PutEventsRequest = {
        Entries: events,
      };

      console.log(`putEvent entry --> ${JSON.stringify(subscriptionEvent)}`);

      const result: AWS.EventBridge.PutEventsResponse = await eventBridge
        .putEvents(subscriptionEvent)
        .promise();

      console.log(`${prefix} - result: ${JSON.stringify(result)}`);
    } catch (error) {
      console.log(error);
      throw error;
    }
  };
