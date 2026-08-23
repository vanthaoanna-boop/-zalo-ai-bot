const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const ZALO_BOT_TOKEN = (
  process.env.ZALO_BOT_TOKEN ||
  process.env.ZALO_TOKEN ||
  ""
).trim();

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_KEY ||
  ""
).trim();

const ADMIN_ID = (
  process.env.ADMIN_ID ||
  ""
).trim();

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";

// Đặt model ổn định hơn trước.
// Nếu model đầu lỗi quota thì tự thử model tiếp theo.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];

let botEnabled = true;
let botInfo = null;
let activeGeminiModel = null;

// Chế độ đặc biệt của bot.
// Đây KHÔNG phải chế độ bỏ qua quy tắc an toàn của AI.
let specialMode = false;

// Trong nhóm:
// false = bot không tự trả lời tin nhắn thường, chỉ trả lời command.
// true = bot trả lời tin nhắn thường trong nhóm.
let groupReplyEnabled = false;

// ============================================================
// WEBHOOK SECRET
// ============================================================

const WEBHOOK_SECRET = (
  process.env.ZALO_WEBHOOK_SECRET ||
  crypto
    .createHash("sha256")
    .update(ZALO_BOT_TOKEN)
    .digest("hex")
    .slice(0, 32)
).trim();

// ============================================================
// LOG
// ============================================================

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function mask(value, visible = 4) {
  if (!value) return "NOT_SET";

  if (value.length <= visible) {
    return "*".repeat(value.length);
  }

  return (
    value.slice(0, visible) +
    "*".repeat(Math.max(4, value.length - visible))
  );
}

// ============================================================
// CONFIG CHECK
// ============================================================

function validateConfig() {
  console.log("");
  console.log("==============================================");
  console.log("🤖 BOT MẶT ĐẤT MÀU XANH");
  console.log("==============================================");
  console.log(`🌐 PORT: ${PORT}`);
  console.log(`🔗 PUBLIC URL: ${PUBLIC_URL || "NOT_SET"}`);
  console.log(`🔑 ZALO TOKEN: ${mask(ZALO_BOT_TOKEN)}`);
  console.log(`🧠 GEMINI KEY: ${mask(GEMINI_API_KEY)}`);
  console.log(`👑 ADMIN ID: ${ADMIN_ID || "NOT_SET"}`);
  console.log(`🔐 WEBHOOK SECRET: ${mask(WEBHOOK_SECRET)}`);
  console.log("==============================================");

  if (!ZALO_BOT_TOKEN) {
    console.error("❌ Thiếu ZALO_BOT_TOKEN");
  }

  if (!GEMINI_API_KEY) {
    console.error("❌ Thiếu GEMINI_API_KEY");
  }

  if (!PUBLIC_URL) {
    console.warn("⚠️ Thiếu PUBLIC_URL / RENDER_EXTERNAL_URL");
  }
}

