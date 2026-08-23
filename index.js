const express = require("express");

const app = express();

app.use(express.json({ limit: "2mb" }));

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 10000;

const ZALO_BOT_TOKEN =
  (process.env.ZALO_BOT_TOKEN || "").trim();

const GEMINI_API_KEY =
  (process.env.GEMINI_API_KEY || "").trim();

const ADMIN_ID =
  (process.env.ADMIN_ID || "").trim();

const AI_MODEL =
  (process.env.AI_MODEL || "gemini-2.5-flash").trim();

const BOT_NAME =
  process.env.BOT_NAME || "Bot Mặt Đất Màu Xanh";


// ============================================================
// BOT STATUS
// ============================================================

let botEnabled = true;


// ============================================================
// MEMORY RULES
// ============================================================
//
// Muốn thêm câu ghi nhớ sau này:
//
// {
//   patterns: [
//     "câu muốn nhận diện",
//     "câu tương đồng"
//   ],
//   answer: "câu bot phải trả lời"
// }
//
// ============================================================

const MEMORY_RULES = [

  {
    patterns: [
      "ai tạo ra bot mặt đất màu xanh",
      "ai tao ra bot mat dat mau xanh",
      "ai tạo bot mặt đất màu xanh",
      "ai tao bot mat dat mau xanh",
      "ai làm bot mặt đất màu xanh",
      "ai lam bot mat dat mau xanh",
      "bot mặt đất màu xanh do ai tạo",
      "bot mat dat mau xanh do ai tao",
      "bot này do ai tạo",
      "bot nay do ai tao",
      "ai tạo ra bot này",
      "ai tao ra bot nay"
    ],

    answer: "An Na & Hoàng Vũ"
  }

];


// ============================================================
// COMMAND SYSTEM
// ============================================================
//
// Sau này thêm lệnh chỉ cần thêm:
//
// COMMANDS["/tenlenh"] = async ({ userId, text }) => {
//   await sendZaloMessage(userId, "Nội dung");
// };
//
// ============================================================

const COMMANDS = {};


// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(text) {

  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

}


// ============================================================
// CHECK MEMORY
// ============================================================

function checkMemory(text) {

  const normalized =
    normalizeText(text);

  for (const rule of MEMORY_RULES) {

    for (const pattern of rule.patterns) {

      const normalizedPattern =
        normalizeText(pattern);

      if (
        normalized === normalizedPattern ||
        normalized.includes(normalizedPattern) ||
        normalizedPattern.includes(normalized)
      ) {

        return rule.answer;

      }

    }

  }

  return null;
}


// ============================================================
// GET USER ID
// ============================================================

function getUserId(body) {

  return (
    body?.message?.from?.id ||
    body?.message?.from?.user_id ||
    body?.sender?.id ||
    body?.user_id ||
    body?.message?.chat?.id ||
    null
  );

}


// ============================================================
// GET MESSAGE TEXT
// ============================================================

function getMessageText(body) {

  return (
    body?.message?.text ||
    body?.message?.message?.text ||
    body?.text ||
    ""
  );

}


// ============================================================
// MASK SECRET
// ============================================================

function maskSecret(value) {

  if (!value) {
    return "MISSING";
  }

  if (value.length <= 8) {
    return "********";
  }

  return (
    value.slice(0, 4) +
    "********" +
    value.slice(-4)
  );

}


// ============================================================
// SPLIT LONG MESSAGE
// ============================================================

