const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 10000;

const ZALO_BOT_TOKEN = (process.env.ZALO_BOT_TOKEN || "").trim();
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();

const ADMIN_ID = (process.env.ADMIN_ID || "").trim();

// Model mặc định hiện dùng ổn trên Groq
const AI_MODEL =
  (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();

const BOT_NAME =
  process.env.BOT_NAME || "Zalo AI Bot";


// ============================================================
// 🧠 CÂU GHI NHỚ MẶC ĐỊNH
// ============================================================
//
// Muốn thêm sau này:
// {
//   patterns: ["câu 1", "câu 2"],
//   answer: "câu trả lời"
// }
//
// Bot sẽ kiểm tra các câu này TRƯỚC khi gọi AI.
// ============================================================

const MEMORY_RULES = [

  {
    patterns: [
      "ai tạo ra bot mặt đất màu xanh",
      "ai tao ra bot mat dat mau xanh",
      "ai tạo bot mặt đất màu xanh",
      "ai tao bot mat dat mau xanh",
      "ai là người tạo ra bot mặt đất màu xanh",
      "ai la nguoi tao ra bot mat dat mau xanh",
      "bot mặt đất màu xanh do ai tạo",
      "bot mat dat mau xanh do ai tao",
      "cha đẻ bot mặt đất màu xanh",
      "cha de bot mat dat mau xanh"
    ],

    answer: "An Na & Hoàng Vũ"
  }

];


// ============================================================
// 🔧 THÊM LỆNH Ở ĐÂY
// ============================================================
//
// Sau này muốn thêm:
//
// COMMANDS["/hello"] = async ({ userId }) => {
//   await sendZaloMessage(userId, "Xin chào 👋");
// };
//
// ============================================================

const COMMANDS = {};


// ============================================================
// TEXT NORMALIZE
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
  const normalized = normalizeText(text);

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
  if (!value) return "MISSING";

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
// GROQ CHECK API KEY
// ============================================================

async function checkGroqKey() {

  if (!GROQ_API_KEY) {
    return {
      ok: false,
      message: "GROQ_API_KEY chưa được cấu hình"
    };
  }

  try {

    const response = await fetch(
      "https://api.groq.com/openai/v1/models",
      {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${GROQ_API_KEY}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {

      return {
        ok: false,
        status: response.status,
        message:
          data?.error?.message ||
          "Groq API Key không hợp lệ"
      };
    }

    return {
      ok: true,
      message: "GROQ_API_KEY hợp lệ",
      models: Array.isArray(data?.data)
        ? data.data.map(x => x.id)
        : []
    };

  } catch (error) {

    return {
      ok: false,
      message: error.message
    };
  }
}


// ============================================================
// ZALO CHECK TOKEN
// ============================================================
//
// Dùng endpoint getoa để xác thực token.
// ============================================================

async function checkZaloToken() {

  if (!ZALO_BOT_TOKEN) {

    return {
      ok: false,
      message: "ZALO_BOT_TOKEN chưa được cấu hình"
    };
  }

  try {

    const response = await fetch(
      "https://openapi.zalo.me/v2.0/oa/getoa",
      {
        method: "GET",
        headers: {
          "access_token": ZALO_BOT_TOKEN
        }
      }
    );

    const data = await response.json();

    if (!response.ok || data?.error !== 0) {

      return {
        ok: false,
        status: response.status,
        message:
          data?.message ||
          "Zalo Access Token không hợp lệ"
      };
    }

    return {
      ok: true,
      message: "ZALO_BOT_TOKEN hợp lệ",
      oa: data?.data || null
    };

  } catch (error) {

    return {
      ok: false,
      message: error.message
    };
  }
}


// ============================================================
// ASK GROQ
// ============================================================

async function askGroq(text) {

  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY chưa được cấu hình"
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization":
          `Bearer ${GROQ_API_KEY}`
      },

      body: JSON.stringify({

        model: AI_MODEL,

        messages: [

          {
            role: "system",

            content: `
Bạn là AI của ${BOT_NAME}.

Quy tắc:
- Trả lời bằng tiếng Việt.
- Tự nhiên, thân thiện.
- Không nói dài dòng nếu không cần.
- Không tự nhận mình là con người.
- Nếu người dùng hỏi những thông tin đã được bot ghi nhớ thì ưu tiên thông tin đó.
- Không bịa thông tin.
`
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

  console.log(
    "🤖 GROQ STATUS:",
    response.status
  );

  if (!response.ok) {

    console.error(
      "❌ GROQ DETAIL:",
      JSON.stringify(data, null, 2)
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


// ============================================================
// SEND ZALO MESSAGE
// ============================================================

async function sendZaloMessage(userId, text) {

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

  const response = await fetch(
    "https://openapi.zalo.me/v3.0/oa/message/cs",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "access_token":
          ZALO_BOT_TOKEN
      },

      body: JSON.stringify({

        recipient: {
          user_id: String(userId)
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


// ============================================================
// HELP
// ============================================================

function getHelpMessage() {

  return `
🤖 ${BOT_NAME}

📌 LỆNH:

/help
→ Xem danh sách lệnh.

/ping
→ Kiểm tra bot.

/id
→ Xem User ID của bạn.

/ai
→ Kiểm tra AI.

/zalo
→ Kiểm tra Zalo.

/status
→ Kiểm tra toàn bộ hệ thống.

/admin
→ Kiểm tra admin.

/memory
→ Xem trạng thái bộ nhớ.

💬 Hoặc cứ nhắn tin bình thường.
Bot sẽ tự trả lời bằng AI.

🧠 Bot cũng có một số câu ghi nhớ đặc biệt.
`.trim();
}


// ============================================================
// STATUS
// ============================================================

async function getStatus() {

  const groq = await checkGroqKey();
  const zalo = await checkZaloToken();

  return {
    groq,
    zalo
  };
}


// ============================================================
// COMMANDS
// ============================================================

COMMANDS["/help"] = async ({ userId }) => {

  await sendZaloMessage(
    userId,
    getHelpMessage()
  );
};


COMMANDS["/ping"] = async ({ userId }) => {

  await sendZaloMessage(
    userId,
    "🏓 Pong!\n🟢 Bot đang hoạt động."
  );
};


COMMANDS["/id"] = async ({ userId }) => {

  await sendZaloMessage(
    userId,
    `🆔 User ID:\n${userId}`
  );
};


COMMANDS["/ai"] = async ({ userId }) => {

  const result =
    await checkGroqKey();

  if (result.ok) {

    await sendZaloMessage(
      userId,
      `🤖 AI OK\n\nModel: ${AI_MODEL}\n🔑 Groq API Key: hợp lệ`
    );

  } else {

    await sendZaloMessage(
      userId,
      `❌ AI ERROR\n\n${result.message}`
    );
  }
};


COMMANDS["/zalo"] = async ({ userId }) => {

  const result =
    await checkZaloToken();

  if (result.ok) {

    const name =
      result.oa?.name ||
      "OA";

    await sendZaloMessage(
      userId,
      `🟢 Zalo OK\n\nOA: ${name}\n🔑 Access Token: hợp lệ`
    );

  } else {

    await sendZaloMessage(
      userId,
      `❌ ZALO ERROR\n\n${result.message}`
    );
  }
};


COMMANDS["/status"] = async ({ userId }) => {

  const result =
    await getStatus();

  const groqStatus =
    result.groq.ok
      ? "🟢 OK"
      : "🔴 LỖI";

  const zaloStatus =
    result.zalo.ok
      ? "🟢 OK"
      : "🔴 LỖI";

  await sendZaloMessage(
    userId,
    `
📊 BOT STATUS

🤖 Groq: ${groqStatus}
${result.groq.ok
  ? `Model: ${AI_MODEL}`
  : result.groq.message}

💬 Zalo: ${zaloStatus}
${result.zalo.ok
  ? `OA: ${result.zalo.oa?.name || "OK"}`
  : result.zalo.message}
`.trim()
  );
};


COMMANDS["/memory"] = async ({ userId }) => {

  await sendZaloMessage(
    userId,
    `🧠 Memory đang hoạt động.\n\n📚 Số rule: ${MEMORY_RULES.length}`
  );
};


COMMANDS["/admin"] = async ({ userId }) => {

  if (
    ADMIN_ID &&
    String(userId) !== String(ADMIN_ID)
  ) {

    await sendZaloMessage(
      userId,
      "⛔ Bạn không phải admin."
    );

    return;
  }

  await sendZaloMessage(
    userId,
    `👑 Admin ID:\n${userId}`
  );
};


// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(body) {

  console.log("================================");
  console.log("📩 ZALO WEBHOOK");
  console.log(
    JSON.stringify(body, null, 2)
  );

  const text =
    getMessageText(body).trim();

  const userId =
    getUserId(body);

  console.log("🆔 USER ID:", userId);
  console.log("💬 TEXT:", text);

  if (!text) {

    console.log(
      "⚠️ Không có text -> bỏ qua"
    );

    return;
  }

  if (!userId) {

    console.log(
      "❌ Không tìm thấy user ID"
    );

    return;
  }

  // Tin nhắn do bot gửi
  if (
    body?.message?.from?.is_bot === true
  ) {

    console.log(
      "🤖 Tin từ bot -> bỏ qua"
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

    await COMMANDS[command]({
      userId,
      text,
      body
    });

    return;
  }


  // ==========================================================
  // MEMORY
  // ==========================================================

  const memoryAnswer =
    checkMemory(text);

  if (memoryAnswer) {

    console.log(
      "🧠 MEMORY HIT:",
      memoryAnswer
    );

    await sendZaloMessage(
      userId,
      memoryAnswer
    );

    return;
  }


  // ==========================================================
  // AI
  // ==========================================================

  console.log(
    "🤖 Đang hỏi Groq..."
  );

  try {

    const answer =
      await askGroq(text);

    console.log(
      "🤖 GROQ:",
      answer
    );

    await sendZaloMessage(
      userId,
      answer
    );

    console.log(
      "✅ Đã trả lời người dùng"
    );

  } catch (error) {

    console.error(
      "❌ GROQ ERROR:",
      error.message
    );

    // Cố gửi thông báo lỗi cho user
    try {

      await sendZaloMessage(
        userId,
        `❌ AI đang lỗi.\n\n${error.message}`
      );

    } catch (zaloError) {

      console.error(
        "❌ Không gửi được lỗi về Zalo:",
        zaloError.message
      );
    }
  }

  console.log("================================");
}


// ============================================================
// WEBHOOK /webhook
// ============================================================

app.post("/webhook", async (req, res) => {

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
});


// ============================================================
// WEBHOOK /zalo/webhook
// ============================================================

app.post("/zalo/webhook", async (req, res) => {

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
});


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {

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

<p>AI Model: ${AI_MODEL}</p>

<p>
Webhook:
<code>/webhook</code>
</p>

</body>

</html>
`);
});


// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {

  const result =
    await getStatus();

  res.json({

    ok:
      result.groq.ok &&
      result.zalo.ok,

    server: true,

    groq: {
      ok: result.groq.ok,
      model: AI_MODEL
    },

    zalo: {
      ok: result.zalo.ok
    }

  });
});


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (err, req, res, next) => {

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
    console.log("================================");
    console.log(`🤖 ${BOT_NAME}`);
    console.log("================================");

    console.log(
      "🚀 PORT:",
      PORT
    );

    console.log(
      "🟢 SERVER: ON"
    );

    console.log(
      "🤖 AI MODEL:",
      AI_MODEL
    );

    console.log(
      "🔑 GROQ KEY:",
      maskSecret(GROQ_API_KEY)
    );

    console.log(
      "🔑 ZALO TOKEN:",
      maskSecret(ZALO_BOT_TOKEN)
    );

    console.log("================================");

    // Kiểm tra ngay khi Render khởi động
    console.log("🔍 KIỂM TRA GROQ...");

    const groq =
      await checkGroqKey();

    if (groq.ok) {

      console.log(
        "🟢 GROQ API KEY: OK"
      );

      console.log(
        "📦 MODEL:",
        AI_MODEL
      );

    } else {

      console.error(
        "🔴 GROQ API KEY:",
        groq.message
      );
    }

    console.log("================================");

    console.log(
      "🔍 KIỂM TRA ZALO TOKEN..."
    );

    const zalo =
      await checkZaloToken();

    if (zalo.ok) {

      console.log(
        "🟢 ZALO TOKEN: OK"
      );

      console.log(
        "🏢 OA:",
        zalo.oa?.name || "Unknown"
      );

    } else {

      console.error(
        "🔴 ZALO TOKEN:",
        zalo.message
      );
    }

    console.log("================================");
    console.log("🟢 BOT READY");
    console.log("================================");
  }
);