// ============================================================
// GENERIC POST
// ============================================================

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();

    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        raw: text,
      };
    }

    return {
      httpStatus: response.status,
      ok: response.ok,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// ZALO API
// ============================================================

function zaloUrl(method) {
  return `${ZALO_API_BASE}/bot${encodeURIComponent(
    ZALO_BOT_TOKEN
  )}/${method}`;
}

async function zaloApi(method, body) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình."
    );
  }

  const result = await postJson(
    zaloUrl(method),
    body
  );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ${JSON.stringify(
        result.data
      )}`
    );
  }

  if (result.data?.ok === false) {
    const message =
      result.data.description ||
      result.data.message ||
      JSON.stringify(result.data);

    const error = new Error(
      `Zalo API error: ${message}`
    );

    error.zaloResponse = result.data;

    throw error;
  }

  return result.data;
}

// ============================================================
// ZALO GET ME
// ============================================================

async function getMe() {
  log("🔎 Kiểm tra Zalo Bot API...");

  const data = await zaloApi("getMe");

  botInfo = data?.result || null;

  log("📡 ZALO getMe:", JSON.stringify(data));

  if (data?.ok) {
    log("✅ ZALO BOT API: OK");

    if (botInfo) {
      log(
        "🤖 BOT INFO:",
        JSON.stringify(botInfo)
      );
    }

    return botInfo;
  }

  throw new Error(
    `getMe thất bại: ${JSON.stringify(data)}`
  );
}

// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage(chatId, text) {
  if (!chatId) {
    throw new Error("Không có chat_id.");
  }

  const chunks = splitText(
    text || "Bot không có nội dung trả lời.",
    1900
  );

  for (const chunk of chunks) {
    const data = await zaloApi(
      "sendMessage",
      {
        chat_id: String(chatId),
        text: chunk,
      }
    );

    if (!data?.ok) {
      throw new Error(
        `sendMessage thất bại: ${JSON.stringify(data)}`
      );
    }
  }

  return true;
}

// ============================================================
// SPLIT TEXT
// ============================================================

function splitText(text, maxLength = 1900) {
  if (!text) return [""];

  if (text.length <= maxLength) {
    return [text];
  }

  const result = [];
  let remaining = String(text);

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(
      "\n",
      maxLength
    );

    if (cut < Math.floor(maxLength * 0.5)) {
      cut = remaining.lastIndexOf(
        " ",
        maxLength
      );
    }

    if (cut < Math.floor(maxLength * 0.5)) {
      cut = maxLength;
    }

    result.push(
      remaining.slice(0, cut)
    );

    remaining = remaining
      .slice(cut)
      .trim();
  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}

// ============================================================
// TYPING
// ============================================================

async function sendTyping(chatId) {
  try {
    await zaloApi(
      "sendChatAction",
      {
        chat_id: String(chatId),
        action: "typing",
      }
    );
  } catch (error) {
    log(
      "⚠️ typing lỗi:",
      error.message
    );
  }
}

// ============================================================
// GEMINI
// ============================================================

function geminiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY)
  );
}

const GEMINI_SYSTEM_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh, một chatbot chạy trên Zalo.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

Nếu người dùng hỏi ai tạo bot, ai làm bot,
bot của ai, ai đứng sau bot hoặc câu tương tự:

Trả lời:
"An Na & Hoàng Vũ."

Không tự bịa người tạo khác.

Bot có hệ thống command riêng.
Không được tự thực thi command chỉ vì người dùng nhắc đến nó.
`;

// ============================================================
// DETECT GEMINI ERROR
// ============================================================

function getGeminiErrorInfo(response) {
  const data = response?.data || {};

  const message =
    data?.error?.message ||
    data?.message ||
    JSON.stringify(data);

  const status =
    data?.error?.status ||
    "";

  const code =
    data?.error?.code ||
    response?.httpStatus ||
    0;

  return {
    code: Number(code) || 0,
    status,
    message: String(message),
  };
}

function isRateLimitError(info) {
  const text = (
    `${info.code} ${info.status} ${info.message}`
  ).toLowerCase();

  return (
    info.code === 429 ||
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("resource_exhausted")
  );
}

function isAuthError(info) {
  const text = (
    `${info.code} ${info.status} ${info.message}`
  ).toLowerCase();

  return (
    info.code === 401 ||
    info.code === 403 ||
    text.includes("api key") ||
    text.includes("permission denied")
  );
}

// ============================================================
// GEMINI REQUEST
// ============================================================