function splitMessage(text, maxLength = 1800) {

  const result = [];

  let remaining =
    String(text || "").trim();

  while (remaining.length > maxLength) {

    let cut =
      remaining.lastIndexOf(
        "\n",
        maxLength
      );

    if (cut < maxLength * 0.5) {

      cut =
        remaining.lastIndexOf(
          " ",
          maxLength
        );

    }

    if (cut < maxLength * 0.5) {
      cut = maxLength;
    }

    result.push(
      remaining
        .slice(0, cut)
        .trim()
    );

    remaining =
      remaining
        .slice(cut)
        .trim();

  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}


// ============================================================
// GEMINI API CHECK
// ============================================================

async function checkGeminiKey() {

  if (!GEMINI_API_KEY) {

    return {
      ok: false,
      message:
        "GEMINI_API_KEY chưa được cấu hình"
    };

  }

  try {

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        method: "GET",

        headers: {
          "x-goog-api-key":
            GEMINI_API_KEY
        }
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      return {
        ok: false,

        message:
          data?.error?.message ||
          `Gemini HTTP ${response.status}`
      };

    }

    const models =
      data?.models || [];

    const wantedModel =
      `models/${AI_MODEL}`;

    const exists =
      models.some(
        model =>
          model?.name === wantedModel
      );

    return {
      ok: true,
      modelExists: exists,
      models
    };

  } catch (error) {

    return {
      ok: false,
      message: error.message
    };

  }

}


// ============================================================
// ASK GEMINI
// ============================================================

