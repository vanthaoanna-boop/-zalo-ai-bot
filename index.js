/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * Node.js >= 18
 *
 * LỆNH:
 * /help
 * /hepl
 * /ping
 * /id
 * /bot
 * /on
 * /off
 * /adminid
 * /batquytac
 * /tatbatquytat
 *
 * CHAT RIÊNG:
 * - Nhắn bình thường -> Gemini trả lời
 *
 * NHÓM:
 * - Chỉ xử lý lệnh bắt đầu bằng /
 * - Không tự trả lời mọi tin nhắn trong nhóm
 *
 * SAU NÀY THÊM LỆNH:
 *
 * registerCommand("ff", {
 *   aliases: ["freefire"],
 *   description: "Lệnh Free Fire",
 *   adminOnly: false,
 *   async handler({ chatId, args, text }) {
 *     await sendMessage(chatId, "FF: " + text);
 *   }
 * });
 *
 * ============================================================
 */

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(
  express.json({
    limit: "2mb",
  })
);

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(
  process.env.PORT || 10000
);

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
)
  .trim()
  .replace(/\/+$/, "");

// ============================================================
// ZALO API
// ============================================================

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ============================================================
// GEMINI MODELS
// ============================================================
//
// Có thể đổi bằng biến môi trường:
// GEMINI_MODEL=gemini-2.5-flash
//
// Thứ tự sẽ thử:
// 1. GEMINI_MODEL
// 2. gemini-2.5-flash
// 3. gemini-2.0-flash
//
// ============================================================

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-2.5-flash",

  "gemini-2.0-flash",
];

// ============================================================
// BOT STATE
// ============================================================

let botEnabled = true;

// /batquytac
// true = chế độ đặc biệt được bật
//
// Lưu ý:
// Không dùng chế độ này để bỏ qua luật an toàn của nền tảng.
// Nó chỉ là một cờ trạng thái để bạn mở rộng logic bot.
let specialMode = false;

let botInfo = null;

let activeGeminiModel = null;

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
  console.log(
    new Date().toISOString(),
    ...args
  );
}

function mask(value, visible = 4) {
  if (!value) {
    return "NOT_SET";
  }

  if (value.length <= visible) {
    return "*".repeat(value.length);
  }

  return (
    value.slice(0, visible) +
    "*".repeat(
      Math.max(4, value.length - visible)
    )
  );
}

// ============================================================
// CONFIG CHECK
// ============================================================

function validateConfig() {
  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "🤖 BOT MẶT ĐẤT MÀU XANH"
  );
  console.log(
    "=============================================="
  );

  console.log(
    "🌐 PORT:",
    PORT
  );

  console.log(
    "🔗 PUBLIC URL:",
    PUBLIC_URL || "NOT_SET"
  );

  console.log(
    "🔑 ZALO TOKEN:",
    mask(ZALO_BOT_TOKEN)
  );

  console.log(
    "🧠 GEMINI KEY:",
    mask(GEMINI_API_KEY)
  );

  console.log(
    "👑 ADMIN ID:",
    ADMIN_ID || "NOT_SET"
  );

  console.log(
    "🔐 WEBHOOK SECRET:",
    mask(WEBHOOK_SECRET)
  );

  console.log(
    "=============================================="
  );

  if (!ZALO_BOT_TOKEN) {
    console.error(
      "❌ THIẾU ZALO_BOT_TOKEN"
    );
  }

  if (!GEMINI_API_KEY) {
    console.error(
      "❌ THIẾU GEMINI_API_KEY"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Chưa có PUBLIC_URL / RENDER_EXTERNAL_URL"
    );
  }
}

// ============================================================
// GENERIC POST JSON
// ============================================================

async function postJson(
  url,
  body,
  timeoutMs = 30000
) {
  const controller =
    new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          body === undefined
            ? undefined
            : JSON.stringify(body),

        signal: controller.signal,
      }
    );

    const text =
      await response.text();

    let data;

    try {
      data = text
        ? JSON.parse(text)
        : {};
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
  return (
    `${ZALO_API_BASE}/bot` +
    `${encodeURIComponent(
      ZALO_BOT_TOKEN
    )}/${method}`
  );
}

