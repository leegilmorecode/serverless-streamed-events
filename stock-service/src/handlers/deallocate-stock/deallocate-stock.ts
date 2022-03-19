import * as AWS from "aws-sdk";
import * as paymentCancelledSchema from "@schemas/payments/payment-cancelled/app.payments@PaymentCancelled-v1.json";

import { EventBridgeEvent, Handler } from "aws-lambda";

import { stockStatus } from "../../common";
import { v4 as uuid } from "uuid";
import { validate } from "@packages/validate";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// when we get a payment cancelled event we deallocate the stock
export const deallocateStockHandler: Handler<
  EventBridgeEvent<any, any>
> = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "deallocate-stock.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const stockTable = process.env.TABLE_NAME as string;

    const { "detail-type": detailType, detail } = event;

    // validate the event against the event schema
    validate(
      detail,
      paymentCancelledSchema,
      "PaymentCancelled",
      "PaymentCancelled#/components/schemas/PaymentCancelled"
    );

    console.log(
      `${prefix} - event detail: ${JSON.stringify(
        detail
      )}, detailType: ${detailType}, id: ${
        detail.subscriptionId
      }, table: ${stockTable}`
    );

    const params: AWS.DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: stockTable,
      Key: {
        id: detail.subscriptionId,
      },
      UpdateExpression:
        "set #status = :status, #updated=:updated, #stock=:stock",
      ExpressionAttributeValues: {
        ":status": stockStatus.cancelled,
        ":updated": new Date().toISOString(),
        ":stock": 0,
      },
      ExpressionAttributeNames: {
        "#status": "status",
        "#updated": "updated",
        "#stock": "stock",
      },
      ReturnValues: "UPDATED_NEW",
    };

    const result: AWS.DynamoDB.DocumentClient.UpdateItemOutput = await dynamoDb
      .update(params)
      .promise();

    console.log(
      `${prefix} - deallocating stock result: ${JSON.stringify(result)}`
    );
  } catch (error) {
    console.log(error);
    throw error;
  }
};
