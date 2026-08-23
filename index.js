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

// Có thể để trống.
// Code sẽ tự tìm model Gemini Flash phù hợp.
const AI_MODEL =
  (process.env.AI_MODEL || "").trim();

const BOT_NAME =
  process.env.BOT_NAME ||
  "Bot Mặt Đất Màu Xanh";


// ============================================================
// BOT STATE
// ============================================================

let botEnabled = true;


// ============================================================
// GEMINI MODEL FALLBACK
// ============================================================

const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

let activeGeminiModel = null;


// ============================================================
// MEMORY
// ============================================================
//
// Muốn thêm câu ghi nhớ:
//
// {
//   patterns: [
//     "câu 1",
//     "câu 2"
//   ],
//   answer: "câu trả lời"
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
// MEMORY CHECK
// ============================================================

function checkMemory(text) {

  const normalized =
    normalizeText(text);

  for (const rule of MEMORY_RULES) {

    for (const pattern of rule.patterns) {

      const p =
        normalizeText(pattern);

      if (
        normalized === p ||
        normalized.includes(p) ||
        p.includes(normalized)
      ) {

        return rule.answer;

      }

    }

  }

  return null;
}


// ============================================================
// GET ZALO USER ID
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
// GET TEXT
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
// SPLIT ZALO MESSAGE
// ============================================================

