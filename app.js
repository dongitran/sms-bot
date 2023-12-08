const { Telegraf } = require("telegraf");
const SMSBot = require("./bot");

require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply("Hello, I'm sms bot~"));
bot.on("sticker", (ctx) => ctx.reply("👍"));
bot.launch();

const smsBot = new SMSBot(bot, process.env.TELEGRAM_GROUP_ID, process.env.TELEGRAM_USER_ID_DEBUG);
smsBot.run();

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