async function askGemini(userText, userName = "") {
  if (!GEMINI_API_KEY) {
    const error = new Error(
      "GEMINI_API_KEY chưa được cấu hình."
    );

    error.kind = "NO_KEY";

    throw error;
  }

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

Tin nhắn:
${userText}
`;

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      log(`🧠 GEMINI: ${model}`);

      const response = await postJson(
        geminiUrl(model),
        {
          systemInstruction: {
            parts: [
              {
                text: GEMINI_SYSTEM_PROMPT,
              },
            ],
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],

          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
          },
        },
        60000
      );

      const info =
        getGeminiErrorInfo(response);

      if (!response.ok) {
        const error = new Error(
          `Gemini ${model}: HTTP ${response.httpStatus} - ${info.message}`
        );

        error.kind =
          isRateLimitError(info)
            ? "RATE_LIMIT"
            : isAuthError(info)
            ? "AUTH"
            : "API";

        error.model = model;
        error.info = info;

        throw error;
      }

      if (response.data?.error) {
        const error = new Error(
          `Gemini ${model}: ${info.message}`
        );

        error.kind =
          isRateLimitError(info)
            ? "RATE_LIMIT"
            : isAuthError(info)
            ? "AUTH"
            : "API";

        error.model = model;
        error.info = info;

        throw error;
      }

      const text =
        response.data
          ?.candidates?.[0]
          ?.content?.parts
          ?.map(
            (part) => part.text || ""
          )
          .join("")
          .trim();

      if (!text) {
        const error = new Error(
          `Gemini ${model} không trả về nội dung.`
        );

        error.kind = "EMPTY";
        error.model = model;

        throw error;
      }

      activeGeminiModel = model;

      log(
        `✅ GEMINI OK: ${model}`
      );

      return text;
    } catch (error) {
      lastError = error;

      log(
        `⚠️ GEMINI ${model} LỖI:`,
        error.message
      );

      // 429 thì thử model tiếp theo.
      // Không dừng ngay.
      continue;
    }
  }

  const finalError = new Error(
    lastError?.message ||
      "Tất cả Gemini model đều lỗi."
  );

  finalError.kind =
    lastError?.kind || "UNKNOWN";

  finalError.original =
    lastError;

  throw finalError;
}

// ============================================================
// NORMALIZE WEBHOOK
// ============================================================

function normalizeWebhook(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const data =
    body.result &&
    typeof body.result === "object"
      ? body.result
      : body;

  const message =
    data.message || {};

  return {
    eventName:
      data.event_name || "",

    message,

    chatId:
      message?.chat?.id
        ? String(message.chat.id)
        : "",

    chatType:
      message?.chat?.chat_type || "",

    userId:
      message?.from?.id
        ? String(message.from.id)
        : "",

    userName:
      message?.from?.display_name ||
      message?.from?.name ||
      "",

    text:
      typeof message?.text === "string"
        ? message.text.trim()
        : "",

    messageId:
      message?.message_id
        ? String(message.message_id)
        : "",
  };
}

// ============================================================
// COMMAND SYSTEM
// ============================================================

const COMMANDS = new Map();

function registerCommand(
  name,
  config
) {
  COMMANDS.set(
    name.toLowerCase(),
    {
      name: name.toLowerCase(),
      ...config,
    }
  );

  if (Array.isArray(config.aliases)) {
    for (const alias of config.aliases) {
      COMMANDS.set(
        alias.toLowerCase(),
        {
          name: name.toLowerCase(),
          ...config,
        }
      );
    }
  }
}

// ============================================================
// /help + /hepl
// ============================================================

registerCommand("help", {
  aliases: ["h", "menu", "hepl"],

  description:
    "Hiện tất cả lệnh",

  usage:
    "/help",

  adminOnly: false,

  async handler({ chatId }) {
    const unique = new Map();

    for (const command of COMMANDS.values()) {
      if (!unique.has(command.name)) {
        unique.set(
          command.name,
          command
        );
      }
    }

    const lines = [
      "🤖 BOT MẶT ĐẤT MÀU XANH",
      "",
      "📚 TẤT CẢ LỆNH:",
    ];

    for (const command of unique.values()) {
      lines.push(
        `/${command.name} — ${
          command.description || ""
        }`
      );
    }

    lines.push("");
    lines.push(
      "💬 Nhắn tin bình thường để chat AI."
    );

    await sendMessage(
      chatId,
      lines.join("\n")
    );
  },
});

// ============================================================
// /ping
// ============================================================

registerCommand("ping", {
  description:
    "Kiểm tra bot",

  usage:
    "/ping",

  adminOnly: false,

  async handler({ chatId }) {
    await sendMessage(
      chatId,
      "🏓 Pong!\n🟢 Bot đang hoạt động."
    );
  },
});

// ============================================================
// /id
// ============================================================

registerCommand("id", {
  description:
    "Xem User ID và Chat ID",

  usage:
    "/id",

  adminOnly: false,

  async handler({
    chatId,
    userId,
    chatType,
  }) {
    await sendMessage(
      chatId,
      [
        "🆔 THÔNG TIN ID",
        "",
        `Chat ID: ${chatId}`,
        `User ID: ${
          userId || "Không có"
        }`,
        `Chat type: ${
          chatType || "Không rõ"
        }`,
      ].join("\n")
    );
  },
});

// ============================================================
// /bot
// ============================================================

registerCommand("bot", {
  description:
    "Thông tin bot",

  usage:
    "/bot",

  adminOnly: false,

  async handler({ chatId }) {
    const name =
      botInfo?.display_name ||
      botInfo?.account_name ||
      "Bot Mặt Đất Màu Xanh";

    await sendMessage(
      chatId,
      [
        "🤖 BOT INFO",
        "",
        `Tên: ${name}`,
        "AI: Google Gemini",
        `Model: ${
          activeGeminiModel ||
          GEMINI_MODELS[0]
        }`,
        "Tác giả: An Na & Hoàng Vũ",
        `Bot AI: ${
          botEnabled
            ? "🟢 BẬT"
            : "🔴 TẮT"
        }`,
        `Chế độ đặc biệt: ${
          specialMode
            ? "🟢 BẬT"
            : "⚪ TẮT"
        }`,
        "",
        "🟢 Server đang hoạt động.",
      ].join("\n")
    );
  },
});

// ============================================================
// /on
// ============================================================

registerCommand("on", {
  description:
    "Bật bot AI",

  usage:
    "/on",

  adminOnly: true,

  async handler({ chatId }) {
    botEnabled = true;

    await sendMessage(
      chatId,
      "🟢 Đã BẬT bot AI."
    );
  },
});

// ============================================================
// /off
// ============================================================

registerCommand("off", {
  description:
    "Tắt bot AI",

  usage:
    "/off",

  adminOnly: true,

  async handler({ chatId }) {
    botEnabled = false;

    await sendMessage(
      chatId,
      "🔴 Đã TẮT bot AI.\nDùng /on để bật lại."
    );
  },
});

// ============================================================
// /adminid
// ============================================================

registerCommand("adminid", {
  description:
    "Xem cấu hình admin",

  usage:
    "/adminid",

  adminOnly: true,

  async handler({
    chatId,
  }) {
    await sendMessage(
      chatId,
      [
        "👑 ADMIN",
        "",
        `ADMIN_ID: ${
          ADMIN_ID || "CHƯA CẤU HÌNH"
        }`,
        `ID hiện tại: ${chatId}`,
        "",
        ADMIN_ID
          ? "✅ Admin đã cấu hình."
          : "⚠️ Chưa cấu hình ADMIN_ID.",
      ].join("\n")
    );
  },
});

// ============================================================
// /batquytac
// ============================================================
//
// Đây là chế độ admin riêng của bot.
// Không dùng để yêu cầu Gemini vượt qua chính sách an toàn.
// ============================================================

registerCommand("batquytac", {
  description:
    "Bật chế độ đặc biệt của bot",

  usage:
    "/batquytac",

  adminOnly: true,

  async handler({ chatId }) {
    specialMode = true;

    await sendMessage(
      chatId,
      [
        "⚠️ ĐÃ BẬT CHẾ ĐỘ ĐẶC BIỆT.",
        "",
        "Bot sẽ dùng chế độ quản trị đặc biệt đã cấu hình.",
        "Các giới hạn an toàn của AI vẫn được áp dụng.",
        "",
        "Dùng /tatbatquytat để tắt.",
      ].join("\n")
    );
  },
});

// ============================================================
// /tatbatquytat
// ============================================================

registerCommand("tatbatquytat", {
  description:
    "Tắt chế độ đặc biệt",

  usage:
    "/tatbatquytat",

  adminOnly: true,

  async handler({ chatId }) {
    specialMode = false;

    await sendMessage(
      chatId,
      "🟢 Đã tắt chế độ đặc biệt."
    );
  },
});

// ============================================================
// /group
// ============================================================
//
// /group on  = cho AI trả lời tin nhắn thường trong nhóm
// /group off = nhóm chỉ phản hồi command
// ============================================================

registerCommand("group", {
  description:
    "Bật/tắt AI trả lời tin nhắn thường trong nhóm",

  usage:
    "/group on | /group off",

  adminOnly: true,

  async handler({
    chatId,
    args,
  }) {
    const mode =
      String(args[0] || "")
        .toLowerCase();

    if (mode === "on") {
      groupReplyEnabled = true;

      await sendMessage(
        chatId,
        "🟢 Đã cho phép bot trả lời tin nhắn thường trong nhóm."
      );

      return;
    }

    if (mode === "off") {
      groupReplyEnabled = false;

      await sendMessage(
        chatId,
        "🔴 Đã tắt trả lời AI tự động trong nhóm.\nBot vẫn nhận command."
      );

      return;
    }

    await sendMessage(
      chatId,
      [
        "Cách dùng:",
        "/group on",
        "/group off",
      ].join("\n")
    );
  },
});

// ============================================================
// MEMORY
// ============================================================

const MEMORY_RULES = [
  {
    patterns: [
      "ai tạo ra bot mặt đất màu xanh",
      "ai tạo bot mặt đất màu xanh",
      "ai làm bot mặt đất màu xanh",
      "ai tạo bot này",
      "ai làm bot này",
      "bot này của ai",
      "bot của ai",
      "ai tạo bot",
      "ai làm bot",
      "cha đẻ bot",
      "ai đứng sau bot",
      "tác giả bot",
    ],

    answer:
      "An Na & Hoàng Vũ.",
  },
];

// ============================================================
// NORMALIZE
// ============================================================

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(/đ/g, "d")
    .replace(
      /[?!.,;:()[\]{}"'`]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// MEMORY MATCH