async function zaloApi(
  method,
  body
) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình."
    );
  }

  const result =
    await postJson(
      zaloUrl(method),
      body
    );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ` +
        JSON.stringify(
          result.data
        )
    );
  }

  if (
    result.data &&
    result.data.ok === false
  ) {
    const description =
      result.data.description ||
      result.data.message ||
      JSON.stringify(
        result.data
      );

    throw new Error(
      `Zalo API error: ${description}`
    );
  }

  return result.data;
}

// ============================================================
// ZALO GET ME
// ============================================================

async function getMe() {
  log(
    "🔎 Đang kiểm tra Zalo Bot API..."
  );

  const data =
    await zaloApi("getMe");

  botInfo =
    data?.result || null;

  log(
    "📡 ZALO getMe:",
    JSON.stringify(data)
  );

  if (data?.ok) {
    log(
      "✅ ZALO BOT API: OK"
    );

    if (botInfo) {
      log(
        "🤖 BOT INFO:",
        JSON.stringify(botInfo)
      );
    }

    return botInfo;
  }

  throw new Error(
    "getMe thất bại: " +
      JSON.stringify(data)
  );
}

// ============================================================
// SPLIT MESSAGE
// ============================================================

function splitText(
  text,
  maxLength = 1900
) {
  if (!text) {
    return [""];
  }

  text = String(text);

  if (text.length <= maxLength) {
    return [text];
  }

  const result = [];

  let remaining = text;

  while (
    remaining.length > maxLength
  ) {
    let cut =
      remaining.lastIndexOf(
        "\n",
        maxLength
      );

    if (
      cut <
      Math.floor(
        maxLength * 0.5
      )
    ) {
      cut =
        remaining.lastIndexOf(
          " ",
          maxLength
        );
    }

    if (
      cut <
      Math.floor(
        maxLength * 0.5
      )
    ) {
      cut = maxLength;
    }

    result.push(
      remaining.slice(0, cut)
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
// SEND ZALO MESSAGE
// ============================================================

async function sendMessage(
  chatId,
  text
) {
  if (!chatId) {
    throw new Error(
      "Không có chat_id."
    );
  }

  const chunks =
    splitText(
      text || "Không có nội dung."
    );

  for (
    const chunk of chunks
  ) {
    const data =
      await zaloApi(
        "sendMessage",
        {
          chat_id:
            String(chatId),

          text: String(
            chunk
          ),
        }
      );

    if (!data?.ok) {
      throw new Error(
        "Zalo sendMessage thất bại: " +
          JSON.stringify(data)
      );
    }
  }

  return true;
}

// ============================================================
// TYPING
// ============================================================

async function sendTyping(
  chatId
) {
  try {
    await zaloApi(
      "sendChatAction",
      {
        chat_id:
          String(chatId),

        action: "typing",
      }
    );
  } catch (error) {
    log(
      "⚠️ Typing lỗi:",
      error.message
    );
  }
}

// ============================================================
// GEMINI
// ============================================================

function geminiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/" +
    "v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(
      GEMINI_API_KEY
    )
  );
}

// ============================================================
// GEMINI SYSTEM PROMPT
// ============================================================

const GEMINI_SYSTEM_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh, chatbot chạy trên Zalo.

Trả lời bằng tiếng Việt.

Phong cách:
- Thân thiện.
- Tự nhiên.
- Ngắn gọn khi câu hỏi đơn giản.
- Không tự nhận mình là Google Gemini.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

GHI NHỚ:

Nếu người dùng hỏi:
- Ai tạo bot?
- Ai làm bot?
- Ai tạo Bot Mặt Đất Màu Xanh?
- Bot này của ai?
- Ai đứng sau bot?
- Ai là cha đẻ của bot?

hoặc câu có ý nghĩa tương đương,

hãy trả lời:

An Na & Hoàng Vũ.

Không tự bịa người tạo khác.

Nếu người dùng hỏi chuyện bình thường,
hãy trả lời như một trợ lý AI.
`;

// ============================================================
// ASK GEMINI
// ============================================================

async function askGemini(
  userText,
  userName = ""
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY chưa được cấu hình."
    );
  }

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

