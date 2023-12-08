var express = require("express");
var path = require("path");
var logger = require("morgan");
const { Telegraf } = require("telegraf");
const { stringify, parse } = require("flatted");
const schedule = require("node-schedule");
const axios = require("axios");
require("dotenv").config();

var app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.use(logger("dev"));

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply("Hello, I'm dev bot~"));
bot.on("sticker", (ctx) => ctx.reply("👍"));
bot.launch();

let isProcessing = false;
let lastId = 0;
let firstRun = true;
let cnt = 0;

const job = schedule.scheduleJob("*/1 * * * * *", async function () {
  try {
    if (isProcessing) {
      console.log("busy..");
      return;
    }
    isProcessing = true;
    cnt++;
    console.log("Counter run: " + cnt);

    let res = await axios.get(process.env.URL_GET_LOGS, {
      headers: {
        "X-Access-Token": process.env.API_TOKEN,
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
    for (let i = 20; i > 0; i--) {
      if (data.logs[i - 1].id > lastId) {
        let msgSendTelegramItem = "<b>" + data.logs[i - 1]["target"] + "</b>";
        msgSendTelegramItem += "-->";

        try {
          const payload = data.logs[i - 1]["payload"];
          // Get otp
          const regex = /\b\d{6}\b/g;
          const match = payload.match(regex);

          const otpCode = match[0];
          msgSendTelegramItem +=
            "<b>" +
            ` <code>${otpCode}</code>   &lt;--Nhấn vào để copy nha` +
            "</b>";
          msgSendTelegramItem += "\n\n\n";
          msgSendTelegram += msgSendTelegramItem;
        } catch (error) {
          //msgSendTelegramItem += data.logs[i - 1]["payload"];
          //msgSendTelegramItem += "\n\n\n";
        }
      }
    }
    if (msgSendTelegram.length > 0) {
      try {
        bot.telegram.sendMessage(
          process.env.TELEGRAM_GROUP_ID,
          msgSendTelegram,
          {
            parse_mode: "HTML",
          }
        );
      } catch (error) {
        console.log("Send message error: ", error);
        // send error to telegram
        try {
          bot.telegram.sendMessage(
            process.env.TELEGRAM_USER_ID_DEBUG,
            JSON.stringify(parse(stringify(error)))
          );
        } catch (errorSendException) {
          console.log("Send exception error: ", errorSendException);
        }
      }
    }
    lastId = data.logs[0].id;
    isProcessing = false;
  } catch (error) {
    console.log(error, "process error..");
    isProcessing = false;
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
