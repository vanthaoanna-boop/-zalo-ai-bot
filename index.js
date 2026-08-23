const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// =====================================================
// CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;

const ZALO_BOT_TOKEN = (process.env.ZALO_BOT_TOKEN || "").trim();
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const ADMIN_ID = (process.env.ADMIN_ID || "").trim();

// QUAN TRỌNG:
// Không lấy model cũ từ AI_MODEL nữa nếu biến đó đang bị sai.
// Model chính:
const AI_MODEL = "llama-3.1-8b-instant";

// Model dự phòng:
const AI_MODEL_BACKUP = "llama-3.3-70b-versatile";

// =====================================================
// STARTUP
// =====================================================

console.log("");
console.log("========================================");
console.log("🤖 ZALO GROQ AI BOT");
console.log("========================================");

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
  ADMIN_ID ? "OK" : "⚠️ CHƯA CÓ"
);

console.log("AI MODEL:", AI_MODEL);
console.log("BACKUP MODEL:", AI_MODEL_BACKUP);

console.log("================================");
console.log("");

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Zalo Groq AI Bot</title>
      </head>

      <body>
        <h2>🤖 Zalo Groq AI Bot</h2>

        <p>🟢 Server đang chạy</p>

        <p>
          AI:
          <b>${AI_MODEL}</b>
        </p>

        <p>
          Backup:
          <b>${AI_MODEL_BACKUP}</b>
        </p>
      </body>
    </html>
  `);
});

// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    zalo: !!ZALO_BOT_TOKEN,
    groq: !!GROQ_API_KEY,
    model: AI_MODEL,
    backup_model: AI_MODEL_BACKUP
  });
});

// =====================================================
// GROQ
// =====================================================

async function callGroq(model, text) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },

      body: JSON.stringify({
        model,

        messages: [
          {
            role: "system",
            content:
              "Bạn là trợ lý AI của bot Zalo. " +
              "Trả lời bằng tiếng Việt, tự nhiên, thân thiện, " +
              "chính xác và không dài dòng nếu không cần thiết."
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

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `Groq HTTP ${response.status}`;

    const error = new Error(message);

    error.status = response.status;
    error.code = data?.error?.code || "";
    error.data = data;

    throw error;
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "Groq không trả về nội dung."
    );
  }

  return answer.trim();
}

// =====================================================
// ASK GROQ
// =====================================================

async function askGroq(text) {
  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY chưa được cấu hình trên Render."
    );
  }

  // -----------------------------------------------
  // LẦN 1
  // -----------------------------------------------

  try {
    console.log(
      `🤖 GROQ: đang dùng ${AI_MODEL}`
    );

    const answer = await callGroq(
      AI_MODEL,
      text
    );

    console.log(
      `✅ GROQ OK: ${AI_MODEL}`
    );

    return answer;

  } catch (error) {

    console.error(
      `❌ GROQ ${AI_MODEL}:`,
      error.message
    );

    console.error(
      "GROQ DETAIL:",
      JSON.stringify(
        error.data || {},
        null,
        2
      )
    );

    // ---------------------------------------------
    // Nếu model không tồn tại / không có quyền
    // thì thử model backup
    // ---------------------------------------------

    if (
      error.code === "model_not_found" ||
      error.status === 400 ||
      error.status === 404 ||
      error.status === 403
    ) {

      console.log(
        `🔄 Thử model dự phòng: ${AI_MODEL_BACKUP}`
      );

      try {

        const answer = await callGroq(
          AI_MODEL_BACKUP,
          text
        );

        console.log(
          `✅ GROQ BACKUP OK: ${AI_MODEL_BACKUP}`
        );

        return answer;

      } catch (backupError) {

        console.error(
          `❌ GROQ BACKUP ${AI_MODEL_BACKUP}:`,
          backupError.message
        );

        console.error(
          "GROQ BACKUP DETAIL:",
          JSON.stringify(
            backupError.data || {},
            null,
            2
          )
        );

        throw new Error(
          `Groq không dùng được cả 2 model. ` +
          `Model 1: ${error.message} | ` +
          `Model 2: ${backupError.message}`
        );
      }
    }

    throw error;
  }
}

// =====================================================
// SEND ZALO MESSAGE
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

  const messageText =
    String(text).substring(0, 2000);

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
          user_id: String(userId)
        },

        message: {
          text: messageText
        }
      })
    }
  );

  const data = await response.json();

  console.log(
    "📤 ZALO RESPONSE:",
    JSON.stringify(data)
  );

  // Zalo thường trả HTTP 200 nhưng error != 0
  if (
    !response.ok ||
    data?.error !== 0
  ) {

    // ---------------------------------------------
    // TOKEN ZALO SAI / HẾT HẠN
    // ---------------------------------------------

    if (
      data?.error === -216
    ) {

      throw new Error(
        "ZALO_TOKEN_INVALID"
      );
    }

    throw new Error(
      data?.message ||
      data?.error_name ||
      `Zalo HTTP ${response.status}`
    );
  }

  return data;
}

// =====================================================
// GET USER ID
// =====================================================

function getUserId(body) {

  return (
    body?.message?.from?.id ||

    body?.sender?.id ||

    body?.user_id ||

    body?.message?.chat?.id ||

    null
  );
}

// =====================================================
// GET MESSAGE TEXT
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
// IS BOT MESSAGE
// =====================================================

function isBotMessage(body) {

  return (
    body?.message?.from?.is_bot === true ||
    body?.sender?.is_bot === true
  );
}

// =====================================================
// PROCESS ZALO MESSAGE
// =====================================================

async function processZaloMessage(body) {

  console.log("================================");
  console.log("📩 ZALO WEBHOOK");

  console.log(
    JSON.stringify(
      body,
      null,
      2
    )
  );

  const text =
    getMessageText(body);

  if (!text) {

    console.log(
      "⚠️ Không có text -> bỏ qua"
    );

    return;
  }

  if (isBotMessage(body)) {

    console.log(
      "🤖 Tin từ bot -> bỏ qua"
    );

    return;
  }

  const userId =
    getUserId(body);

  console.log(
    "🆔 USER ID:",
    userId
  );

  console.log(
    "💬 TEXT:",
    text
  );

  if (!userId) {

    console.error(
      "❌ Không tìm thấy USER ID"
    );

    return;
  }

  const command =
    text.trim().toLowerCase();

  // =================================================
  // COMMAND /PING
  // =================================================

  if (command === "/ping") {

    try {

      await sendZaloMessage(
        userId,
        "🏓 Pong!\nBot đang hoạt động."
      );

    } catch (error) {

      console.error(
        "❌ ZALO:",
        error.message
      );
    }

    return;
  }

  // =================================================
  // COMMAND /ID
  // =================================================

  if (command === "/id") {

    try {

      await sendZaloMessage(
        userId,
        `🆔 User ID:\n${userId}`
      );

    } catch (error) {

      console.error(
        "❌ ZALO:",
        error.message
      );
    }

    return;
  }

  // =================================================
  // COMMAND /ADMIN
  // =================================================

  if (
    command === "/admin" ||
    command === "/adminid"
  ) {

    if (
      ADMIN_ID &&
      userId !== ADMIN_ID
    ) {

      try {

        await sendZaloMessage(
          userId,
          "⛔ Bạn không phải admin."
        );

      } catch (error) {

        console.error(
          "❌ ZALO:",
          error.message
        );
      }

      return;
    }

    try {

      await sendZaloMessage(
        userId,
        `👑 ADMIN ID:\n${userId}`
      );

    } catch (error) {

      console.error(
        "❌ ZALO:",
        error.message
      );
    }

    return;
  }

  // =================================================
  // ASK AI
  // =================================================

  console.log(
    "🤖 Đang hỏi Groq AI..."
  );

  let answer;

  try {

    answer =
      await askGroq(text);

    console.log(
      "🤖 GROQ TRẢ LỜI:"
    );

    console.log(answer);

  } catch (error) {

    console.error(
      "❌ GROQ FINAL ERROR:",
      error.message
    );

    // Không gửi Zalo nếu token đã chết,
    // vì gửi tiếp cũng sẽ lỗi -216.

    if (
      error.message ===
      "ZALO_TOKEN_INVALID"
    ) {
      return;
    }

    try {

      await sendZaloMessage(
        userId,
        "❌ AI đang lỗi. Kiểm tra GROQ_API_KEY hoặc model trên Render."
      );

    } catch (zaloError) {

      console.error(
        "❌ Không gửi được thông báo lỗi Zalo:",
        zaloError.message
      );
    }

    return;
  }

  // =================================================
  // SEND AI ANSWER
  // =================================================

  try {

    await sendZaloMessage(
      userId,
      answer
    );

    console.log(
      "✅ ĐÃ GỬI CÂU TRẢ LỜI"
    );

  } catch (error) {

    console.error(
      "❌ ZALO SEND ERROR:",
      error.message
    );

    if (
      error.message ===
      "ZALO_TOKEN_INVALID"
    ) {

      console.error("");
      console.error(
        "🚨🚨🚨 ZALO ACCESS TOKEN KHÔNG HỢP LỆ 🚨🚨🚨"
      );
      console.error(
        "Hãy tạo/cấp lại Access Token của Zalo OA."
      );
      console.error("");
    }
  }

  console.log("================================");
}

// =====================================================
// WEBHOOK
// =====================================================

app.post("/webhook", async (req, res) => {

  // Trả 200 ngay cho Zalo
  res.status(200).json({
    ok: true
  });

  try {

    await processZaloMessage(
      req.body
    );

  } catch (error) {

    console.error(
      "❌ WEBHOOK ERROR:",
      error
    );
  }
});

// =====================================================
// /zalo/webhook
// =====================================================

app.post("/zalo/webhook", async (req, res) => {

  res.status(200).json({
    ok: true
  });

  try {

    await processZaloMessage(
      req.body
    );

  } catch (error) {

    console.error(
      "❌ /zalo/webhook ERROR:",
      error
    );
  }
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

app.use(
  (err, req, res, next) => {

    console.error(
      "❌ SERVER ERROR:",
      err
    );

    if (!res.headersSent) {

      res.status(500).json({
        ok: false
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log("========================================");
    console.log(
      `🚀 SERVER RUNNING ON PORT ${PORT}`
    );
    console.log("🟢 BOT SERVER: ON");
    console.log(
      `🤖 AI MODEL: ${AI_MODEL}`
    );
    console.log(
      `🔄 BACKUP: ${AI_MODEL_BACKUP}`
    );
    console.log("========================================");
    console.log("");
  }
);
