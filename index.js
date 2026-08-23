const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ===============================
// CONFIG
// ===============================
const PORT = process.env.PORT || 10000;

const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Không bắt buộc.
// Nếu chưa có ADMIN_ID thì để trống cũng được.
const ADMIN_ID = process.env.ADMIN_ID || "";

// Model Groq
const AI_MODEL =
  process.env.AI_MODEL || "llama-3.3-70b-versatile";

// ===============================
// STARTUP
// ===============================
console.log("================================");
console.log("🤖 ZALO GROQ AI BOT");
console.log("================================");

console.log(
  "ZALO_BOT_TOKEN:",
  ZALO_BOT_TOKEN ? "OK" : "❌ THIẾU"
);

console.log(
  "GROQ_API_KEY:",
  GROQ_API_KEY ? "OK" : "❌ THIẾU"
);

console.log(
  "ADMIN_ID:",
  ADMIN_ID ? "OK" : "⚠️ Chưa có"
);

console.log("AI MODEL:", AI_MODEL);

console.log("================================");

// ===============================
// HOME / HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.status(200).send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Zalo Groq AI Bot</title>
      </head>
      <body>
        <h2>🤖 Zalo Groq AI Bot</h2>
        <p>🟢 Server đang chạy.</p>
        <p>AI: ${AI_MODEL}</p>
      </body>
    </html>
  `);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    zalo: !!ZALO_BOT_TOKEN,
    groq: !!GROQ_API_KEY,
    model: AI_MODEL
  });
});

// ===============================
// TEST GROQ
// ===============================
async function askGroq(text) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY chưa được cấu hình");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,

        messages: [
          {
            role: "system",
            content:
              "Bạn là trợ lý AI của một bot Zalo. Hãy trả lời bằng tiếng Việt, thân thiện, tự nhiên và ngắn gọn khi phù hợp."
          },
          {
            role: "user",
            content: String(text)
          }
        ],

        temperature: 0.7,
        max_tokens: 1024
      })
    }
  );

  const data = await response.json();

  // Log lỗi Groq để dễ kiểm tra Render
  if (!response.ok) {
    console.error("❌ GROQ ERROR:");
    console.error(JSON.stringify(data, null, 2));

    const message =
      data?.error?.message ||
      `Groq HTTP ${response.status}`;

    throw new Error(message);
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("Groq không trả về nội dung");
  }

  return answer.trim();
}

// ===============================
// SEND MESSAGE TO ZALO
// ===============================
async function sendZaloMessage(userId, text) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error("ZALO_BOT_TOKEN chưa được cấu hình");
  }

  if (!userId) {
    throw new Error("Không tìm thấy user_id");
  }

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
          text: String(text)
        }
      })
    }
  );

  const data = await response.json();

  console.log(
    "📤 ZALO RESPONSE:",
    JSON.stringify(data)
  );

  if (!response.ok || data?.error !== 0) {
    throw new Error(
      data?.message ||
      data?.error_name ||
      `Zalo HTTP ${response.status}`
    );
  }

  return data;
}

// ===============================
// GET USER ID FROM ZALO EVENT
// ===============================
function getUserId(body) {
  return (
    body?.message?.from?.id ||
    body?.sender?.id ||
    body?.user_id ||
    body?.message?.chat?.id ||
    null
  );
}

// ===============================
// GET MESSAGE TEXT
// ===============================
function getMessageText(body) {
  return (
    body?.message?.text ||
    body?.message?.message?.text ||
    body?.text ||
    ""
  );
}

// ===============================
// ZALO WEBHOOK
// ===============================
app.post("/webhook", async (req, res) => {
  // Trả 200 ngay cho Zalo
  res.status(200).json({
    ok: true
  });

  try {
    console.log("================================");
    console.log("📩 ZALO WEBHOOK");
    console.log(JSON.stringify(req.body, null, 2));

    const body = req.body;

    const eventName =
      body?.event_name ||
      body?.eventName ||
      "";

    // Chỉ xử lý tin nhắn text
    const text = getMessageText(body);

    if (!text) {
      console.log("⚠️ Không có text -> bỏ qua");
      return;
    }

    const userId = getUserId(body);

    console.log("🆔 USER ID:", userId);
    console.log("💬 TEXT:", text);

    if (!userId) {
      console.log("❌ Không tìm thấy user ID");
      return;
    }

    // Nếu chính bot gửi thì bỏ qua
    if (body?.message?.from?.is_bot === true) {
      console.log("🤖 Tin từ bot -> bỏ qua");
      return;
    }

    // ===============================
    // COMMANDS
    // ===============================

    const command = text.trim().toLowerCase();

    if (command === "/on") {
      await sendZaloMessage(
        userId,
        "🟢 Bot AI đã bật!\n\nBạn cứ nhắn câu hỏi cho mình nhé."
      );
      return;
    }

    if (command === "/off") {
      await sendZaloMessage(
        userId,
        "🔴 Bot đã tắt."
      );
      return;
    }

    if (command === "/ping") {
      await sendZaloMessage(
        userId,
        "🏓 Pong!\nBot đang hoạt động."
      );
      return;
    }

    if (command === "/id") {
      await sendZaloMessage(
        userId,
        `🆔 User ID của bạn:\n${userId}`
      );
      return;
    }

    // ===============================
    // ADMIN COMMAND
    // ===============================

    if (
      command === "/admin" ||
      command === "/adminid"
    ) {
      if (ADMIN_ID && userId !== ADMIN_ID) {
        await sendZaloMessage(
          userId,
          "⛔ Bạn không phải admin."
        );
        return;
      }

      await sendZaloMessage(
        userId,
        `👑 ADMIN ID:\n${userId}`
      );
      return;
    }

    // ===============================
    // ASK GROQ
    // ===============================

    console.log("🤖 Đang hỏi Groq AI...");

    let answer;

    try {
      answer = await askGroq(text);

      console.log("🤖 GROQ TRẢ LỜI:");
      console.log(answer);

    } catch (error) {
      console.error(
        "❌ GROQ ERROR:",
        error.message
      );

      await sendZaloMessage(
        userId,
        "❌ Groq đang lỗi hoặc GROQ_API_KEY không hợp lệ.\n\nKiểm tra lại GROQ_API_KEY trên Render nhé."
      );

      return;
    }

    // ===============================
    // SEND ANSWER TO ZALO
    // ===============================

    await sendZaloMessage(
      userId,
      answer
    );

    console.log("✅ Đã gửi câu trả lời");
    console.log("================================");

  } catch (error) {
    console.error(
      "❌ WEBHOOK ERROR:",
      error
    );
  }
});

// ===============================
// ALSO ACCEPT /zalo/webhook
// ===============================
app.post("/zalo/webhook", async (req, res) => {
  req.url = "/webhook";

  // Forward bằng cách xử lý trực tiếp
  res.status(200).json({
    ok: true
  });

  try {
    const body = req.body;

    const text = getMessageText(body);
    const userId = getUserId(body);

    if (!text || !userId) return;

    if (body?.message?.from?.is_bot === true) {
      return;
    }

    const answer = await askGroq(text);

    await sendZaloMessage(
      userId,
      answer
    );

  } catch (error) {
    console.error(
      "❌ /zalo/webhook ERROR:",
      error.message
    );
  }
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  console.error("❌ SERVER ERROR:", err);

  if (!res.headersSent) {
    res.status(500).json({
      ok: false
    });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log(
    `🚀 Bot server running on port ${PORT}`
  );
  console.log("🟢 Bot server: ON");
  console.log("🤖 AI:", AI_MODEL);
  console.log("================================");
});
