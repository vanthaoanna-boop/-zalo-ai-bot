const express = require("express");

const app = express();

app.use(
  express.json({
    limit: "2mb"
  })
);

// =====================================================
// CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;

const ZALO_BOT_TOKEN =
  process.env.ZALO_BOT_TOKEN || "";

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || "";

const ADMIN_ID =
  process.env.ADMIN_ID || "";

// Có thể để trống.
// Code sẽ tự tìm model khả dụng.
const REQUESTED_MODEL =
  process.env.AI_MODEL || "llama-3.3-70b-versatile";


// =====================================================
// GLOBAL STATE
// =====================================================

let ACTIVE_MODEL = REQUESTED_MODEL;

let GROQ_STATUS = {
  ok: false,
  message: "Chưa kiểm tra",
  models: []
};


// =====================================================
// SAFE LOG
// Không bao giờ in API key/token ra log
// =====================================================

function maskSecret(value) {
  if (!value) return "THIẾU";

  if (value.length <= 8) {
    return "********";
  }

  return (
    value.substring(0, 4) +
    "********" +
    value.substring(value.length - 4)
  );
}


// =====================================================
// GROQ - LẤY DANH SÁCH MODEL
// =====================================================

async function getGroqModels() {
  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY chưa được cấu hình trên Render"
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/models",
    {
      method: "GET",

      headers: {
        "Authorization":
          `Bearer ${GROQ_API_KEY}`,

        "Content-Type":
          "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error(
      "❌ GROQ MODELS ERROR:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      `Groq HTTP ${response.status}`
    );
  }

  return Array.isArray(data?.data)
    ? data.data
    : [];
}


// =====================================================
// GROQ - KIỂM TRA API KEY + MODEL
// =====================================================

async function checkGroq() {
  try {
    console.log("");
    console.log("🔍 KIỂM TRA GROQ...");
    console.log(
      "🔑 GROQ_API_KEY:",
      maskSecret(GROQ_API_KEY)
    );

    const models =
      await getGroqModels();

    const modelIds =
      models
        .map(model => model?.id)
        .filter(Boolean);

    GROQ_STATUS.models = modelIds;

    console.log(
      `📦 Groq trả về ${modelIds.length} model`
    );

    // -------------------------------------------------
    // Ưu tiên model người dùng chọn
    // -------------------------------------------------

    const preferredModels = [
      REQUESTED_MODEL,

      "llama-3.3-70b-versatile",

      "llama-3.1-8b-instant",

      "openai/gpt-oss-120b",

      "openai/gpt-oss-20b"
    ];

    const availableModel =
      preferredModels.find(
        model => modelIds.includes(model)
      );

    // -------------------------------------------------
    // Nếu không có model ưu tiên
    // chọn model đầu tiên có khả năng chat
    // -------------------------------------------------

    if (!availableModel) {
      console.error(
        "❌ Không tìm thấy model phù hợp."
      );

      console.error(
        "📦 MODEL KHẢ DỤNG:"
      );

      console.error(
        modelIds.join("\n")
      );

      GROQ_STATUS = {
        ok: false,

        message:
          "API key hoạt động nhưng không tìm thấy model chat phù hợp",

        models: modelIds
      };

      return false;
    }

    ACTIVE_MODEL =
      availableModel;

    GROQ_STATUS = {
      ok: true,

      message:
        "Groq API key hoạt động",

      models: modelIds
    };

    console.log(
      "✅ GROQ API KEY: OK"
    );

    console.log(
      "🤖 GROQ MODEL:",
      ACTIVE_MODEL
    );

    return true;

  } catch (error) {

    GROQ_STATUS = {
      ok: false,

      message:
        error.message,

      models: []
    };

    console.error(
      "❌ GROQ KEY ERROR:",
      error.message
    );

    return false;
  }
}


// =====================================================
// GROQ - HỎI AI
// =====================================================

