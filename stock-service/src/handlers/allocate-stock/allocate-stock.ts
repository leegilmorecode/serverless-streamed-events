import * as AWS from "aws-sdk";
import * as SubscriptionCreatedSchema from "@schemas/subscriptions/subscription-created/app.subscriptions@SubscriptionCreated-v1.json";

import { EventBridgeEvent, Handler } from "aws-lambda";

import { stockStatus } from "../../common";
import { v4 as uuid } from "uuid";
import { validate } from "@packages/validate";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// when a new customer subscription is created we allocate the stock
export const allocateStockHandler: Handler<EventBridgeEvent<any, any>> = async (
  event: EventBridgeEvent<any, any>
): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "allocate-stock.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const stockTable = process.env.TABLE_NAME as string;

    const { "detail-type": detailType, id, detail } = event;

    console.log(
      `${prefix} - validating the event against the SubscriptionCreated schema`
    );

    // validate the event against the event schema
    validate(
      detail,
      SubscriptionCreatedSchema,
      "SubscriptionCreated",
      "SubscriptionCreated#/components/schemas/SubscriptionCreated"
    );

    console.log(
      `${prefix} - result: detail: ${JSON.stringify(
        detail
      )}, detailType: ${detailType}, id: ${id}`
    );

    const stock = {
      id: detail.subscriptionId,
      accountNumber: detail.accountNumber,
      stock: 12, // set the stock allocated to 12
      stockId: "razor-123",
      status: stockStatus.allocated,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: stockTable,
      Item: stock,
    };

    console.log(`${prefix} - allocating stock: ${JSON.stringify(stock)}`);

    // create the subscription
    await dynamoDb.put(params).promise();
  } catch (error) {
    console.log(error);
    throw error;
  }
};
