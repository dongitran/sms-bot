var express = require("express");
var path = require("path");
var logger = require("morgan");
const { Telegraf } = require("telegraf");
const { stringify, parse } = require("flatted");
const schedule = require("node-schedule");
const { Pool } = require("pg");
const crypto = require("crypto");
const axios = require("axios");
require("dotenv").config();
const { setDefaultResultOrder } = require("node:dns");
const { get } = require("lodash");
setDefaultResultOrder("ipv4first");

var app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.use(logger("dev"));

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
});

const ROCKET_CHAT_CONFIG = {
  serverUrl: process.env.ROCKET_CHAT_SERVER_URL,
  username: process.env.ROCKET_CHAT_USERNAME,
  password: process.env.ROCKET_CHAT_PASSWORD,
  targetChannel: process.env.ROCKET_CHAT_TARGET_CHANNEL
};

let rocketChatToken = null;
let rocketChatUserId = null;
let tokenExpireTime = null;

async function authenticateRocketChat() {
  try {
    console.log('Authenticating with Rocket.Chat...');
    const response = await axios.post(`${ROCKET_CHAT_CONFIG.serverUrl}/api/v1/login`, {
      username: ROCKET_CHAT_CONFIG.username,
      password: ROCKET_CHAT_CONFIG.password
    });

    if (response.data.status === 'success') {
      rocketChatToken = response.data.data.authToken;
      rocketChatUserId = response.data.data.userId;
      tokenExpireTime = Date.now() + (24 * 60 * 60 * 1000);
      console.log('Rocket.Chat authentication successful');
      return true;
    } else {
      console.error('Rocket.Chat authentication failed:', response.data);
      return false;
    }
  } catch (error) {
    console.error('Rocket.Chat authentication error:', error.message);
    return false;
  }
}

async function ensureRocketChatToken() {
  if (!rocketChatToken || !tokenExpireTime || Date.now() >= tokenExpireTime) {
    console.log('Token expired or not available, refreshing...');
    return await authenticateRocketChat();
  }
  return true;
}

async function sendRocketChatMessage(message) {
  try {
    const isTokenValid = await ensureRocketChatToken();
    if (!isTokenValid) {
      console.error('Failed to get valid Rocket.Chat token');
      return false;
    }

    const response = await axios.post(
      `${ROCKET_CHAT_CONFIG.serverUrl}/api/v1/chat.postMessage`,
      {
        channel: `#${ROCKET_CHAT_CONFIG.targetChannel}`,
        text: message
      },
      {
        headers: {
          'X-Auth-Token': rocketChatToken,
          'X-User-Id': rocketChatUserId,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.success) {
      console.log('Message sent to Rocket.Chat successfully');
      return true;
    } else {
      console.error('Failed to send message to Rocket.Chat:', response.data);
      return false;
    }
  } catch (error) {
    console.error('Rocket.Chat send message error:', error.message);
    
    if (error.response && error.response.status === 401) {
      console.log('Authentication error, trying to refresh token...');
      const refreshed = await authenticateRocketChat();
      if (refreshed) {
        return await sendRocketChatMessage(message);
      }
    }
    return false;
  }
}

function convertHtmlToPlainText(htmlMessage) {
  return htmlMessage
    .replace(/<b>/g, '*')
    .replace(/<\/b>/g, '*')
    .replace(/<code>/g, '`')
    .replace(/<\/code>/g, '`')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decryptAES(encryptedData, key) {
  try {
    const encryptedBuffer = Buffer.from(encryptedData, "base64");
    const iv = encryptedBuffer.slice(0, 16);
    const encrypted = encryptedBuffer.slice(16);
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(key, "utf8"),
      iv
    );
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.log("Decrypt error:", error);
    return null;
  }
}

async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log("Connected to PostgreSQL");

    try {
      const logResult = await client.query(
        "select * from log where type = 1 or (type = 5 and provider='vgs_zns') order by id desc limit 5;"
      );
      console.log("=== LOG TABLE QUERY RESULTS ===");
      console.log("Number of rows:", logResult.rows.length);
      logResult.rows.forEach((row, index) => {
        console.log(`Row ${index + 1}:`, JSON.stringify(row, null, 2));
      });
      console.log("=== END LOG TABLE QUERY ===");
    } catch (logError) {
      console.log("Error querying log table:", logError.message);
      console.log("This might be normal if 'log' table doesn't exist yet.");
    }

    client.release();
    console.log("Database connection tested");
  } catch (error) {
    console.error("Database connection error:", error);
  }
}