Tin nhắn:
${userText}
`;

  let lastError = null;

  for (
    const model of GEMINI_MODELS
  ) {
    try {
      log(
        "🧠 Gemini model:",
        model
      );

      const response =
        await postJson(
          geminiUrl(model),
          {
            systemInstruction: {
              parts: [
                {
                  text:
                    GEMINI_SYSTEM_PROMPT,
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

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.httpStatus}: ` +
            JSON.stringify(
              response.data
            )
        );
      }

      const data =
        response.data;

      if (data?.error) {
        throw new Error(
          data.error.message ||
            JSON.stringify(
              data.error
            )
        );
      }

      const answer =
        data
          ?.candidates?.[0]
          ?.content?.parts
          ?.map(
            (part) =>
              part.text || ""
          )
          .join("")
          .trim();

      if (!answer) {
        throw new Error(
          "Gemini không trả về nội dung."
        );
      }

      activeGeminiModel =
        model;

      log(
        "✅ GEMINI OK:",
        model
      );

      return answer;
    } catch (error) {
      lastError =
        error;

      log(
        "⚠️ GEMINI ERROR:",
        model,
        error.message
      );
    }
  }

  throw new Error(
    "Gemini lỗi: " +
      (
        lastError?.message ||
        "Unknown error"
      )
  );
}

// ============================================================
// NORMALIZE WEBHOOK
// ============================================================

