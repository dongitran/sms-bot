const axios = require("axios");
const schedule = require("node-schedule");

class SMSBot {
  constructor(bot, telegramGroupId, telegramUserIdDebug) {
    this.bot = bot;
    this.telegramGroupId = telegramGroupId;
    this.telegramUserIdDebug = telegramUserIdDebug;
    this.lastId = 0;
    this.firstRun = true;
    this.isProcessing = false;
    this.cnt = 0;
  }

  async run() {
    const job = schedule.scheduleJob("*/1 * * * * *", async () => {
      try {
        if (this.isProcessing) {
          console.log("busy..");
          return;
        }
        this.isProcessing = true;
        this.cnt++;
        console.log("Counter run: " + this.cnt);

        const res = await axios.get(process.env.URL_GET_LOGS, {
          headers: {
            "X-Access-Token": process.env.API_TOKEN,
          },
        });

        const data = res.data;

        let msgSendTelegram = "";
        for (let i = 20; i > 0; i--) {
          if (data.logs[i - 1].id > this.lastId) {
            let msgSendTelegramItem = "<b>" + data.logs[i - 1]["target"] + "</b>";
            msgSendTelegramItem += "-->";

            try {
              const payload = data.logs[i - 1]["payload"];
              const regex = /\b\d{6}\b/g;
              const match = payload.match(regex);

              const otpCode = match[0];
              msgSendTelegramItem +=
                "<b>" +
                ` <code>${otpCode}</code> ` +
                "</b>";
              msgSendTelegramItem += "\n\n\n";
              msgSendTelegram += msgSendTelegramItem;
            } catch (error) {
              // Handle error
            }
          }
        }
        if (msgSendTelegram.length > 0) {
          await this.sendMessage(msgSendTelegram);
        }
        this.lastId = data.logs[0].id;
        this.isProcessing = false;
      } catch (error) {
        console.log(error, "process error..");
        this.isProcessing = false;
      }
    });
  }

  async sendMessage(msg) {
    try {
      await this.bot.telegram.sendMessage(this.telegramGroupId, msg, {
        parse_mode: "HTML",
      });
    } catch (error) {
      console.log("Send message error: ", error);
      try {
        await this.bot.telegram.sendMessage(
          this.telegramUserIdDebug,
          JSON.stringify(error)
        );
      } catch (errorSendException) {
        console.log("Send exception error: ", errorSendException);
      }
    }
  }
}

module.exports = SMSBot;
