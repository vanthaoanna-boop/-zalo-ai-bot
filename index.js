const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// =====================================================
// CONFIG
// =====================================================

const PORT = Number(process.env.PORT || 10000);

const ZALO_BOT_TOKEN = (process.env.ZALO_BOT_TOKEN || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();

const ADMIN_ID = (process.env.ADMIN_ID || "").trim();

// Model chính.
// KHÔNG dùng gemini-2.5-flash nữa.
const GEMINI_MODEL =
  (process.env.GEMINI_MODEL || "gemini-3.7-flash").trim();

// Model dự phòng
const GEMINI_FALLBACK_MODELS = [
  GEMINI_MODEL,
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
].filter((v, i, a) => v && a.indexOf(v) === i);

// =====================================================
// BOT INFO
// =====================================================

const BOT_NAME = "Bot Mặt Đất Màu Xanh";

const SYSTEM_PROMPT = `
Bạn là ${BOT_NAME}, một bot Zalo AI của An Na & Hoàng Vũ.

Quy tắc:
- Trả lời bằng tiếng Việt.
- Thân thiện, tự nhiên.
- Không tự nhận mình là Gemini nếu người dùng không hỏi.
- Trả lời ngắn gọn khi câu hỏi đơn giản.
- Nếu người dùng hỏi ai tạo ra bot, ai làm bot, chủ bot là ai,
  hoặc câu hỏi có ý nghĩa tương đương với:
  "Ai tạo Bot Mặt Đất Màu Xanh?"
  thì trả lời chính xác:
  "An Na & Hoàng Vũ"
- Nếu người dùng hỏi /help thì hướng dẫn các lệnh của bot.
- Không bịa thông tin về chủ bot.
`;

// =====================================================
// STARTUP
// =====================================================

console.log("");
console.log("==============================================");
console.log("🤖 BOT MẶT ĐẤT MÀU XANH");
console.log("==============================================");
console.log("🚀 PORT:", PORT);
console.log("🟢 SERVER: ON");
console.log(
  "🔑 GEMINI KEY:",
  GEMINI_API_KEY ? "OK" : "❌ THIẾU"
);
console.log(
  "🔑 ZALO TOKEN:",
  ZALO_BOT_TOKEN ? "OK" : "❌ THIẾU"
);
console.log("🧠 GEMINI MODEL:", GEMINI_MODEL);
console.log(
  "🔁 FALLBACK:",
  GEMINI_FALLBACK_MODELS.join(" -> ")
);
console.log(
  "👑 ADMIN:",
  ADMIN_ID ? "ĐÃ CẤU HÌNH" : "CHƯA CẤU HÌNH"
);
console.log("==============================================");
console.log("");

// =====================================================
// HELP
// =====================================================

function getHelp() {
  return `
🤖 ${BOT_NAME}

📌 LỆNH CƠ BẢN

/help
→ Xem danh sách lệnh

/ping
→ Kiểm tra bot

/id
→ Xem Zalo User ID của bạn

/on
→ Bật bot

/off
→ Tắt bot

/admin
→ Kiểm tra admin

🤖 AI
→ Gửi tin nhắn bất kỳ, bot sẽ trả lời bằng Gemini.

💾 GHI NHỚ
→ Ai tạo Bot Mặt Đất Màu Xanh?
→ An Na & Hoàng Vũ

🎮 Có thể mở rộng thêm lệnh Free Fire,
quản lý admin và các tính năng khác sau này.
`.trim();
}

// =====================================================
// BOT STATE
// =====================================================

const userStates = new Map();

function isUserEnabled(userId) {
  if (!userStates.has(userId)) {
    return true;
  }

  return userStates.get(userId) !== false;
}

function setUserEnabled(userId, enabled) {
  userStates.set(userId, enabled);
}

// =====================================================
// COMMANDS
// =====================================================

async function handleCommand(userId, text) {
  const command = text.trim().toLowerCase();

  if (command === "/help") {
    await sendZaloMessage(userId, getHelp());
    return true;
  }

  if (command === "/ping") {
    await sendZaloMessage(
      userId,
      "🏓 Pong!\n🟢 Bot đang hoạt động."
    );
    return true;
  }

  if (command === "/id") {
    await sendZaloMessage(
      userId,
      `🆔 User ID của bạn:\n${userId}`
    );
    return true;
  }

  if (command === "/on") {
    setUserEnabled(userId, true);

    await sendZaloMessage(
      userId,
      "🟢 Bot AI đã bật lại."
    );

    return true;
  }

  if (command === "/off") {
    setUserEnabled(userId, false);

    await sendZaloMessage(
      userId,
      "🔴 Bot đã tắt.\n\nGửi /on để bật lại."
    );

    return true;
  }

  if (command === "/admin") {
    if (!ADMIN_ID) {
      await sendZaloMessage(
        userId,
        "⚠️ ADMIN_ID chưa được cấu hình trên Render."
      );

      return true;
    }

    if (userId !== ADMIN_ID) {
      await sendZaloMessage(
        userId,
        "⛔ Bạn không phải admin."
      );

      return true;
    }

    await sendZaloMessage(
      userId,
      "👑 Bạn đang là ADMIN."
    );

    return true;
  }

  return false;
}

// =====================================================
// GET USER ID
// =====================================================

function getUserId(body) {
  return (
    body?.sender?.id ||
    body?.message?.from?.id ||
    body?.user_id ||
    body?.message?.chat?.id ||
    null
  );
}

// =====================================================
// GET TEXT
// =====================================================

function getMessageText(body) {
  return (
    body?.message?.text ||
    body?.message?.message?.text ||
    body?.text ||
    ""
  );
}

// =====================================================
// GEMINI
// =====================================================

async function askGemini(text) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình trên Render."
    );
  }

  let lastError = null;

  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`🧠 Đang hỏi Gemini: ${model}`);

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:generateContent?key=` +
        `${encodeURIComponent(GEMINI_API_KEY)}`;

      const response = await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: SYSTEM_PROMPT
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
          ]
        })
      });

      const data = await response.json();

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

        // thử model tiếp theo
        continue;
      }

      const answer =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part?.text || "")
          .join("")
          .trim();

      if (!answer) {
        lastError = new Error(
          "Gemini không trả về nội dung."
        );

        continue;
      }

      console.log(
        `✅ GEMINI OK: ${model}`
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

  throw lastError || new Error(
    "Không có Gemini model nào hoạt động."
  );
}

// =====================================================
// ZALO SEND MESSAGE
// =====================================================

async function sendZaloMessage(userId, text) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình."
    );
  }

  if (!userId) {
    throw new Error(
      "Không tìm thấy Zalo user_id."
    );
  }

  // Zalo giới hạn text.
  const messageText = String(text).slice(0, 2000);

  const response = await fetch(
    "https://openapi.zalo.me/v3.0/oa/message/cs",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "access_token": ZALO_BOT_TOKEN
      },

      body: JSON.stringify({
        recipient: {
          user_id: userId
        },

        message: {
          text: messageText
        }
      })
    }
  );

  const data = await response.json();

  console.log(
    "📤 ZALO:",
    JSON.stringify(data)
  );

  if (!response.ok || data?.error !== 0) {
    const errorCode = data?.error;

    const message =
      data?.message ||
      data?.error_name ||
      `Zalo HTTP ${response.status}`;

    if (errorCode === -216) {
      throw new Error(
        "ZALO_TOKEN_INVALID: Access token is invalid."
      );
    }

    throw new Error(
      `Zalo error ${errorCode}: ${message}`
    );
  }

  return data;
}

// =====================================================
// SPECIAL MEMORY
// =====================================================

function checkMemoryQuestion(text) {
  const normalized = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const keywords = [
    "ai tao bot",
    "ai lam bot",
    "ai viet bot",
    "ai tao ra bot",
    "chu bot la ai",
    "bot cua ai",
    "ai lam ra bot",
    "ai tao ra mat dat mau xanh",
    "ai tao mat dat mau xanh",
    "ai tao bot mat dat mau xanh",
    "nguoi tao bot"
  ];

  return keywords.some(
    (keyword) =>
      normalized.includes(keyword)
  );
}

// =====================================================
// WEBHOOK PROCESSOR
// =====================================================

async function processWebhook(body) {
  console.log("");
  console.log("==============================================");
  console.log("📩 ZALO WEBHOOK");
  console.log(
    JSON.stringify(body, null, 2)
  );
  console.log("==============================================");

  // Không xử lý bot message
  if (
    body?.message?.from?.is_bot === true ||
    body?.sender?.is_bot === true
  ) {
    console.log("🤖 Tin từ bot -> bỏ qua.");
    return;
  }

  const userId = getUserId(body);
  const text = getMessageText(body).trim();

  console.log("🆔 USER:", userId);
  console.log("💬 TEXT:", text);

  if (!userId) {
    console.log(
      "⚠️ Không tìm thấy user ID."
    );
    return;
  }

  if (!text) {
    console.log(
      "⚠️ Không có text -> bỏ qua."
    );
    return;
  }

  // -----------------------------------------------
  // SPECIAL MEMORY
  // -----------------------------------------------

  if (checkMemoryQuestion(text)) {
    await sendZaloMessage(
      userId,
      "An Na & Hoàng Vũ"
    );

    console.log(
      "💾 MEMORY -> An Na & Hoàng Vũ"
    );

    return;
  }

  // -----------------------------------------------
  // COMMAND
  // -----------------------------------------------

  const handled =
    await handleCommand(userId, text);

  if (handled) {
    return;
  }

  // -----------------------------------------------
  // BOT OFF
  // -----------------------------------------------

  if (!isUserEnabled(userId)) {
    console.log(
      "🔴 Bot đang OFF cho user:",
      userId
    );

    return;
  }

  // -----------------------------------------------
  // GEMINI
  // -----------------------------------------------

  console.log(
    "🤖 Đang hỏi Gemini..."
  );

  let answer;

  try {
    answer = await askGemini(text);
  } catch (error) {
    console.error(
      "❌ GEMINI FINAL ERROR:",
      error.message
    );

    // Cố gắng báo cho user
    try {
      await sendZaloMessage(
        userId,
        "⚠️ AI đang gặp lỗi.\n\n" +
        "Nếu lỗi tiếp tục, kiểm tra GEMINI_API_KEY " +
        "và GEMINI_MODEL trên Render."
      );
    } catch (zaloError) {
      console.error(
        "❌ Không gửi được lỗi về Zalo:",
        zaloError.message
      );
    }

    return;
  }

  console.log("🤖 GEMINI:");
  console.log(answer);

  // -----------------------------------------------
  // SEND TO ZALO
  // -----------------------------------------------

  try {
    await sendZaloMessage(
      userId,
      answer
    );

    console.log(
      "✅ Đã gửi câu trả lời về Zalo."
    );
  } catch (error) {
    console.error(
      "❌ ZALO SEND ERROR:",
      error.message
    );

    if (
      error.message.includes(
        "ZALO_TOKEN_INVALID"
      )
    ) {
      console.error(
        "🔑 ZALO TOKEN ĐANG SAI/HẾT HẠN."
      );
    }
  }
}

// =====================================================
// WEBHOOK /webhook
// =====================================================

app.post("/webhook", async (req, res) => {
  // Trả 200 ngay
  res.status(200).json({
    ok: true
  });

  // xử lý phía sau
  try {
    await processWebhook(req.body);
  } catch (error) {
    console.error(
      "❌ WEBHOOK ERROR:",
      error
    );
  }
});

// =====================================================
// WEBHOOK /zalo/webhook
// =====================================================

app.post("/zalo/webhook", async (req, res) => {
  res.status(200).json({
    ok: true
  });

  try {
    await processWebhook(req.body);
  } catch (error) {
    console.error(
      "❌ /zalo/webhook ERROR:",
      error
    );
  }
});

// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    bot: BOT_NAME,
    server: true,
    gemini: !!GEMINI_API_KEY,
    zalo: !!ZALO_BOT_TOKEN,
    model: GEMINI_MODEL,
    fallbackModels: GEMINI_FALLBACK_MODELS
  });
});

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>${BOT_NAME}</title>
<style>
body {
  font-family: Arial, sans-serif;
  max-width: 700px;
  margin: 40px auto;
  padding: 20px;
}
.ok {
  color: green;
}
</style>
</head>

<body>

<h1>🤖 ${BOT_NAME}</h1>

<p class="ok">
🟢 Server đang chạy.
</p>

<p>
🧠 AI: Google Gemini
</p>

<p>
🧠 Model: ${GEMINI_MODEL}
</p>

<p>
📡 Webhook:
<code>/webhook</code>
</p>

<p>
❤️ <a href="/health">Health Check</a>
</p>

</body>
</html>
  `);
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found"
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error(
    "❌ SERVER ERROR:",
    err
  );

  if (!res.headersSent) {
    res.status(500).json({
      ok: false,
      error: "Internal Server Error"
    });
  }
});

// =====================================================
// START
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
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
      `🌐 PORT: ${PORT}`
    );
    console.log(
      "🤖 AI: Google Gemini"
    );
    console.log(
      `🧠 MODEL: ${GEMINI_MODEL}`
    );
    console.log(
      "📡 WEBHOOK: /webhook"
    );
    console.log(
      "❤️ HEALTH: /health"
    );
    console.log(
      "=============================================="
    );
  }
);
