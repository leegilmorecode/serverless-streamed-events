import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { subscriptionEvents, subscriptionStatus } from "../../common";

import { Subscription } from "../../../types";
import { config } from "../../config";
import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const createSubscriptionHandler: APIGatewayProxyHandler = async ({
  body,
}: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "create-subscription.handler";
    const prefix = `${correlationId} - ${method}`;

    if (!body) throw new Error("no subscription body");

    console.log(`${prefix} - started`);

    const subscriptionId = uuid();
    const subscription: Subscription = {
      ...JSON.parse(body),
      id: subscriptionId,
      subscriptionId: subscriptionId,
      event: subscriptionEvents.subscriptionCreated,
      status: subscriptionStatus.active,
      updated: new Date().toISOString(),
    };

    console.log(`subscription: ${JSON.stringify(subscription)}`);

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: config.subscriptionsTable,
      Item: subscription,
    };

    // create the subscription
    await dynamoDb.put(params).promise();

    console.log(`response: ${subscription}`);

    return {
      statusCode: 201,
      body: JSON.stringify(subscription),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error has occurred",
    };
  }
};
