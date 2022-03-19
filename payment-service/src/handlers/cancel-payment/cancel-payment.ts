import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { Collection, Db, MongoClient, UpdateResult } from "mongodb";
import {
  buildMongoClient,
  connectToDatabase,
  paymentEvents,
  paymentStatus,
} from "../../common";

import { config } from "../../config";
import { v4 as uuid } from "uuid";

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

// when a user cancels their payment subscription we update the database
export const cancelPaymentHandler: APIGatewayProxyHandler = async ({
  body,
  pathParameters,
}: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "cancel-payment.handler";
    const prefix = `${correlationId} - ${method}`;

    if (!pathParameters || !pathParameters.id)
      throw new Error("no subscription id");

    if (!body) throw new Error("no payment body");

    const subscriptionId = pathParameters.id;
    const payment = JSON.parse(body);

    const db: Db = await databaseConnect();

    const collection: Collection<any> = db.collection(config.mongoCollection);

    // update the payment to cancelled
    const updateResult: UpdateResult = await collection.updateOne(
      { _id: subscriptionId },
      {
        $set: {
          updated: new Date().toISOString(),
          subscriptionId: subscriptionId,
          status: paymentStatus.cancelled,
          event: paymentEvents.paymentCancelled,
        },
      }
    );

    console.log(
      `${prefix} - started: subscriptionId - ${subscriptionId}, payment: ${JSON.stringify(
        payment
      )}, result: ${JSON.stringify(updateResult)}`
    );

    return {
      statusCode: 201,
      body: JSON.stringify(payment),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error has occurred",
    };
  }
};
