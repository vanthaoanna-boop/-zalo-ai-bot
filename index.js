const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const ZALO_BOT_TOKEN =
  (process.env.ZALO_BOT_TOKEN || "").trim();

const GEMINI_API_KEY =
  (process.env.GEMINI_API_KEY || "").trim();

const GEMINI_MODEL =
  (process.env.GEMINI_MODEL || "gemini-3.7-flash").trim();

const ADMIN_ID =
  (process.env.ADMIN_ID || "").trim();

const WEBHOOK_URL =
  (process.env.WEBHOOK_URL || "").trim();

// true = kiểm tra secret webhook
const VERIFY_WEBHOOK =
  String(process.env.VERIFY_WEBHOOK || "true").toLowerCase() === "true";

// Gemini fallback nếu model chính gặp lỗi
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
];

// ============================================================
// ZALO BOT API
// ============================================================

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ============================================================
// BOT STATE
// ============================================================

// /off chỉ tắt AI cho user đó.
// Các lệnh hệ thống vẫn hoạt động.
const userStates = new Map();

// Chống xử lý cùng một message 2 lần
const processedMessages = new Set();

// Giới hạn cache message
const MAX_PROCESSED_MESSAGES = 5000;

// ============================================================
// COMMAND SYSTEM
// ============================================================
//
// Muốn thêm lệnh mới:
// 1. Thêm object vào COMMANDS.
// 2. Không cần sửa phần webhook.
// ============================================================

const COMMANDS = {
  "/help": {
    description: "Xem danh sách lệnh",
    handler: async ({ userId }) => {
      return [
        "🤖 BOT MẶT ĐẤT MÀU XANH",
        "",
        "📚 LỆNH CƠ BẢN",
        "/help - Xem danh sách lệnh",
        "/ping - Kiểm tra bot",
        "/id - Xem ID của bạn",
        "/on - Bật AI",
        "/off - Tắt AI",
        "",
        "🧠 AI",
        "Nhắn bất kỳ câu hỏi nào → Gemini trả lời",
        "",
        "👑 ADMIN",
        "/adminid - Kiểm tra quyền admin",
        "",
        "💡 Sau này có thể thêm lệnh FF, game, tiện ích... rất dễ."
      ].join("\n");
    }
  },

  "/ping": {
    description: "Kiểm tra bot",
    handler: async () => {
      return "🏓 Pong!\n🟢 Bot đang hoạt động.";
    }
  },

  "/id": {
    description: "Xem ID Zalo",
    handler: async ({ userId }) => {
      return `🆔 ID của bạn:\n${userId}`;
    }
  },

  "/on": {
    description: "Bật AI",
    handler: async ({ userId }) => {
      userStates.set(userId, {
        ai: true
      });

      return "🟢 AI đã bật!\n\nNhắn gì cho bot cũng được.";
    }
  },

  "/off": {
    description: "Tắt AI",
    handler: async ({ userId }) => {
      userStates.set(userId, {
        ai: false
      });

      return "🔴 AI đã tắt.\n\nDùng /on để bật lại.";
    }
  },

  "/adminid": {
    description: "Kiểm tra quyền admin",
    handler: async ({ userId }) => {
      if (!ADMIN_ID) {
        return "⚠️ ADMIN_ID chưa được cấu hình trên Render.";
      }

      if (userId !== ADMIN_ID) {
        return "⛔ Bạn không phải admin.";
      }

      return `👑 Bạn là ADMIN.\n🆔 ${userId}`;
    }
  }
};

// ============================================================
// STARTUP LOG
// ============================================================

console.log("");
console.log("==============================================");
console.log("🤖 BOT MẶT ĐẤT MÀU XANH");
console.log("==============================================");
console.log("🚀 PORT:", PORT);
console.log(
  "🔑 ZALO BOT TOKEN:",
  ZALO_BOT_TOKEN ? "OK" : "❌ THIẾU"
);
console.log(
  "🔑 GEMINI API KEY:",
  GEMINI_API_KEY ? "OK" : "❌ THIẾU"
);
console.log("🧠 GEMINI MODEL:", GEMINI_MODEL);
console.log(
  "👑 ADMIN:",
  ADMIN_ID ? "ĐÃ CẤU HÌNH" : "CHƯA CẤU HÌNH"
);
console.log(
  "🌐 WEBHOOK:",
  WEBHOOK_URL || "Không tự đăng ký"
);
console.log(
  "🔐 WEBHOOK VERIFY:",
  VERIFY_WEBHOOK ? "ON" : "OFF"
);
console.log("==============================================");
console.log("");

