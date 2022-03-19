import { Collection, Db, MongoClient, MongoClientOptions } from "mongodb";

import AWS from "aws-sdk";
import { EventEmitter } from "events";
import path from "path";
import { v5 as uuid } from "uuid";

const namespace = "7179ac77-bd32-4514-a2eb-78423292ba23";

const mongoServer = process.env.MONGO_SERVER;
const mongoPort = process.env.MONGO_PORT;
const mongoDatabase = process.env.MONGO_DB || "test";
const mongoMasterUser = process.env.MONGO_USERNAME;
const mongoMasterPassword = process.env.MONGO_PASSWORD;
const paymentsEventQueue = process.env.PAYMENTS_EVENTS_QUEUE as string;

const sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

const client: MongoClient = buildMongoClient();

const eventEmitter = new EventEmitter();

eventEmitter.addListener("databaseChange", sendEvent);

async function sendEvent(args: any) {
  try {
    const eventBody = JSON.stringify(args);
    // create the sqs message for the FIFO queue and send it based off the database changes
    const params: AWS.SQS.SendMessageRequest = {
      MessageAttributes: {
        SubscriptionId: {
          DataType: "String",
          StringValue: args.subscriptionId,
        },
        ID: {
          DataType: "String",
          StringValue: args._id,
        },
        AccountNumber: {
          DataType: "String",
          StringValue: args.accountNumber,
        },
        Status: {
          DataType: "String",
          StringValue: args.status,
        },
      },
      MessageBody: eventBody,
      MessageDeduplicationId: uuid(eventBody, namespace), // v5 uuid allows us to generate a known uuid for FIFO queues
      MessageGroupId: "payments",
      QueueUrl: paymentsEventQueue,
    };
    await sqs.sendMessage(params).promise();

    console.log(`message sent for record: ${args._id}`);
  } catch (error) {
    throw new Error(
      `unable to send sqs message for ${JSON.stringify(args)} - ${error}`
    );
  }
}

function buildMongoClient(): MongoClient {
  const url = process.env.DEV
    ? "mongodb://localhost:27017"
    : `mongodb://${mongoMasterUser}:${mongoMasterPassword}@${mongoServer}:${mongoPort}/${mongoDatabase}?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`;

  const options: MongoClientOptions = process.env.DEV
    ? {}
    : {
        ssl: true,
        sslCA: `${path.resolve()}/rds-combined-ca-bundle.pem`,
        minPoolSize: 5,
        maxPoolSize: 100,
      };

  return new MongoClient(url, options);
}

// connects to the documentdb database
async function databaseConnect(): Promise<Db> {
  try {
    await client.connect();
    console.log("connected successfully to server");
    const db: Db = client.db(mongoDatabase);

    console.log(`connected successfully to database ${mongoDatabase}`);

    return db;
  } catch (error) {
    console.log(`Error worth logging: ${error}`);
    throw new Error("unable to connect");
  }
}

// starts the server passing in the db context which is connected
function startServer(db: Db): void {
  // enable change streams for our collections if not already enabled
  db.admin().command({
    modifyChangeStreams: 1,
    database: mongoDatabase,
    collection: "",
    enable: true,
  });

  // specify collection
  const collection: Collection<any> = db.collection("payments");

  const changeStream = collection.watch([], {
    fullDocument: "updateLookup",
  });

  // start listening to changes
  changeStream.on("change", function (change: any) {
    console.log(`Operation type: ${change.operationType}`);
    console.log(`Key: ${JSON.stringify(change.documentKey)}`);
    console.log(`Document: ${JSON.stringify(change.fullDocument)}`);

    // emit any database changes so we can send a message to SQS
    eventEmitter.emit("databaseChange", change.fullDocument);
  });
}

function close(): void {
  // remove the listener on error
  eventEmitter.removeListener("databaseChange", sendEvent);
  console.log("closing event emitter on error");
}

async function main(): Promise<void> {
  const db: Db = await databaseConnect();
  startServer(db);
}

main().catch((error) => {
  console.error(error);
  close();
});