async function askGemini(text) {

  if (!GEMINI_API_KEY) {

    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình"
    );

  }

  const response = await fetch(

    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`,

    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "x-goog-api-key":
          GEMINI_API_KEY
      },

      body: JSON.stringify({

        system_instruction: {

          parts: [

            {
              text:
                `Bạn là trợ lý AI của ${BOT_NAME}.

Hãy trả lời bằng tiếng Việt.
Nói chuyện tự nhiên, thân thiện.
Trả lời đúng trọng tâm.
Không tự nhận mình là con người.
Nếu người dùng hỏi thông tin mà bạn không biết thì nói rõ là không biết.
`
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

          temperature: 0.7,

          maxOutputTokens: 1024

        }

      })

    }

  );

  const data =
    await response.json();

  console.log(
    "🤖 GEMINI HTTP:",
    response.status
  );

  if (!response.ok) {

    console.error(
      "❌ GEMINI ERROR:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(

      data?.error?.message ||
      `Gemini HTTP ${response.status}`

    );

  }

  const answer =
    data
      ?.candidates?.[0]
      ?.content
      ?.parts
      ?.map(part => part?.text || "")
      .join("")
      .trim();

  if (!answer) {

    throw new Error(
      "Gemini không trả về nội dung"
    );

  }

  return answer;

}


// ============================================================
// SEND ZALO MESSAGE
// ============================================================

async function sendZaloMessage(
  userId,
  text
) {

  if (!ZALO_BOT_TOKEN) {

    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình"
    );

  }

  if (!userId) {

    throw new Error(
      "Không tìm thấy user_id"
    );

  }

  const chunks =
    splitMessage(text);

  for (const chunk of chunks) {

    const response =
      await fetch(
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
                String(chunk)

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

  }

}


// ============================================================
// HELP
// ============================================================

function getHelp() {

  return `
🤖 ${BOT_NAME}

📌 LỆNH:

/help
→ Xem danh sách lệnh.

/on
→ Bật bot.

/off
→ Tắt bot.

/ping
→ Kiểm tra bot.

/id
→ Xem User ID.

/ai
→ Kiểm tra Gemini.

/status
→ Kiểm tra hệ thống.

/admin
→ Kiểm tra Admin ID.

/memory
→ Kiểm tra bộ nhớ.

💬 Ngoài các lệnh trên:
Bạn cứ nhắn bất kỳ câu gì,
bot sẽ dùng Gemini để trả lời.

🟢 Trạng thái:
${botEnabled ? "BOT ĐANG BẬT" : "BOT ĐANG TẮT"}
`.trim();

}


// ============================================================
// COMMANDS
// ============================================================

COMMANDS["/help"] =
async ({ userId }) => {

  await sendZaloMessage(
    userId,
    getHelp()
  );

};


COMMANDS["/on"] =
async ({ userId }) => {

  botEnabled = true;

  await sendZaloMessage(
    userId,
    "🟢 Bot đã bật!"
  );

};


COMMANDS["/off"] =
async ({ userId }) => {

  botEnabled = false;

  await sendZaloMessage(
    userId,
    "🔴 Bot đã tắt.\n\nGửi /on để bật lại."
  );

};


COMMANDS["/ping"] =
async ({ userId }) => {

  await sendZaloMessage(
    userId,
    "🏓 Pong!\n🟢 Bot đang hoạt động."
  );

};


COMMANDS["/id"] =
async ({ userId }) => {

  await sendZaloMessage(
    userId,
    `🆔 User ID của bạn:\n${userId}`
  );

};


COMMANDS["/ai"] =
async ({ userId }) => {

  const result =
    await checkGeminiKey();

  if (!result.ok) {

    await sendZaloMessage(
      userId,

      `🔴 GEMINI LỖI

${result.message}`
    );

    return;
  }

  await sendZaloMessage(
    userId,

    `🟢 GEMINI OK

Model:
${AI_MODEL}

API Key:
Hợp lệ`
  );

};


COMMANDS["/status"] =
async ({ userId }) => {

  const gemini =
    await checkGeminiKey();

  await sendZaloMessage(
    userId,

    `
📊 BOT STATUS

🖥 Server:
🟢 Online

🤖 AI:
${gemini.ok ? "🟢 OK" : "🔴 LỖI"}

🧠 Model:
${AI_MODEL}

🔑 Gemini:
${gemini.ok ? "🟢 Hợp lệ" : "🔴 " + gemini.message}

💬 Zalo:
${ZALO_BOT_TOKEN ? "🟢 Đã cấu hình" : "🔴 Thiếu token"}

🤖 Bot:
${botEnabled ? "🟢 ON" : "🔴 OFF"}
`.trim()
  );

};


COMMANDS["/memory"] =
async ({ userId }) => {

  await sendZaloMessage(
    userId,

    `🧠 Bộ nhớ đang hoạt động.

📚 Số câu ghi nhớ:
${MEMORY_RULES.length}`
  );

};


COMMANDS["/admin"] =
async ({ userId }) => {

  if (
    ADMIN_ID &&
    String(userId) !==
      String(ADMIN_ID)
  ) {

    await sendZaloMessage(
      userId,
      "⛔ Bạn không phải admin."
    );

    return;
  }

  await sendZaloMessage(
    userId,

    `👑 ADMIN ID:

${ADMIN_ID || userId}`
  );

};


// ============================================================
// PROCESS ZALO MESSAGE
// ============================================================

async function processMessage(body) {

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    "📩 ZALO EVENT"
  );

  console.log(
    JSON.stringify(
      body,
      null,
      2
    )
  );

  const text =
    getMessageText(body)
      .trim();

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

  // Không có text
  if (!text) {

    console.log(
      "⚠️ Không có text."
    );

    return;
  }

  // Không có user
  if (!userId) {

    console.log(
      "❌ Không tìm thấy user ID."
    );

    return;
  }

  // Tin từ bot
  if (
    body?.message?.from?.is_bot === true
  ) {

    console.log(
      "🤖 Tin từ bot -> bỏ qua."
    );

    return;
  }


  // ==========================================================
  // COMMAND
  // ==========================================================

  const command =
    text
      .split(/\s+/)[0]
      .toLowerCase();

  if (COMMANDS[command]) {

    console.log(
      "⚙️ COMMAND:",
      command
    );

    try {

      await COMMANDS[command]({
        userId,
        text,
        body
      });

    } catch (error) {

      console.error(
        "❌ COMMAND ERROR:",
        error.message
      );

    }

    return;
  }


  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (!botEnabled) {

    console.log(
      "🔴 Bot đang OFF."
    );

    return;
  }


  // ==========================================================
  // MEMORY
  // ==========================================================

  const memoryAnswer =
    checkMemory(text);

  if (memoryAnswer) {

    console.log(
      "🧠 MEMORY HIT"
    );

    console.log(
      "↳",
      memoryAnswer
    );

    try {

      await sendZaloMessage(
        userId,
        memoryAnswer
      );

    } catch (error) {

      console.error(
        "❌ MEMORY SEND ERROR:",
        error.message
      );

    }

    return;
  }


  // ==========================================================
  // GEMINI
  // ==========================================================

  console.log(
    "🤖 Đang hỏi Gemini..."
  );

  try {

    const answer =
      await askGemini(text);

    console.log(
      "🤖 GEMINI TRẢ LỜI:"
    );

    console.log(answer);


    // ========================================================
    // SEND TO ZALO
    // ========================================================

    await sendZaloMessage(
      userId,
      answer
    );

    console.log(
      "✅ Đã gửi trả lời."
    );

  } catch (error) {

    console.error(
      "❌ GEMINI ERROR:",
      error.message
    );

    try {

      await sendZaloMessage(
        userId,

        `❌ Gemini đang lỗi.

${error.message}

Kiểm tra lại GEMINI_API_KEY trên Render.`
      );

    } catch (zaloError) {

      console.error(
        "❌ ZALO ERROR:",
        zaloError.message
      );

    }

  }

  console.log(
    "================================"
  );

}


// ============================================================
// WEBHOOK
// ============================================================

app.post(
  "/webhook",
  async (req, res) => {

    // Trả 200 ngay
    res.status(200).json({
      ok: true
    });

    try {

      await processMessage(
        req.body
      );

    } catch (error) {

      console.error(
        "❌ WEBHOOK ERROR:",
        error
      );

    }

  }
);


// ============================================================
// SECOND WEBHOOK
// ============================================================

app.post(
  "/zalo/webhook",
  async (req, res) => {

    res.status(200).json({
      ok: true
    });

    try {

      await processMessage(
        req.body
      );

    } catch (error) {

      console.error(
        "❌ /zalo/webhook ERROR:",
        error
      );

    }

  }
);


// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.status(200).send(`

<!DOCTYPE html>

<html lang="vi">

<head>

<meta charset="UTF-8">

<title>${BOT_NAME}</title>

</head>

<body>

<h2>🤖 ${BOT_NAME}</h2>

<p>🟢 Server đang chạy.</p>

<p>
AI:
<b>Gemini</b>
</p>

<p>
Model:
<b>${AI_MODEL}</b>
</p>

<p>
Webhook:
<code>/webhook</code>
</p>

</body>

</html>

`);

  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  async (req, res) => {

    const gemini =
      await checkGeminiKey();

    res.json({

      ok:
        gemini.ok &&
        !!ZALO_BOT_TOKEN,

      server: true,

      ai: {

        provider:
          "Google Gemini",

        model:
          AI_MODEL,

        configured:
          !!GEMINI_API_KEY,

        valid:
          gemini.ok

      },

      zalo: {

        configured:
          !!ZALO_BOT_TOKEN

      },

      bot: {

        enabled:
          botEnabled

      }

    });

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
      "❌ SERVER ERROR:",
      err
    );

    if (
      !res.headersSent
    ) {

      res
        .status(500)
        .json({
          ok: false
        });

    }

  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  async () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      `🤖 ${BOT_NAME}`
    );

    console.log(
      "========================================"
    );

    console.log(
      "🚀 PORT:",
      PORT
    );

    console.log(
      "🟢 SERVER: ON"
    );

    console.log(
      "🤖 AI: Google Gemini"
    );

    console.log(
      "🧠 MODEL:",
      AI_MODEL
    );

    console.log(
      "🔑 GEMINI KEY:",
      maskSecret(
        GEMINI_API_KEY
      )
    );

    console.log(
      "🔑 ZALO TOKEN:",
      maskSecret(
        ZALO_BOT_TOKEN
      )
    );

    console.log(
      "👑 ADMIN:",
      ADMIN_ID
        ? "Đã cấu hình"
        : "Chưa cấu hình"
    );

    console.log(
      "========================================"
    );


    // ========================================================
    // TEST GEMINI
    // ========================================================

    console.log(
      "🔍 Đang kiểm tra Gemini..."
    );

    const gemini =
      await checkGeminiKey();

    if (gemini.ok) {

      console.log(
        "🟢 GEMINI API KEY: OK"
      );

      if (
        gemini.modelExists
      ) {

        console.log(
          `🟢 MODEL ${AI_MODEL}: OK`
        );

      } else {

        console.log(
          `⚠️ Không tìm thấy model ${AI_MODEL}`
        );

      }

    } else {

      console.error(
        "🔴 GEMINI:",
        gemini.message
      );

    }


    console.log(
      "========================================"
    );

    console.log(
      "🟢 BOT READY"
    );

    console.log(
      "========================================"
    );

  }
);