// ============================================================

function getRememberedAnswer(text) {
  const normalized =
    normalizeText(text);

  for (const rule of MEMORY_RULES) {
    for (const pattern of rule.patterns) {
      const p =
        normalizeText(pattern);

      if (
        normalized === p ||
        normalized.includes(p)
      ) {
        return rule.answer;
      }
    }
  }

  return null;
}

// ============================================================
// COMMAND PARSER
// ============================================================

function parseCommand(text) {
  const value =
    String(text || "").trim();

  if (!value.startsWith("/")) {
    return null;
  }

  const parts =
    value.split(/\s+/);

  const rawCommand =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  const args =
    parts.slice(1);

  if (!rawCommand) {
    return null;
  }

  return {
    command: rawCommand,
    args,
    text: args.join(" "),
  };
}

// ============================================================
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  if (!ADMIN_ID) {
    return false;
  }

  return (
    String(userId) ===
      String(ADMIN_ID) ||
    String(chatId) ===
      String(ADMIN_ID)
  );
}

// ============================================================
// HANDLE COMMAND
// ============================================================

async function handleCommand(
  update,
  parsed
) {
  const command =
    COMMANDS.get(
      parsed.command
    );

  if (!command) {
    return false;
  }

  const admin =
    isAdmin(
      update.userId,
      update.chatId
    );

  if (
    command.adminOnly &&
    !admin
  ) {
    await sendMessage(
      update.chatId,
      "⛔ Lệnh này chỉ dành cho admin."
    );

    return true;
  }

  await command.handler({
    ...update,
    ...parsed,
    isAdmin: admin,
  });

  return true;
}