// ============================================================
// HELPERS
// ============================================================

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function isAiEnabled(userId) {
  return userStates.get(userId)?.ai !== false;
}

function rememberMessage(messageId) {
  if (!messageId) return false;

  if (processedMessages.has(messageId)) {
    return false;
  }

  processedMessages.add(messageId);

  if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
    const first = processedMessages.values().next().value;

    if (first) {
      processedMessages.delete(first);
    }
  }

  return true;
}

function getWebhookSecret() {
  return crypto
    .createHash("sha256")
    .update(ZALO_BOT_TOKEN)
    .digest("hex")
    .substring(0, 32);
}

function safeToken(token) {
  if (!token) return "MISSING";

  if (token.length <= 12) {
    return "********";
  }

  return (
    token.substring(0, 6) +
    "********" +
    token.substring(token.length - 4)
  );
}

// ============================================================
// SPECIAL MEMORY / DEFAULT ANSWERS
// ============================================================
//
// Ví dụ:
// "Ai tạo bot Mặt Đất Màu Xanh?"
// "Bot mặt đất màu xanh của ai?"
// "Ai làm bot này?"
// "Bot này ai tạo?"
// => An Na & Hoàng Vũ
//
// Muốn thêm kiến thức cố định thì thêm function ở đây.
// ============================================================

function checkMemoryCommand(text) {
  const t = normalizeText(text);

  const asksCreator =
    (
      t.includes("ai tao bot") ||
      t.includes("ai lam bot") ||
      t.includes("ai tao ra bot") ||
      t.includes("bot nay cua ai") ||
      t.includes("bot nay ai tao") ||
      t.includes("bot cua ai")
    ) &&
    (
      t.includes("mat dat mau xanh") ||
      t.includes("bot")
    );

  if (asksCreator) {
    return "👑 Bot Mặt Đất Màu Xanh được tạo bởi:\n\n💙 An Na & Hoàng Vũ";
  }

  return null;
}

// ============================================================
// COMMAND PARSER
// ============================================================

function getCommand(text) {
  const clean = String(text || "").trim();

  if (!clean.startsWith("/")) {
    return null;
  }

  const firstPart = clean
    .split(/\s+/)[0]
    .toLowerCase();

  return firstPart;
}

async function handleCommand(command, context) {
  const item = COMMANDS[command];

  if (!item) {
    return null;
  }

  try {
    return await item.handler(context);
  } catch (error) {
    console.error(
      `❌ COMMAND ${command} ERROR:`,
      error.message
    );

    return "❌ Lệnh bị lỗi.";
  }
}

// ============================================================
// ZALO API REQUEST
// ============================================================

