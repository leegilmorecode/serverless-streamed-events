import * as subscriptionCreatedSchema from "@schemas/subscriptions/subscription-created/app.subscriptions@SubscriptionCreated-v1.json";

import { Collection, Db, InsertOneResult, MongoClient } from "mongodb";
import { EventBridgeEvent, Handler } from "aws-lambda";
import {
  buildMongoClient,
  connectToDatabase,
  paymentEvents,
  paymentStatus,
} from "../../common";

import { config } from "../../config";
import { v4 as uuid } from "uuid";
import { validate } from "@packages/validate";

const client: MongoClient = buildMongoClient();
let cachedDb: Db;

// connects to the documentdb database
async function databaseConnect(): Promise<Db> {
  try {
    if (cachedDb) {
      console.log("database connection already established");
      return Promise.resolve(cachedDb);
    }

    console.log("No database connection available");
    const db = await connectToDatabase(client);

    return db;
  } catch (error) {
    console.log(`Error worth logging: ${error}`);
    throw new Error("unable to connect");
  }
}

// when we get a subscriptionCreated event then we create the payment subscription
export const createPaymentSubscriptionHandler: Handler<
  EventBridgeEvent<any, any>
> = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "create-payment-subscription.handler";
    const prefix = `${correlationId} - ${method}`;

    const { "detail-type": detailType, id, detail } = event;

    // validate the event against the event schema
    validate(
      detail,
      subscriptionCreatedSchema,
      "SubscriptionCreated",
      "SubscriptionCreated#/components/schemas/SubscriptionCreated"
    );

    console.log(`${prefix} - subscription created event validated`);

    console.log(
      `${prefix} - started: subscriptionId - ${
        detail.subscriptionId
      }, detailType: ${detailType}, id: ${id}, detail: ${JSON.stringify(
        detail
      )}`
    );

    const db: Db = await databaseConnect();

    const collection: Collection<any> = db.collection(config.mongoCollection);

    // create the new payment record based on a new subscription
    const insertResult: InsertOneResult<any> = await collection.insertOne({
      _id: detail.subscriptionId,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      subscriptionId: detail.subscriptionId,
      status: paymentStatus.active,
      event: paymentEvents.paymentCreated,
      accountNumber: detail.accountNumber,
    });

    console.log(`${prefix} - result: ${JSON.stringify(insertResult)}`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