// ============================================================
// GROUP CHECK
// ============================================================

function isGroup(update) {
  const type =
    String(
      update.chatType || ""
    ).toUpperCase();

  return (
    type.includes("GROUP") ||
    type.includes("ROOM")
  );
}

// ============================================================
// HANDLE MESSAGE
// ============================================================

async function handleMessage(
  update
) {
  const {
    chatId,
    userId,
    userName,
    text,
  } = update;

  if (!chatId || !text) {
    return;
  }

  log("==============================================");
  log(
    `👤 USER: ${
      userName || "Unknown"
    }`
  );
  log(
    `🆔 USER ID: ${
      userId || "Unknown"
    }`
  );
  log(
    `💬 CHAT ID: ${chatId}`
  );
  log(
    `💬 TEXT: ${text}`
  );

  const group =
    isGroup(update);

  // ----------------------------------------------------------
  // COMMAND
  // ----------------------------------------------------------

  const parsed =
    parseCommand(text);

  if (parsed) {
    if (
      COMMANDS.has(
        parsed.command
      )
    ) {
      log(
        `⚙️ COMMAND: /${parsed.command}`
      );

      try {
        await handleCommand(
          update,
          parsed
        );
      } catch (error) {
        log(
          `❌ COMMAND ERROR /${parsed.command}:`,
          error.message
        );

        try {
          await sendMessage(
            chatId,
            "❌ Lệnh bị lỗi. Kiểm tra log Render."
          );
        } catch {}
      }

      return;
    }

    await sendMessage(
      chatId,
      [
        `❓ Không có lệnh /${parsed.command}`,
        "",
        "Dùng /help để xem tất cả lệnh.",
      ].join("\n")
    );

    return;
  }

  // ----------------------------------------------------------
  // NHÓM: CHỐNG SPAM
  // ----------------------------------------------------------

  if (
    group &&
    !groupReplyEnabled
  ) {
    log(
      "👥 GROUP: bỏ qua tin nhắn thường."
    );

    return;
  }

  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------

  const remembered =
    getRememberedAnswer(text);

  if (remembered) {
    log("🧠 MEMORY HIT");

    try {
      await sendMessage(
        chatId,
        remembered
      );
    } catch (error) {
      log(
        "❌ SEND MEMORY ERROR:",
        error.message
      );
    }

    return;
  }

  // ----------------------------------------------------------
  // BOT OFF
  // ----------------------------------------------------------

  if (!botEnabled) {
    log(
      "🔴 BOT OFF - bỏ qua."
    );

    return;
  }

  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  await sendTyping(chatId);

  try {
    log(
      "🧠 Đang hỏi Gemini..."
    );

    const answer =
      await askGemini(
        text,
        userName
      );

    log(
      "🤖 GEMINI:",
      answer
    );

    await sendMessage(
      chatId,
      answer
    );

    log(
      "✅ ĐÃ GỬI TRẢ LỜI"
    );
  } catch (error) {
    log(
      "❌ GEMINI FINAL ERROR:",
      error.message
    );

    let reply;

    if (
      error.kind ===
      "RATE_LIMIT"
    ) {
      reply = [
        "⏳ Gemini đang hết quota / bị giới hạn tốc độ.",
        "",
        "Bot đã tự thử model dự phòng nhưng hiện chưa có model khả dụng.",
        "Chờ quota hồi lại rồi thử lại nhé.",
      ].join("\n");
    } else if (
      error.kind ===
      "AUTH"
    ) {
      reply = [
        "🔑 Gemini API Key đang có vấn đề.",
        "",
        "Kiểm tra GEMINI_API_KEY trên Render.",
      ].join("\n");
    } else {
      reply = [
        "😵 Gemini đang gặp lỗi.",
        "",
        "Xem Application Logs trên Render để biết model/API nào lỗi.",
      ].join("\n");
    }

    try {
      await sendMessage(
        chatId,
        reply
      );
    } catch (
      sendError
    ) {
      log(
        "❌ SEND ERROR:",
        sendError.message
      );
    }
  }
}

