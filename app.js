var express = require("express");
var path = require("path");
var logger = require("morgan");
const { Telegraf } = require("telegraf");
const { stringify, parse } = require("flatted");
const schedule = require("node-schedule");
const axios = require("axios");
const { MongoClient } = require("mongodb");
require("dotenv").config();
const { setDefaultResultOrder } = require("node:dns");
const { get } = require("lodash");
setDefaultResultOrder("ipv4first");

var app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.use(logger("dev"));

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
client.connect().then(() => console.log("Connected to MongoDB"));

const db = client.db();
const otpErrorLog = db.collection("otp_sms_bot_error_log");
const otpDataLog = db.collection("otp_sms_bot_data");

console.log(process.env.BOT_TOKEN, "process.env.BOT_TOKEN");
const bot = new Telegraf(process.env.BOT_TOKEN);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function lauchBot() {
  let retry = 0;
  do {
    try {
      await sleep(2000);
      bot.start((ctx) => ctx.reply("Hello, I'm sms bot~"));
      bot.on("sticker", (ctx) => ctx.reply("👍"));
      await bot.launch();
      console.log("Start Bot successful");
      break;
    } catch (error) {
      console.log(error, "lauchbot error");
      retry++;
    }
  } while (retry < 500);
}
lauchBot();

let isProcessing = false;
let lastId = 0;
let firstRun = true;
let cnt = 0;
let apiToken = "";
let getToken = true;
let cntWaiting = 0;

const job = schedule.scheduleJob("*/2 * * * * *", async function () {
  try {
    if (cntWaiting > 0) {
      cntWaiting--;
      return;
    }

    if (getToken) {
      const tokenResult = await axios.post(process.env.URL_GET_TOKEN, {
        username: process.env.API_USER_NAME,
        password: process.env.API_PASSWORD,
        type: "account",
      });
      apiToken = tokenResult?.data?.token;

      getToken = false;
    }

    if (isProcessing) {
      console.log("busy.......");
      return;
    }
    isProcessing = true;
    cnt++;
    // console.log("Counter run : " + cnt);

    let res = await axios.get(process.env.URL_GET_LOGS, {
      headers: {
        "X-Access-Token": apiToken,
      },
    });

    const data = res.data;

    if (firstRun) {
      firstRun = false;

      lastId = data.logs[0].id;
      isProcessing = false;
      return;
    }

    let msgSendTelegram = "";
    let dataToLog = [];
    for (let i = 10; i > 0; i--) {
      if (data.logs[i - 1]?.id > lastId) {
        console.log(data.logs[i - 1], "1ujaljsflk");
        let msgSendTelegramItem = "<b>" + data.logs[i - 1]["target"] + "</b>";
        msgSendTelegramItem += "-->";

        let payload;
        try {
          payload = data.logs[i - 1]["payload"];
          // Get otp
          const regex = /\b\d{6}\b/g;
          const match = payload.match(regex);

          const otpCode = get(match, "[0]");
          if (otpCode) {
            msgSendTelegramItem += "<b>" + ` <code>${otpCode}</code> ` + "</b>";
            msgSendTelegramItem += "\n\n\n";
            msgSendTelegram += msgSendTelegramItem;

            dataToLog.push({
              id: data.logs[i - 1]?.id,
              phoneNumber: data.logs[i - 1]["target"],
              message: otpCode,
              rawData: data.logs[i - 1],
              createdAt: new Date(),
            });
          }
        } catch (error) {
          lastId = data.logs[i - 1]?.id;
          try {
            await otpErrorLog.insertOne({
              message: error?.message,
              type: "get-data-error",
              error: parse(stringify(error)),
              dataError: {
                payload,
                data,
              },
              createdAt: new Date(),
            });
          } catch (errorSendException) {
            console.log("Log get data error: ", errorSendException);
          }

          console.log(error, "Get otp error");
        }
      }
    }
    if (msgSendTelegram.length > 0) {
      try {
        await bot.telegram.sendMessage(
          process.env.TELEGRAM_GROUP_ID,
          msgSendTelegram,
          {
            parse_mode: "HTML",
          }
        );

        lastId = data.logs[0].id;
      } catch (error) {
        console.log("Send message error: ", error);
        // send error to telegram
        try {
          await bot.telegram.sendMessage(
            process.env.TELEGRAM_USER_ID_DEBUG,
            JSON.stringify(parse(stringify(error)))
          );
        } catch (errorSendException) {
          console.log("Send exception error: ", errorSendException);
        }

        try {
          await otpErrorLog.insertOne({
            message: error?.message,
            type: "send-message-error",
            error: parse(stringify(error)),
            createdAt: new Date(),
          });
        } catch (errorSendException) {
          console.log("Log send telegram error: ", errorSendException);
        }
      }

      // Write log data
      try {
        await otpDataLog.insertMany(dataToLog);
      } catch (error) {
        console.log(error, "Write log data error");
      }
    }
    isProcessing = false;
  } catch (error) {
    console.log(error, "Error process");
    if (error?.response?.status === 401) {
      getToken = true;
    } else {
      cntWaiting = 1;
    }

    try {
      console.log("Error: ", parse(stringify(error)));
      await bot.telegram.sendMessage(
        process.env.TELEGRAM_USER_ID_DEBUG,
        JSON.stringify(parse(stringify(error)))
      );

      await otpErrorLog.insertOne({
        message: error?.message,
        type: "process-error",
        error: parse(stringify(error)),
        createdAt: new Date(),
      });
    } catch (errorSendException) {
      console.log("Send exception error: ", errorSendException);
    }

    isProcessing = false;
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