function normalizeWebhook(
  body
) {
  if (
    !body ||
    typeof body !==
      "object"
  ) {
    return null;
  }

  const data =
    body.result &&
    typeof body.result ===
      "object"
      ? body.result
      : body;

  const message =
    data.message || {};

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  return {
    eventName:
      data.event_name ||
      data.eventName ||
      "",

    message,

    chatId: chat.id
      ? String(chat.id)
      : "",

    chatType:
      chat.chat_type ||
      chat.type ||
      "",

    userId: from.id
      ? String(from.id)
      : "",

    userName:
      from.display_name ||
      from.name ||
      "",

    text:
      typeof message.text ===
      "string"
        ? message.text.trim()
        : "",

    messageId:
      message.message_id
        ? String(
            message.message_id
          )
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
  const normalized =
    name
      .toLowerCase()
      .replace(
        /^\//,
        ""
      );

  const command = {
    name: normalized,
    aliases:
      config.aliases || [],
    description:
      config.description ||
      "",
    usage:
      config.usage ||
      `/${normalized}`,
    adminOnly:
      Boolean(
        config.adminOnly
      ),
    handler:
      config.handler,
  };

  COMMANDS.set(
    normalized,
    command
  );

  for (
    const alias of command.aliases
  ) {
    COMMANDS.set(
      String(alias)
        .toLowerCase()
        .replace(
          /^\//,
          ""
        ),
      command
    );
  }
}

// ============================================================
// /HELP
// ============================================================

registerCommand(
  "help",
  {
    aliases: [
      "hepl",
      "h",
      "menu",
    ],

    description:
      "Xem tất cả lệnh",

    usage:
      "/help",

    async handler({
      chatId,
    }) {
      const unique =
        new Map();

      for (
        const command of
          COMMANDS.values()
      ) {
        if (
          !unique.has(
            command.name
          )
        ) {
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

      for (
        const command of
          unique.values()
      ) {
        lines.push(
          `• ${command.usage} — ${command.description}`
        );
      }

      lines.push(
        "",
        "💬 Chat riêng: nhắn bình thường để hỏi AI.",
        "👥 Nhóm: bot chỉ xử lý lệnh để tránh spam."
      );

      await sendMessage(
        chatId,
        lines.join("\n")
      );
    },
  }
);

// ============================================================
// /PING
// ============================================================

registerCommand(
  "ping",
  {
    description:
      "Kiểm tra bot",

    usage:
      "/ping",

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        "🏓 Pong!\n🟢 Bot đang hoạt động."
      );
    },
  }
);

// ============================================================
// /ID
// ============================================================

registerCommand(
  "id",
  {
    description:
      "Xem Chat ID và User ID",

    usage:
      "/id",

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
          `Loại chat: ${
            chatType ||
            "Không rõ"
          }`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /BOT
// ============================================================

registerCommand(
  "bot",
  {
    description:
      "Xem thông tin bot",

    usage:
      "/bot",

    async handler({
      chatId,
    }) {
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
          `Trạng thái: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ đặc biệt: ${
            specialMode
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /ON
// ============================================================

registerCommand(
  "on",
  {
    description:
      "Bật bot AI",

    usage:
      "/on",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      botEnabled = true;

      await sendMessage(
        chatId,
        "🟢 Đã BẬT bot AI."
      );
    },
  }
);

// ============================================================
// /OFF
// ============================================================

registerCommand(
  "off",
  {
    description:
      "Tắt bot AI",

    usage:
      "/off",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      botEnabled = false;

      await sendMessage(
        chatId,
        "🔴 Đã TẮT bot AI.\nDùng /on để bật lại."
      );
    },
  }
);

// ============================================================
// /ADMINID
// ============================================================

registerCommand(
  "adminid",
  {
    description:
      "Xem ID admin",

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
            ADMIN_ID ||
            "CHƯA CẤU HÌNH"
          }`,
          "",
          "Dùng /id để lấy Chat ID."
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /BATQUYTAC
// ============================================================

registerCommand(
  "batquytac",
  {
    description:
      "Bật chế độ đặc biệt",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      specialMode = true;

      await sendMessage(
        chatId,
        [
          "🟢 Đã bật chế độ đặc biệt.",
          "",
          "Bot sẽ đánh dấu trạng thái này để các lệnh mở rộng sử dụng.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /TATBATQUYTAT
// ============================================================

registerCommand(
  "tatbatquytat",
  {
    description:
      "Tắt chế độ đặc biệt",

    usage:
      "/tatbatquytat",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      specialMode = false;

      await sendMessage(
        chatId,
        [
          "🔴 Đã tắt chế độ đặc biệt.",
          "",
          "Bot trở về chế độ bình thường.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// MEMORY
// ============================================================

const MEMORY_RULES = [
  {
    patterns: [
      "ai tao ra bot mat dat mau xanh",
      "ai tao bot mat dat mau xanh",
      "ai lam bot mat dat mau xanh",
      "ai tao bot nay",
      "ai lam bot nay",
      "bot nay cua ai",
      "bot cua ai",
      "ai tao bot",
      "ai lam bot",
      "cha de bot",
      "ai dung sau bot",
      "tac gia bot",
    ],

    answer:
      "An Na & Hoàng Vũ.",
  },
];

// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(
  text
) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /đ/g,
      "d"
    )
    .replace(
      /[?!.,;:()[\]{}"'`]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

// ============================================================
// MEMORY MATCH
// ============================================================

function getRememberedAnswer(
  text
) {
  const normalized =
    normalizeText(text);

  for (
    const rule of
      MEMORY_RULES
  ) {
    for (
      const pattern of
        rule.patterns
    ) {
      const p =
        normalizeText(
          pattern
        );

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
// PARSE COMMAND
// ============================================================

function parseCommand(
  text
) {
  const value =
    String(text || "")
      .trim();

  if (
    !value.startsWith("/")
  ) {
    return null;
  }

  const parts =
    value.split(/\s+/);

  const command =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  if (!command) {
    return null;
  }

  return {
    command,

    args:
      parts.slice(1),

    text:
      parts
        .slice(1)
        .join(" "),
  };
}

// ============================================================
// ADMIN CHECK
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
      ADMIN_ID ||
    String(chatId) ===
      ADMIN_ID
  );
}

// ============================================================
// GROUP CHECK
// ============================================================

function isGroup(update) {
  const type =
    String(
      update.chatType || ""
    ).toLowerCase();

  return (
    type.includes("group") ||
    type === "group" ||
    type === "supergroup"
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

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  const group =
    isGroup(update);

  log(
    "=============================================="
  );

  log(
    "👤 USER:",
    userName ||
      "Unknown"
  );

  log(
    "🆔 USER ID:",
    userId ||
      "Unknown"
  );

  log(
    "💬 CHAT ID:",
    chatId
  );

  log(
    "💬 CHAT TYPE:",
    update.chatType ||
      "Unknown"
  );

  log(
    "💬 TEXT:",
    text
  );

  // ========================================================
  // COMMAND
  // ========================================================

  const parsed =
    parseCommand(text);

  if (parsed) {
    if (
      COMMANDS.has(
        parsed.command
      )
    ) {
      log(
        "⚙️ COMMAND:",
        parsed.command
      );

      try {
        await handleCommand(
          update,
          parsed
        );
      } catch (
        error
      ) {
        log(
          "❌ COMMAND ERROR:",
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

  // ========================================================
  // NHÓM
  // ========================================================
  //
  // Trong nhóm:
  // Tin nhắn bình thường KHÔNG được gửi Gemini.
  // Chỉ lệnh /... mới được xử lý ở trên.
  //
  // ========================================================

  if (group) {
    log(
      "👥 Tin nhắn nhóm không phải lệnh -> bỏ qua."
    );

    return;
  }

  // ========================================================
  // MEMORY
  // ========================================================

  const remembered =
    getRememberedAnswer(
      text
    );

  if (remembered) {
    log(
      "🧠 MEMORY HIT"
    );

    try {
      await sendMessage(
        chatId,
        remembered
      );
    } catch (
      error
    ) {
      log(
        "❌ MEMORY SEND ERROR:",
        error.message
      );
    }

    return;
  }

  // ========================================================
  // BOT OFF
  // ========================================================

  if (!botEnabled) {
    log(
      "🔴 BOT OFF -> bỏ qua."
    );

    return;
  }

  // ========================================================
  // GEMINI
  // ========================================================

  await sendTyping(
    chatId
  );

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
      "✅ Đã gửi câu trả lời."
    );
  } catch (
    error
  ) {
    log(
      "❌ GEMINI ERROR:",
      error.message
    );

    try {
      await sendMessage(
        chatId,
        [
          "😵 Bot đang gặp lỗi AI.",
          "",
          "Kiểm tra GEMINI_API_KEY hoặc thử lại sau.",
        ].join("\n")
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

function verifyWebhook(
  req
) {
  const received =
    req.headers[
      "x-bot-api-secret-token"
    ];

  if (!received) {
    return false;
  }

  const a =
    Buffer.from(
      String(received)
    );

  const b =
    Buffer.from(
      WEBHOOK_SECRET
    );

  if (
    a.length !==
    b.length
  ) {
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
  async (
    req,
    res
  ) => {
    // ------------------------------------------------------
    // AUTH
    // ------------------------------------------------------

    if (
      !verifyWebhook(req)
    ) {
      log(
        "🚫 WEBHOOK AUTH FAILED"
      );

      return res
        .status(403)
        .json({
          ok: false,
          error:
            "Unauthorized",
        });
    }

    // ------------------------------------------------------
    // NORMALIZE
    // ------------------------------------------------------

    const update =
      normalizeWebhook(
        req.body
      );

    log(
      "📩 ZALO WEBHOOK:",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    if (!update) {
      return res.json({
        ok: true,
      });
    }

    log(
      "📌 EVENT:",
      update.eventName
    );

    // ------------------------------------------------------
    // TRẢ 200 NGAY
    // ------------------------------------------------------

    res.json({
      ok: true,
    });

    // ------------------------------------------------------
    // TEXT
    // ------------------------------------------------------

    if (
      update.eventName ===
        "message.text.received" ||
      update.text
    ) {
      handleMessage(
        update
      ).catch(
        (error) => {
          log(
            "❌ HANDLE ERROR:",
            error.message
          );
        }
      );

      return;
    }

    // ------------------------------------------------------
    // IMAGE
    // ------------------------------------------------------

    if (
      update.eventName ===
      "message.image.received"
    ) {
      if (
        update.chatId &&
        !isGroup(update)
      ) {
        sendMessage(
          update.chatId,
          "🖼️ Bot đã nhận được ảnh. Chức năng xử lý ảnh sẽ bổ sung sau."
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

    // ------------------------------------------------------
    // STICKER
    // ------------------------------------------------------

    if (
      update.eventName ===
      "message.sticker.received"
    ) {
      if (
        update.chatId &&
        !isGroup(update)
      ) {
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

    // ------------------------------------------------------
    // VOICE
    // ------------------------------------------------------

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (
        update.chatId &&
        !isGroup(update)
      ) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại. Chức năng xử lý voice sẽ bổ sung sau."
        ).catch(
          (error) => {
            log(
              "❌ VOICE ERROR:",
              error.message
            );
          }
        );
      }

      return;
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
    res.status(200).json({
      ok: true,

      bot:
        "Bot Mặt Đất Màu Xanh",

      server:
        "online",

      zalo:
        Boolean(
          ZALO_BOT_TOKEN
        ),

      gemini:
        Boolean(
          GEMINI_API_KEY
        ),

      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],

      botEnabled,

      specialMode,

      webhook:
        PUBLIC_URL
          ? `${PUBLIC_URL}/webhook`
          : null,
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (
    req,
    res
  ) => {
    res.json({
      ok: true,
      status:
        "online",
      zalo:
        Boolean(
          ZALO_BOT_TOKEN
        ),
      gemini:
        Boolean(
          GEMINI_API_KEY
        ),
      botEnabled,
      specialMode,
    });
  }
);

// ============================================================
// SET WEBHOOK
// ============================================================

async function setWebhook() {
  if (
    !ZALO_BOT_TOKEN
  ) {
    return;
  }

  if (!PUBLIC_URL) {
    log(
      "⚠️ Không có PUBLIC_URL -> bỏ qua setWebhook."
    );

    return;
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log(
    "🔗 SET WEBHOOK:",
    webhookUrl
  );

  const data =
    await zaloApi(
      "setWebhook",
      {
        url:
          webhookUrl,

        secret_token:
          WEBHOOK_SECRET,
      }
    );

  log(
    "📡 setWebhook:",
    JSON.stringify(data)
  );

  if (!data?.ok) {
    throw new Error(
      "setWebhook thất bại: " +
        JSON.stringify(data)
    );
  }

  log(
    "✅ WEBHOOK ĐÃ SET"
  );
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
  } catch (
    error
  ) {
    log(
      "⚠️ getWebhookInfo:",
      error.message
    );
  }
}

// ============================================================
// TEST GEMINI
// ============================================================

async function testGemini() {
  if (
    !GEMINI_API_KEY
  ) {
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
  } catch (
    error
  ) {
    log(
      "❌ GEMINI TEST FAILED:",
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

  // ----------------------------------------------------------
  // ZALO
  // ----------------------------------------------------------

  if (
    ZALO_BOT_TOKEN
  ) {
    try {
      await getMe();
    } catch (
      error
    ) {
      log(
        "❌ ZALO ERROR:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  if (
    GEMINI_API_KEY
  ) {
    await testGemini();
  }

  // ----------------------------------------------------------
  // WEBHOOK
  // ----------------------------------------------------------

  if (
    ZALO_BOT_TOKEN &&
    PUBLIC_URL
  ) {
    try {
      await setWebhook();
      await getWebhookInfo();
    } catch (
      error
    ) {
      log(
        "❌ WEBHOOK ERROR:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // FINAL
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "🚀 BOT MẶT ĐẤT MÀU XANH ONLINE"
  );
  console.log(
    "=============================================="
  );

  console.log(
    "🌐 PORT:",
    PORT
  );

  console.log(
    "🔌 ZALO:",
    ZALO_BOT_TOKEN
      ? "READY"
      : "MISSING"
  );

  console.log(
    "🧠 GEMINI:",
    GEMINI_API_KEY
      ? "READY"
      : "MISSING"
  );

  console.log(
    "🧠 MODEL:",
    activeGeminiModel ||
      GEMINI_MODELS[0]
  );

  console.log(
    "👑 ADMIN:",
    ADMIN_ID
      ? "ĐÃ CẤU HÌNH"
      : "CHƯA CẤU HÌNH"
  );

  console.log(
    "📚 COMMANDS:",
    [
      ...new Set(
        [
          ...COMMANDS.values(),
        ].map(
          (x) =>
            `/${x.name}`
        )
      ),
    ].join(", ")
  );

  console.log("");
  console.log(
    "👥 GROUP MODE: CHỈ LỆNH"
  );

  console.log(
    "💬 PRIVATE MODE: AI"
  );

  console.log("");
  console.log(
    "🟢 ĐANG CHỜ TIN NHẮN..."
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