async function callZalo(method, body = {}) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình"
    );
  }

  const url =
    `${ZALO_API_BASE}/bot${ZALO_BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = {
      ok: false,
      description: raw
    };
  }

  console.log(
    `📡 ZALO ${method}:`,
    JSON.stringify(data)
  );

  if (!response.ok || data?.ok !== true) {
    const message =
      data?.description ||
      data?.message ||
      `Zalo HTTP ${response.status}`;

    const error = new Error(message);

    error.status = response.status;
    error.zalo = data;

    throw error;
  }

  return data;
}

// ============================================================
// CHECK ZALO BOT
// ============================================================

async function checkZaloBot() {
  try {
    const data = await callZalo("getMe");

    console.log("");
    console.log("✅ ZALO BOT API: OK");

    if (data?.result) {
      console.log(
        "🤖 BOT INFO:",
        JSON.stringify(data.result)
      );
    }

    return true;

  } catch (error) {
    console.error("");
    console.error(
      "❌ ZALO BOT API ERROR:",
      error.message
    );

    console.error(
      "🔑 TOKEN:",
      safeToken(ZALO_BOT_TOKEN)
    );

    console.error(
      "👉 Kiểm tra ZALO_BOT_TOKEN trên Render."
    );

    return false;
  }
}

// ============================================================
// SEND ZALO MESSAGE
// ============================================================

async function sendZaloMessage(chatId, text) {
  if (!chatId) {
    throw new Error("Thiếu chat_id");
  }

  let message = String(text || "").trim();

  if (!message) {
    message = "⚠️ Bot không có nội dung trả lời.";
  }

  // Zalo Bot giới hạn text khoảng 2000 ký tự.
  if (message.length > 2000) {
    message = message.substring(0, 1950) +
      "\n\n…";
  }

  return await callZalo("sendMessage", {
    chat_id: String(chatId),
    text: message
  });
}

// ============================================================
// SEND TYPING
// ============================================================

async function sendTyping(chatId) {
  try {
    await callZalo("sendChatAction", {
      chat_id: String(chatId),
      action: "typing"
    });
  } catch (error) {
    // typing lỗi không được làm hỏng bot
    console.log(
      "⚠️ Không gửi được typing:",
      error.message
    );
  }
}

// ============================================================
// GEMINI API
// ============================================================

async function askGemini(text) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình"
    );
  }

  const models = [
    GEMINI_MODEL,
    ...GEMINI_FALLBACK_MODELS.filter(
      (model) => model !== GEMINI_MODEL
    )
  ];

  let lastError = null;

  for (const model of models) {
    try {
      console.log(
        `🧠 Đang hỏi Gemini: ${model}`
      );

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text:
                  [
                    "Bạn là Bot Mặt Đất Màu Xanh.",
                    "Trả lời bằng tiếng Việt.",
                    "Thân thiện, tự nhiên.",
                    "Ưu tiên câu trả lời rõ ràng và ngắn gọn.",
                    "Không tự nhận mình là Gemini nếu người dùng hỏi tên bot.",
                    "Nếu người dùng hỏi ai tạo Bot Mặt Đất Màu Xanh, câu trả lời chính xác là An Na & Hoàng Vũ."
                  ].join(" ")
              }
            ]
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: String(text)
                }
              ]
            }
          ],

          generationConfig: {
            maxOutputTokens: 1024,
            thinkingConfig: {
              thinkingLevel: "low"
            }
          }
        })
      });

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        data = {
          error: {
            message: raw
          }
        };
      }

      if (!response.ok) {
        console.error(
          `❌ GEMINI ${model} HTTP ${response.status}`
        );

        console.error(
          JSON.stringify(data, null, 2)
        );

        lastError = new Error(
          data?.error?.message ||
          `Gemini HTTP ${response.status}`
        );

        continue;
      }

      const answer =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part?.text || "")
          .join("")
          .trim();

      if (!answer) {
        lastError = new Error(
          "Gemini không trả về nội dung"
        );

        continue;
      }

      console.log(
        `✅ GEMINI OK: ${model}`
      );

      console.log(
        "🤖 GEMINI:",
        answer
      );

      return answer;

    } catch (error) {
      console.error(
        `❌ GEMINI ${model} ERROR:`,
        error.message
      );

      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error("Tất cả Gemini model đều lỗi")
  );
}

// ============================================================
// EXTRACT ZALO WEBHOOK
// ============================================================

function parseZaloMessage(body) {
  const message = body?.message;

  if (!message) {
    return null;
  }

  const chatId =
    message?.chat?.id ||
    body?.chat_id ||
    body?.user_id ||
    null;

  const userId =
    message?.from?.id ||
    chatId ||
    null;

  const text =
    message?.text ||
    message?.message?.text ||
    body?.text ||
    "";

  const messageId =
    message?.message_id ||
    body?.message_id ||
    null;

  const isBot =
    message?.from?.is_bot === true;

  return {
    chatId,
    userId,
    text: String(text || "").trim(),
    messageId,
    isBot
  };
}

// ============================================================
// WEBHOOK AUTH
// ============================================================

function verifyWebhook(req) {
  if (!VERIFY_WEBHOOK) {
    return true;
  }

  if (!ZALO_BOT_TOKEN) {
    return false;
  }

  const expected = getWebhookSecret();

  const received =
    req.headers["x-bot-api-secret-token"];

  if (!received) {
    console.error(
      "❌ WEBHOOK THIẾU X-Bot-Api-Secret-Token"
    );

    return false;
  }

  return received === expected;
}

// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(body) {
  console.log("");
  console.log("==============================================");
  console.log("📩 ZALO WEBHOOK");
  console.log(
    JSON.stringify(body, null, 2)
  );
  console.log("==============================================");

  const eventName =
    body?.event_name ||
    body?.eventName ||
    "";

  if (
    eventName &&
    eventName !== "message.text.received"
  ) {
    console.log(
      "⚠️ Không phải tin nhắn text:",
      eventName
    );

    return;
  }

  const message = parseZaloMessage(body);

  if (!message) {
    console.log(
      "⚠️ Không đọc được message."
    );

    return;
  }

  const {
    chatId,
    userId,
    text,
    messageId,
    isBot
  } = message;

  console.log("🆔 CHAT ID:", chatId);
  console.log("🆔 USER ID:", userId);
  console.log("💬 TEXT:", text);

  if (!chatId || !userId) {
    console.error(
      "❌ Không có chat_id/user_id"
    );

    return;
  }

  if (!text) {
    console.log(
      "⚠️ Tin nhắn không có text."
    );

    return;
  }

  if (isBot) {
    console.log(
      "🤖 Tin từ bot -> bỏ qua."
    );

    return;
  }

  if (
    messageId &&
    !rememberMessage(messageId)
  ) {
    console.log(
      "♻️ Message đã xử lý -> bỏ qua."
    );

    return;
  }

  // ==========================================================
  // 1. COMMAND
  // ==========================================================

  const command = getCommand(text);

  if (command) {
    console.log(
      "⚡ COMMAND:",
      command
    );

    const result =
      await handleCommand(command, {
        userId,
        chatId,
        text,
        body
      });

    if (result !== null) {
      await sendZaloMessage(
        chatId,
        result
      );

      return;
    }

    // Lệnh không tồn tại
    await sendZaloMessage(
      chatId,
      [
        "❓ Không tìm thấy lệnh:",
        command,
        "",
        "Dùng /help để xem các lệnh."
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // 2. MEMORY / DEFAULT ANSWER
  // ==========================================================

  const memoryAnswer =
    checkMemoryCommand(text);

  if (memoryAnswer) {
    console.log(
      "🧠 MEMORY MATCH"
    );

    await sendZaloMessage(
      chatId,
      memoryAnswer
    );

    return;
  }

  // ==========================================================
  // 3. CHECK AI ON/OFF
  // ==========================================================

  if (!isAiEnabled(userId)) {
    console.log(
      "🔴 AI đang OFF cho user:",
      userId
    );

    return;
  }

  // ==========================================================
  // 4. GEMINI
  // ==========================================================

  console.log(
    "🧠 Đang hỏi Gemini..."
  );

  await sendTyping(chatId);

  let answer;

  try {
    answer = await askGemini(text);

  } catch (error) {
    console.error(
      "❌ GEMINI FINAL ERROR:",
      error.message
    );

    await sendZaloMessage(
      chatId,
      [
        "❌ AI đang gặp lỗi.",
        "",
        "Kiểm tra GEMINI_API_KEY hoặc GEMINI_MODEL trên Render."
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // 5. SEND ANSWER
  // ==========================================================

  try {
    await sendZaloMessage(
      chatId,
      answer
    );

    console.log(
      "✅ ĐÃ TRẢ LỜI ZALO"
    );

  } catch (error) {
    console.error(
      "❌ ZALO SEND ERROR:",
      error.message
    );

    if (error?.zalo) {
      console.error(
        "ZALO DETAIL:",
        JSON.stringify(
          error.zalo,
          null,
          2
        )
      );
    }
  }

  console.log(
    "=============================================="
  );
}

// ============================================================
// MAIN WEBHOOK
// ============================================================

app.post("/webhook", (req, res) => {
  // Trả 200 ngay cho Zalo
  res.status(200).json({
    ok: true
  });

  // Xác thực webhook
  if (!verifyWebhook(req)) {
    console.error(
      "⛔ WEBHOOK AUTH FAILED"
    );

    return;
  }

  // Xử lý async phía sau
  processMessage(req.body).catch(
    (error) => {
      console.error(
        "❌ PROCESS MESSAGE ERROR:",
        error
      );
    }
  );
});

// Alias
app.post("/zalo/webhook", (req, res) => {
  res.status(200).json({
    ok: true
  });

  if (!verifyWebhook(req)) {
    console.error(
      "⛔ /zalo/webhook AUTH FAILED"
    );

    return;
  }

  processMessage(req.body).catch(
    (error) => {
      console.error(
        "❌ /zalo/webhook ERROR:",
        error
      );
    }
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bot Mặt Đất Màu Xanh</title>
</head>
<body style="font-family:Arial,sans-serif;padding:30px">
  <h2>🤖 Bot Mặt Đất Màu Xanh</h2>
  <p>🟢 Server đang chạy.</p>
  <p>🧠 Gemini: ${GEMINI_MODEL}</p>
  <p>🔌 Zalo Bot API: ON</p>
</body>
</html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    server: true,
    zalo_bot_configured: Boolean(
      ZALO_BOT_TOKEN
    ),
    gemini_configured: Boolean(
      GEMINI_API_KEY
    ),
    gemini_model: GEMINI_MODEL,
    webhook_configured: Boolean(
      WEBHOOK_URL
    ),
    webhook_verify: VERIFY_WEBHOOK
  });
});

// ============================================================
// TEST GEMINI
// ============================================================

app.get("/test/gemini", async (req, res) => {
  try {
    const answer =
      await askGemini(
        "Trả lời đúng một câu: Gemini đang hoạt động."
      );

    res.json({
      ok: true,
      model: GEMINI_MODEL,
      answer
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ============================================================
// TEST ZALO
// ============================================================

app.get("/test/zalo", async (req, res) => {
  try {
    const data =
      await callZalo("getMe");

    res.json({
      ok: true,
      zalo: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      zalo: error.zalo || null
    });
  }
});

// ============================================================
// REGISTER WEBHOOK
// ============================================================

async function registerWebhook() {
  if (!WEBHOOK_URL) {
    console.log(
      "ℹ️ WEBHOOK_URL chưa có -> bỏ qua auto setWebhook."
    );

    return;
  }

  try {
    const secretToken =
      getWebhookSecret();

    const data =
      await callZalo("setWebhook", {
        url: WEBHOOK_URL,
        secret_token: secretToken
      });

    console.log("");
    console.log(
      "✅ ZALO WEBHOOK ĐÃ ĐĂNG KÝ"
    );

    console.log(
      "🌐 URL:",
      WEBHOOK_URL
    );

    console.log(
      "🔐 Secret:",
      "********"
    );

    console.log(
      JSON.stringify(data)
    );

  } catch (error) {
    console.error("");
    console.error(
      "❌ SET WEBHOOK ERROR:",
      error.message
    );
  }
}

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  async () => {
    console.log("");
    console.log(
      "=============================================="
    );
    console.log(
      "🚀 BOT MẶT ĐẤT MÀU XANH ĐÃ ONLINE"
    );
    console.log(
      "=============================================="
    );
    console.log(
      "🌐 PORT:",
      PORT
    );
    console.log(
      "🔌 ZALO BOT API:",
      ZALO_BOT_TOKEN
        ? "READY"
        : "❌ NO TOKEN"
    );
    console.log(
      "🧠 GEMINI:",
      GEMINI_API_KEY
        ? "READY"
        : "❌ NO KEY"
    );
    console.log(
      "🤖 MODEL:",
      GEMINI_MODEL
    );
    console.log(
      "=============================================="
    );

    // Kiểm tra Zalo
    if (ZALO_BOT_TOKEN) {
      await checkZaloBot();
    }

    // Kiểm tra Gemini
    if (GEMINI_API_KEY) {
      try {
        const test =
          await askGemini(
            "Chỉ trả lời: OK"
          );

        console.log(
          "✅ GEMINI TEST:",
          test
        );

      } catch (error) {
        console.error(
          "❌ GEMINI TEST FAILED:",
          error.message
        );
      }
    }

    // Tự đăng ký webhook nếu có WEBHOOK_URL
    if (
      ZALO_BOT_TOKEN &&
      WEBHOOK_URL
    ) {
      await registerWebhook();
    }

    console.log("");
    console.log(
      "📚 LỆNH:",
      Object.keys(COMMANDS).join(", ")
    );
    console.log(
      "🟢 BOT SẴN SÀNG NHẬN TIN"
    );
    console.log("");
  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ EXPRESS ERROR:",
      err
    );

    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: "Internal server error"
      });
    }
  }
);