async function initRocketChat() {
  try {
    await authenticateRocketChat();
    console.log("Rocket.Chat initialized successfully");
  } catch (error) {
    console.error("Rocket.Chat initialization error:", error);
  }
}

initDatabase();
initRocketChat();

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
let cntWaiting = 0;

const job = schedule.scheduleJob("*/1 * * * * *", async function () {
  try {
    if (cntWaiting > 0) {
      cntWaiting--;
      return;
    }

    if (isProcessing) {
      console.log("busy.......");
      return;
    }
    isProcessing = true;
    cnt++;

    const client = await pool.connect();
    const result = await client.query(
      "select * from log where type = 1 or (type = 5 and provider='vgs_zns') order by id desc limit 10;"
    );
    client.release();

    const data = result.rows;

    if (firstRun) {
      firstRun = false;
      if (data.length > 0) {
        lastId = data[0].id;
      }
      isProcessing = false;
      return;
    }

    let msgSendTelegram = "";
    let msgSendRocketChat = "";

    for (let i = data.length - 1; i >= 0; i--) {
      const logItem = data[i];

      if (logItem.id > lastId) {
        let msgSendTelegramItem = "<b>" + logItem.target + "</b>";
        let msgSendRocketChatItem = "*" + logItem.target + "*";
        
        msgSendTelegramItem += "-->";
        msgSendRocketChatItem += " --> ";

        try {
          let otpCode = null;

          if (logItem.type === 1) {
            const decryptedPayload = decryptAES(logItem.payload, process.env.AES_KEY);

            if (decryptedPayload) {
              const regex = /\b\d{6}\b/g;
              const match = decryptedPayload.match(regex);
              otpCode = get(match, "[0]");
            }
          } else if (logItem.type === 5 && logItem.provider === "vgs_zns") {
            const decryptedRequest = decryptAES(logItem.request, process.env.AES_KEY);

            if (decryptedRequest) {
              const otpRegex = /"otp"\s*:\s*"(\d+)"/;
              const match = decryptedRequest.match(otpRegex);
              otpCode = match ? match[1] : null;
            }
          }

          if (otpCode) {
            msgSendTelegramItem += "<b>" + ` <code>${otpCode}</code> ` + "</b>";
            msgSendTelegramItem += "\n\n\n";
            msgSendTelegram += msgSendTelegramItem;

            msgSendRocketChatItem += "*" + ` \`${otpCode}\` ` + "*";
            msgSendRocketChatItem += "\n\n";
            msgSendRocketChat += msgSendRocketChatItem;
          }
        } catch (error) {
          console.log(error, "Decrypt/process error for type:", logItem.type);
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

        await sendRocketChatMessage(msgSendRocketChat);

        if (data.length > 0) {
          lastId = data[0].id;
        }
      } catch (error) {
        console.log("Send message error: ", error);
        try {
          await bot.telegram.sendMessage(
            process.env.TELEGRAM_USER_ID_DEBUG,
            JSON.stringify(parse(stringify(error)))
          );
        } catch (errorSendException) {
          console.log("Send exception error: ", errorSendException);
        }
      }
    }
    isProcessing = false;
  } catch (error) {
    console.log(error, "Error process");
    cntWaiting = 1;

    try {
      console.log("Error: ", parse(stringify(error)));
      await bot.telegram.sendMessage(
        process.env.TELEGRAM_USER_ID_DEBUG,
        JSON.stringify(parse(stringify(error)))
      );
    } catch (errorSendException) {
      console.log("Send exception error: ", errorSendException);
    }

    isProcessing = false;
  }
});

process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await pool.end();
  process.exit(0);
});

const port = process.env.PORT || 30501;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