// ============================================================
// WEBHOOK AUTH
// ============================================================

function verifyWebhook(req) {
  const received =
    req.headers[
      "x-bot-api-secret-token"
    ];

  if (!received) {
    return false;
  }

  const receivedString =
    String(received);

  const a =
    Buffer.from(
      receivedString
    );

  const b =
    Buffer.from(
      WEBHOOK_SECRET
    );

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

// ============================================================
// WEBHOOK
// ============================================================

app.post(
  "/webhook",
  async (req, res) => {
    if (!verifyWebhook(req)) {
      log(
        "🚫 WEBHOOK AUTH FAILED"
      );

      return res
        .status(403)
        .json({
          ok: false,
          error: "Unauthorized",
        });
    }

    const update =
      normalizeWebhook(
        req.body
      );

    if (!update) {
      return res.json({
        ok: true,
      });
    }

    log("📩 ZALO WEBHOOK");

    log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    log(
      `📌 EVENT: ${update.eventName}`
    );

    // Trả webhook ngay.
    res.json({
      ok: true,
    });

    if (
      update.eventName ===
      "message.text.received"
    ) {
      handleMessage(
        update
      ).catch(
        (error) => {
          log(
            "❌ HANDLE MESSAGE ERROR:",
            error.message
          );
        }
      );

      return;
    }

    if (
      update.eventName ===
      "message.image.received"
    ) {
      if (update.chatId) {
        sendMessage(
          update.chatId,
          "🖼️ Bot đã nhận được ảnh."
        ).catch(
          (error) => {
            log(
              "❌ IMAGE ERROR:",
              error.message
            );
          }
        );
      }

      return;
    }

    if (
      update.eventName ===
      "message.sticker.received"
    ) {
      if (update.chatId) {
        sendMessage(
          update.chatId,
          "😎 Sticker đẹp đấy!"
        ).catch(
          (error) => {
            log(
              "❌ STICKER ERROR:",
              error.message
            );
          }
        );
      }

      return;
    }

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (update.chatId) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại."
        ).catch(
          (error) => {
            log(
              "❌ VOICE ERROR:",
              error.message
            );
          }
        );
      }
    }
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      bot:
        "Bot Mặt Đất Màu Xanh",
      server: "online",
      zalo:
        Boolean(ZALO_BOT_TOKEN),
      gemini:
        Boolean(GEMINI_API_KEY),
      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],
      botEnabled,
      specialMode,
      groupReplyEnabled,
      webhook: PUBLIC_URL
        ? `${PUBLIC_URL}/webhook`
        : null,
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      status: "online",
    });
  }
);

