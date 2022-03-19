import * as AWS from "aws-sdk";
import * as paymentCancelledSchema from "@schemas/payments/payment-cancelled/app.payments@PaymentCancelled-v1.json";

import { EventBridgeEvent, Handler } from "aws-lambda";
import { subscriptionEvents, subscriptionStatus } from "../../common";

import { config } from "../../config";
import { v4 as uuid } from "uuid";
import { validate } from "@packages/validate";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const cancelSubscriptionHandler: Handler<
  EventBridgeEvent<any, any>
> = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "cancel-subscription.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { "detail-type": detailType, id, detail } = event;

    validate(
      detail,
      paymentCancelledSchema,
      "PaymentCancelled",
      "PaymentCancelled#/components/schemas/PaymentCancelled"
    );

    console.log(
      `${prefix} - result: detail: ${JSON.stringify(
        detail
      )}, detailType: ${detailType}, id: ${id}`
    );

    const params: AWS.DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: config.subscriptionsTable,
      Key: {
        id: detail.subscriptionId,
      },
      UpdateExpression:
        "set #status = :status, updated=:updated, #event=:event",
      ExpressionAttributeValues: {
        ":status": subscriptionStatus.cancelled,
        ":updated": new Date().toISOString(),
        ":event": subscriptionEvents.subscriptionCancelled,
      },
      ExpressionAttributeNames: {
        "#status": "status",
        "#event": "event",
      },
      ReturnValues: "UPDATED_NEW",
    };

    await dynamoDb.update(params).promise();

    console.log(`${prefix} - cancelled subscription: ${detail}`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