function splitMessage(
  text,
  maxLength = 1800
) {

  const result = [];

  let remaining =
    String(text || "").trim();

  while (
    remaining.length > maxLength
  ) {

    let cut =
      remaining.lastIndexOf(
        "\n",
        maxLength
      );

    if (
      cut < maxLength * 0.5
    ) {

      cut =
        remaining.lastIndexOf(
          " ",
          maxLength
        );

    }

    if (
      cut < maxLength * 0.5
    ) {

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
// GEMINI LIST MODELS
// ============================================================

async function listGeminiModels() {

  if (!GEMINI_API_KEY) {

    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình"
    );

  }

  const response =
    await fetch(
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

    console.error(
      "❌ GEMINI LIST MODELS:",
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

  return data?.models || [];
}


// ============================================================
// CHOOSE GEMINI MODEL
// ============================================================

async function resolveGeminiModel() {

  if (activeGeminiModel) {
    return activeGeminiModel;
  }

  const models =
    await listGeminiModels();

  const usableModels =
    models.filter(model => {

      const methods =
        model?.supportedGenerationMethods ||
        [];

      return methods.includes(
        "generateContent"
      );

    });


  console.log(
    "📚 Gemini models có generateContent:"
  );

  for (
    const model of usableModels
  ) {

    console.log(
      "   -",
      model?.name
    );

  }


  // ----------------------------------------------------------
  // 1. Nếu AI_MODEL được cấu hình và tồn tại
  // ----------------------------------------------------------

  if (AI_MODEL) {

    const wanted =
      `models/${AI_MODEL}`;

    const found =
      usableModels.find(
        model =>
          model?.name === wanted
      );

    if (found) {

      activeGeminiModel =
        AI_MODEL;

      console.log(
        "🧠 MODEL ĐƯỢC CHỌN:",
        activeGeminiModel
      );

      return activeGeminiModel;

    }

    console.log(
      `⚠️ AI_MODEL "${AI_MODEL}" không khả dụng.`
    );

    console.log(
      "🔄 Đang tự chọn model khác..."
    );

  }


  // ----------------------------------------------------------
  // 2. Tự chọn model fallback
  // ----------------------------------------------------------

  for (
    const candidate
    of GEMINI_MODEL_FALLBACKS
  ) {

    const found =
      usableModels.find(
        model =>
          model?.name ===
          `models/${candidate}`
      );

    if (found) {

      activeGeminiModel =
        candidate;

      console.log(
        "🟢 AUTO MODEL:",
        activeGeminiModel
      );

      return activeGeminiModel;

    }

  }


  // ----------------------------------------------------------
  // 3. Không tìm được
  // ----------------------------------------------------------

  throw new Error(
    "API key Gemini không có model generateContent phù hợp."
  );

}


// ============================================================
// GEMINI ASK
// ============================================================

async function askGemini(text) {

  if (!GEMINI_API_KEY) {

    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình"
    );

  }

  const model =
    await resolveGeminiModel();


  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;


  const body = {

    // ĐÚNG FIELD GEMINI REST API
    systemInstruction: {

      parts: [

        {
          text:
`Bạn là trợ lý AI của ${BOT_NAME}.

Hãy trả lời bằng tiếng Việt.
Nói chuyện tự nhiên, thân thiện.
Trả lời ngắn gọn khi câu hỏi đơn giản.
Nếu người dùng hỏi chuyện bình thường thì trả lời như một người bạn.
Không tự bịa thông tin.
Nếu không biết thì nói rõ là không biết.

Bot có thể được mở rộng thêm các lệnh Free Fire và các chức năng khác trong tương lai.`
        }

      ]

    },

    contents: [

      {

        role: "user",

        parts: [

          {
            text:
              String(text)
          }

        ]

      }

    ]

  };


  const response =
    await fetch(
      url,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY

        },

        body:
          JSON.stringify(body)

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
      "❌ GEMINI DETAIL:",
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
      ?.content?.parts
      ?.map(
        part =>
          part?.text || ""
      )
      .join("")
      .trim();


  if (!answer) {

    console.error(
      "❌ GEMINI RESPONSE:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      "Gemini không trả về nội dung."
    );

  }


  return answer;

}


// ============================================================
// SEND ZALO
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


  for (
    const chunk
    of chunks
  ) {

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

          body:
            JSON.stringify({

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

📌 LỆNH

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
→ Xem trạng thái.

/memory
→ Xem bộ nhớ.

/admin
→ Xem Admin ID.

💬 NHẮN BẤT KỲ
→ Bot sẽ trả lời bằng Gemini.

🧠 GHI NHỚ
Hỏi:
"Ai tạo ra bot mặt đất màu xanh?"

Bot:
"An Na & Hoàng Vũ"

🚀 Sau này có thể thêm lệnh FF,
game và các chức năng khác.
`.trim();

}


// ============================================================
// COMMAND: HELP
// ============================================================

COMMANDS["/help"] =
async ({
  userId
}) => {

  await sendZaloMessage(
    userId,
    getHelp()
  );

};


// ============================================================
// COMMAND: ON
// ============================================================

COMMANDS["/on"] =
async ({
  userId
}) => {

  botEnabled = true;

  await sendZaloMessage(
    userId,
    "🟢 Bot đã bật!"
  );

};


// ============================================================
// COMMAND: OFF
// ============================================================

COMMANDS["/off"] =
async ({
  userId
}) => {

  botEnabled = false;

  await sendZaloMessage(
    userId,
    "🔴 Bot đã tắt.\n\nGửi /on để bật lại."
  );

};


// ============================================================
// COMMAND: PING
// ============================================================

COMMANDS["/ping"] =
async ({
  userId
}) => {

  await sendZaloMessage(
    userId,
    "🏓 Pong!\n🟢 Bot đang hoạt động."
  );

};


// ============================================================
// COMMAND: ID
// ============================================================

COMMANDS["/id"] =
async ({
  userId
}) => {

  await sendZaloMessage(
    userId,
    `🆔 User ID:\n${userId}`
  );

};


// ============================================================
// COMMAND: AI
// ============================================================

COMMANDS["/ai"] =
async ({
  userId
}) => {

  try {

    const model =
      await resolveGeminiModel();

    await sendZaloMessage(

      userId,

      `🟢 GEMINI OK

Model:
${model}

API Key:
Hợp lệ`

    );

  } catch (error) {

    await sendZaloMessage(

      userId,

      `🔴 GEMINI LỖI

${error.message}`

    );

  }

};


// ============================================================
// COMMAND: STATUS
// ============================================================

COMMANDS["/status"] =
async ({
  userId
}) => {

  let geminiStatus =
    "🔴 Lỗi";

  let model =
    activeGeminiModel ||
    "Chưa kiểm tra";


  try {

    model =
      await resolveGeminiModel();

    geminiStatus =
      "🟢 OK";

  } catch (error) {

    geminiStatus =
      "🔴 " +
      error.message;

  }


  await sendZaloMessage(

    userId,

    `
📊 BOT STATUS

🖥 Server:
🟢 Online

🤖 AI:
Google Gemini

🧠 Model:
${model}

🔑 Gemini:
${geminiStatus}

💬 Zalo Token:
${ZALO_BOT_TOKEN
  ? "🟢 Có"
  : "🔴 Thiếu"}

🤖 Bot:
${botEnabled
  ? "🟢 ON"
  : "🔴 OFF"}
`.trim()

  );

};


// ============================================================
// COMMAND: MEMORY
// ============================================================

COMMANDS["/memory"] =
async ({
  userId
}) => {

  await sendZaloMessage(

    userId,

    `🧠 MEMORY

Số nhóm ghi nhớ:
${MEMORY_RULES.length}

Ví dụ:
"Ai tạo ra bot mặt đất màu xanh?"

→ An Na & Hoàng Vũ`

  );

};


// ============================================================
// COMMAND: ADMIN
// ============================================================

COMMANDS["/admin"] =
async ({
  userId
}) => {

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
// PROCESS MESSAGE
// ============================================================

async function processMessage(
  body
) {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "📩 ZALO EVENT"
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


  // ----------------------------------------------------------
  // Không có text
  // ----------------------------------------------------------

  if (!text) {

    console.log(
      "⚠️ Không có text -> bỏ qua."
    );

    return;

  }


  // ----------------------------------------------------------
  // Không có user
  // ----------------------------------------------------------

  if (!userId) {

    console.log(
      "❌ Không tìm thấy user ID."
    );

    return;

  }


  // ----------------------------------------------------------
  // Tin từ bot
  // ----------------------------------------------------------

  if (
    body?.message?.from?.is_bot === true
  ) {

    console.log(
      "🤖 Tin từ bot -> bỏ qua."
    );

    return;

  }


  // ----------------------------------------------------------
  // COMMAND
  // ----------------------------------------------------------

  const firstWord =
    text
      .split(/\s+/)[0]
      .toLowerCase();


  if (
    COMMANDS[firstWord]
  ) {

    console.log(
      "⚙️ COMMAND:",
      firstWord
    );


    try {

      await COMMANDS[firstWord]({

        userId,
        text,
        body

      });

    } catch (error) {

      console.error(
        "❌ COMMAND ERROR:",
        error.message
      );

      try {

        await sendZaloMessage(

          userId,

          `❌ Lỗi lệnh:

${error.message}`

        );

      } catch (_) {}

    }


    return;

  }


  // ----------------------------------------------------------
  // BOT OFF
  // ----------------------------------------------------------

  if (!botEnabled) {

    console.log(
      "🔴 Bot OFF -> bỏ qua tin nhắn."
    );

    return;

  }


  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------

  const memoryAnswer =
    checkMemory(text);


  if (memoryAnswer) {

    console.log(
      "🧠 MEMORY HIT:",
      memoryAnswer
    );


    try {

      await sendZaloMessage(

        userId,

        memoryAnswer

      );

    } catch (error) {

      console.error(
        "❌ MEMORY SEND:",
        error.message
      );

    }


    return;

  }


  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  console.log(
    "🤖 Đang hỏi Gemini..."
  );


  try {

    const answer =
      await askGemini(text);


    console.log(
      "🤖 GEMINI TRẢ LỜI:"
    );

    console.log(
      answer
    );


    await sendZaloMessage(
      userId,
      answer
    );


    console.log(
      "✅ Đã trả lời Zalo."
    );


  } catch (error) {

    console.error(
      "❌ GEMINI ERROR:",
      error.message
    );


    try {

      await sendZaloMessage(

        userId,

        `❌ Gemini gặp lỗi.

${error.message}`

      );

    } catch (zaloError) {

      console.error(
        "❌ KHÔNG GỬI ĐƯỢC ZALO:",
        zaloError.message
      );

    }

  }


  console.log(
    "========================================"
  );

}


// ============================================================
// WEBHOOK /webhook
// ============================================================

app.post(
  "/webhook",
  async (
    req,
    res
  ) => {

    // Trả 200 NGAY cho Zalo
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
// WEBHOOK /zalo/webhook
// ============================================================

app.post(
  "/zalo/webhook",
  async (
    req,
    res
  ) => {

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
  (
    req,
    res
  ) => {

    res.status(200).send(`

<!DOCTYPE html>

<html lang="vi">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1">

<title>${BOT_NAME}</title>

</head>

<body>

<h2>🤖 ${BOT_NAME}</h2>

<p>🟢 Server đang chạy.</p>

<p>AI: Google Gemini</p>

<p>Model:
<b>
${activeGeminiModel || AI_MODEL || "AUTO"}
</b>
</p>

<p>Webhook:
<code>/webhook</code>
</p>

</body>

</html>

`);

  }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/health",
  async (
    req,
    res
  ) => {

    let gemini = false;
    let model =
      activeGeminiModel ||
      null;

    try {

      model =
        await resolveGeminiModel();

      gemini = true;

    } catch (_) {}


    res.json({

      ok:
        gemini &&
        !!ZALO_BOT_TOKEN,

      server:
        true,

      gemini: {

        configured:
          !!GEMINI_API_KEY,

        valid:
          gemini,

        model:
          model

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
// START
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
      "🔑 GEMINI KEY:",
      maskSecret(
        GEMINI_API