async function askGroq(text) {

  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY chưa cấu hình"
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${GROQ_API_KEY}`
      },

      body: JSON.stringify({

        model: ACTIVE_MODEL,

        messages: [

          {
            role: "system",

            content:
              "Bạn là trợ lý AI của bot Zalo. " +
              "Trả lời bằng tiếng Việt, tự nhiên, thân thiện, " +
              "chính xác và không quá dài nếu người dùng không yêu cầu."
          },

          {
            role: "user",

            content:
              String(text)
          }

        ],

        temperature: 0.7,

        max_tokens: 1024
      })
    }
  );

  const data =
    await response.json();

  if (!response.ok) {

    console.error(
      "❌ GROQ CHAT ERROR:"
    );

    console.error(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      data?.error?.message ||
      `Groq HTTP ${response.status}`
    );
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "Groq không trả về nội dung"
    );
  }

  return answer.trim();
}


// =====================================================
// ZALO - GỬI TIN NHẮN
// =====================================================

async function sendZaloMessage(
  userId,
  text
) {

  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa cấu hình"
    );
  }

  if (!userId) {
    throw new Error(
      "Không có user_id"
    );
  }

  const response = await fetch(
    "https://openapi.zalo.me/v3.0/oa/message/cs",
    {
      method: "POST",

      headers: {

        "Content-Type":
          "application/json",

        "access_token":
          ZALO_BOT_TOKEN
      },

      body: JSON.stringify({

        recipient: {

          user_id:
            String(userId)

        },

        message: {

          text:
            String(text)

        }

      })
    }
  );

  const data =
    await response.json();

  console.log(
    "📤 ZALO RESPONSE:",
    JSON.stringify(data)
  );

  // Zalo có thể trả HTTP 200
  // nhưng bên trong error != 0
  if (
    !response.ok ||
    data?.error !== 0
  ) {

    throw new Error(
      data?.message ||
      data?.error_name ||
      `Zalo HTTP ${response.status}`
    );
  }

  return data;
}


// =====================================================
// PARSE ZALO USER ID
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
// PARSE TEXT
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
// CHECK BOT MESSAGE
// =====================================================

function isBotMessage(body) {

  return (
    body?.message?.from?.is_bot === true
  );
}


// =====================================================
// COMMAND HANDLER
// =====================================================

async function handleCommand(
  userId,
  text
) {

  const command =
    String(text)
      .trim()
      .toLowerCase();


  // /ping
  if (command === "/ping") {

    await sendZaloMessage(
      userId,
      "🏓 Pong!\nBot đang hoạt động."
    );

    return true;
  }


  // /id
  if (command === "/id") {

    await sendZaloMessage(
      userId,
      `🆔 User ID:\n${userId}`
    );

    return true;
  }


  // /on
  if (command === "/on") {

    await sendZaloMessage(
      userId,
      "🟢 Bot AI đang hoạt động."
    );

    return true;
  }


  // /off
  if (command === "/off") {

    await sendZaloMessage(
      userId,
      "🔴 Lệnh tắt bot hiện chưa được bật trong bản này."
    );

    return true;
  }


  // /model
  if (command === "/model") {

    await sendZaloMessage(
      userId,
      `🤖 Model đang dùng:\n${ACTIVE_MODEL}`
    );

    return true;
  }


  // /status
  if (command === "/status") {

    const zalo =
      ZALO_BOT_TOKEN
        ? "✅ Có token"
        : "❌ Thiếu token";

    const groq =
      GROQ_STATUS.ok
        ? "✅ Hoạt động"
        : "❌ Lỗi";

    await sendZaloMessage(
      userId,

      `🤖 BOT STATUS

Zalo: ${zalo}
Groq: ${groq}
AI: ${ACTIVE_MODEL}`
    );

    return true;
  }


  // /admin
  if (
    command === "/admin" ||
    command === "/adminid"
  ) {

    if (
      ADMIN_ID &&
      userId !== ADMIN_ID
    ) {

      await sendZaloMessage(
        userId,
        "⛔ Bạn không phải admin."
      );

      return true;
    }

    await sendZaloMessage(
      userId,
      `👑 ADMIN ID:\n${userId}`
    );

    return true;
  }


  return false;
}


// =====================================================
// XỬ LÝ WEBHOOK CHUNG
// =====================================================

async function processWebhook(
  body
) {

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    "📩 ZALO WEBHOOK"
  );

  console.log(
    JSON.stringify(
      body,
      null,
      2
    )
  );


  // ---------------------------------------------------
  // Bỏ qua tin bot
  // ---------------------------------------------------

  if (isBotMessage(body)) {

    console.log(
      "🤖 Tin từ bot -> bỏ qua"
    );

    return;
  }


  // ---------------------------------------------------
  // Lấy text
  // ---------------------------------------------------

  const text =
    getMessageText(body);


  if (!text) {

    console.log(
      "⚠️ Không có text -> bỏ qua"
    );

    return;
  }


  // ---------------------------------------------------
  // Lấy user
  // ---------------------------------------------------

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
      "❌ Không tìm thấy user ID"
    );

    return;
  }


  // ---------------------------------------------------
  // COMMAND
  // ---------------------------------------------------

  const handled =
    await handleCommand(
      userId,
      text
    );

  if (handled) {
    return;
  }


  // ---------------------------------------------------
  // CHECK GROQ
  // ---------------------------------------------------

  console.log(
    "🤖 Đang hỏi Groq..."
  );

  let answer;


  try {

    answer =
      await askGroq(text);

    console.log(
      "🤖 GROQ TRẢ LỜI:"
    );

    console.log(
      answer
    );

  } catch (error) {

    console.error(
      "❌ GROQ ERROR:",
      error.message
    );


    // -------------------------------------------------
    // Nếu model bị lỗi -> kiểm tra lại models
    // -------------------------------------------------

    if (
      error.message
        .toLowerCase()
        .includes("model")
    ) {

      console.log(
        "🔄 Model lỗi -> kiểm tra lại danh sách model..."
      );

      await checkGroq();

    }


    // -------------------------------------------------
    // Báo người dùng
    // -------------------------------------------------

    try {

      await sendZaloMessage(

        userId,

        "❌ AI đang lỗi.\n\n" +
        `Chi tiết: ${error.message}\n\n` +
        "Admin kiểm tra Render Logs nhé."

      );

    } catch (zaloError) {

      console.error(
        "❌ Không gửi được lỗi về Zalo:",
        zaloError.message
      );

    }

    return;
  }


  // ---------------------------------------------------
  // GỬI TRẢ LỜI
  // ---------------------------------------------------

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

    console.error(
      "⚠️ Kiểm tra ZALO_BOT_TOKEN trên Render."
    );
  }


  console.log(
    "================================"
  );
}


// =====================================================
// HOME
// =====================================================

app.get(
  "/",
  (req, res) => {

    res.status(200).send(`

      <html>

        <head>

          <meta charset="UTF-8">

          <title>
            Zalo Groq AI Bot
          </title>

        </head>

        <body>

          <h2>
            🤖 Zalo Groq AI Bot
          </h2>

          <p>
            🟢 Server đang chạy.
          </p>

          <p>
            🤖 AI:
            ${ACTIVE_MODEL}
          </p>

          <p>
            Groq:
            ${GROQ_STATUS.ok
              ? "OK"
              : "ERROR"}
          </p>

        </body>

      </html>

    `);

  }
);


// =====================================================
// HEALTH
// =====================================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      zalo:
        !!ZALO_BOT_TOKEN,

      groq:
        GROQ_STATUS.ok,

      model:
        ACTIVE_MODEL,

      groq_message:
        GROQ_STATUS.message,

      timestamp:
        new Date().toISOString()

    });

  }
);


// =====================================================
// GROQ DEBUG
// =====================================================
// KHÔNG trả API key.
// Chỉ trả trạng thái.
// =====================================================

app.get(
  "/debug/groq",
  async (req, res) => {

    const ok =
      await checkGroq();

    res.json({

      ok,

      model:
        ACTIVE_MODEL,

      message:
        GROQ_STATUS.message,

      model_count:
        GROQ_STATUS.models.length,

      models:
        GROQ_STATUS.models

    });

  }
);


// =====================================================
// WEBHOOK
// =====================================================

app.post(
  "/webhook",
  async (req, res) => {

    // Trả 200 ngay
    // tránh Zalo retry webhook

    res.status(200).json({
      ok: true
    });


    try {

      await processWebhook(
        req.body
      );

    } catch (error) {

      console.error(
        "❌ WEBHOOK ERROR:",
        error.message
      );

    }

  }
);


// =====================================================
// /zalo/webhook
// =====================================================

app.post(
  "/zalo/webhook",
  async (req, res) => {

    res.status(200).json({
      ok: true
    });


    try {

      await processWebhook(
        req.body
      );

    } catch (error) {

      console.error(
        "❌ /zalo/webhook ERROR:",
        error.message
      );

    }

  }
);


// =====================================================
// 404
// =====================================================

app.use(
  (req, res) => {

    res.status(404).json({

      ok: false,

      error:
        "Not found"

    });

  }
);


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
  async () => {

    console.log("");
    console.log(
      "================================"
    );

    console.log(
      "🤖 ZALO GROQ AI BOT"
    );

    console.log(
      "================================"
    );

    console.log(
      "🚀 PORT:",
      PORT
    );

    console.log(
      "🟢 SERVER: ON"
    );

    console.log(
      "🔑 ZALO TOKEN:",
      maskSecret(
        ZALO_BOT_TOKEN
      )
    );

    console.log(
      "🔑 GROQ KEY:",
      maskSecret(
        GROQ_API_KEY
      )
    );

    console.log(
      "🎯 REQUESTED MODEL:",
      REQUESTED_MODEL
    );

    console.log(
      "================================"
    );


    // -----------------------------------------------
    // TEST GROQ NGAY KHI SERVER START
    // -----------------------------------------------

    await checkGroq();


    console.log(
      "================================"
    );

    console.log(
      "🤖 ACTIVE MODEL:",
      ACTIVE_MODEL
    );

    console.log(
      "🟢 BOT SERVER: READY"
    );

    console.log(
      "================================"
    );

  }
);