// ============================================================
// SET WEBHOOK
// ============================================================

async function setWebhook() {
  if (!ZALO_BOT_TOKEN) {
    return;
  }

  if (!PUBLIC_URL) {
    log(
      "⚠️ Không có PUBLIC_URL."
    );

    return;
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log(
    "🔗 SET ZALO WEBHOOK:",
    webhookUrl
  );

  const data =
    await zaloApi(
      "setWebhook",
      {
        url: webhookUrl,
        secret_token:
          WEBHOOK_SECRET,
      }
    );

  log(
    "📡 ZALO setWebhook:",
    JSON.stringify(data)
  );

  if (data?.ok) {
    log(
      "✅ WEBHOOK ĐÃ ĐƯỢC SET"
    );
  } else {
    throw new Error(
      `setWebhook thất bại: ${JSON.stringify(data)}`
    );
  }
}

// ============================================================
// GET WEBHOOK INFO
// ============================================================

async function getWebhookInfo() {
  try {
    const data =
      await zaloApi(
        "getWebhookInfo"
      );

    log(
      "🔎 WEBHOOK INFO:",
      JSON.stringify(data)
    );

    return data;
  } catch (error) {
    log(
      "⚠️ getWebhookInfo:",
      error.message
    );
  }
}

// ============================================================
// GEMINI TEST
// ============================================================

async function testGemini() {
  if (!GEMINI_API_KEY) {
    return false;
  }

  log(
    "🧠 TEST GEMINI..."
  );

  try {
    const answer =
      await askGemini(
        "Trả lời đúng một chữ: OK",
        "SYSTEM TEST"
      );

    log(
      "✅ GEMINI TEST:",
      answer
    );

    return true;
  } catch (error) {
    log(
      "⚠️ GEMINI TEST:",
      error.message
    );

    return false;
  }
}

// ============================================================
// STARTUP
// ============================================================

async function startup() {
  validateConfig();

  if (ZALO_BOT_TOKEN) {
    try {
      await getMe();
    } catch (error) {
      log(
        "❌ ZALO getMe:",
        error.message
      );
    }
  }

  if (GEMINI_API_KEY) {
    await testGemini();
  }

  if (
    ZALO_BOT_TOKEN &&
    PUBLIC_URL
  ) {
    try {
      await setWebhook();
      await getWebhookInfo();
    } catch (error) {
      log(
        "❌ WEBHOOK SETUP:",
        error.message
      );
    }
  }

  console.log("");
  console.log("==============================================");
  console.log(
    "🚀 BOT MẶT ĐẤT MÀU XANH ONLINE"
  );
  console.log("==============================================");
  console.log(
    `🌐 PORT: ${PORT}`
  );
  console.log(
    `🔌 ZALO: ${
      ZALO_BOT_TOKEN
        ? "READY"
        : "MISSING"
    }`
  );
  console.log(
    `🧠 GEMINI: ${
      GEMINI_API_KEY
        ? "READY"
        : "MISSING"
    }`
  );
  console.log(
    `🧠 MODEL: ${
      activeGeminiModel ||
      GEMINI_MODELS[0]
    }`
  );
  console.log(
    `👑 ADMIN: ${
      ADMIN_ID
        ? "ĐÃ CẤU HÌNH"
        : "CHƯA CẤU HÌNH"
    }`
  );
  console.log(
    `👥 GROUP AI: ${
      groupReplyEnabled
        ? "ON"
        : "OFF"
    }`
  );
  console.log("");
  console.log(
    "📚 LỆNH:",
    [
      ...new Set(
        [...COMMANDS.values()]
          .map(
            (x) =>
              `/${x.name}`
          )
      ),
    ].join(", ")
  );
  console.log("");
  console.log(
    "🟢 ĐANG CHỜ ZALO..."
  );
  console.log(
    "=============================================="
  );
}

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    log(
      `🚀 Server listening on port ${PORT}`
    );

    startup().catch(
      (error) => {
        log(
          "❌ STARTUP ERROR:",
          error.message
        );
      }
    );
  }
);

// ============================================================
// PROCESS SAFETY
// ============================================================

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);
