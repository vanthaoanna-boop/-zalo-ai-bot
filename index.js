/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * LỆNH:
 * /help
 * /hepl
 * /ping
 * /id
 * /ad
 * /bot
 * /on
 * /off
 * /batquytac
 * /tatbatquytat
 * /adminid
 *
 * ENV:
 * ZALO_BOT_TOKEN=...
 * GEMINI_API_KEY=...
 * ADMIN_ID=...
 * ADMIN_IDS=id1,id2,id3
 * PUBLIC_URL=https://...
 * ZALO_WEBHOOK_SECRET=... (optional)
 *
 * Node.js >= 18
 * ============================================================
 */

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

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

// ============================================================
// ADMIN CONFIG
// ============================================================
//
// Có thể dùng:
//
// ADMIN_ID=123456
//
// hoặc:
//
// ADMIN_IDS=123456,789012,abcdef
//
// Có thể dùng cả hai.
// ============================================================

function parseAdminIds() {
  const values = [
    process.env.ADMIN_ID || "",
    process.env.ADMIN_IDS || "",
  ];

  const ids = [];

  for (const value of values) {
    String(value)
      .split(/[,\n;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((id) => {
        if (!ids.includes(id)) {
          ids.push(id);
        }
      });
  }

  return ids;
}

let ADMIN_IDS = parseAdminIds();

// ============================================================
// ZALO API
// ============================================================

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ============================================================
// GEMINI MODELS
// ============================================================

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
].filter(
  (value, index, array) =>
    value && array.indexOf(value) === index
);

// ============================================================
// STATE
// ============================================================

let botEnabled = true;
let unrestrictedMode = false;

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
  if (!value) return "NOT_SET";

  const string = String(value);

  if (string.length <= visible) {
    return "*".repeat(string.length);
  }

  return (
    string.slice(0, visible) +
    "*".repeat(
      Math.max(4, string.length - visible)
    )
  );
}

// ============================================================
// CONFIG VALIDATION
// ============================================================

function validateConfig() {
  console.log("");
  console.log(
    "================================================"
  );
  console.log("🤖 BOT MẶT ĐẤT MÀU XANH");
  console.log(
    "================================================"
  );

  console.log(`🌐 PORT: ${PORT}`);
  console.log(
    `🔗 PUBLIC URL: ${
      PUBLIC_URL || "NOT_SET"
    }`
  );

  console.log(
    `🔑 ZALO TOKEN: ${mask(
      ZALO_BOT_TOKEN
    )}`
  );

  console.log(
    `🧠 GEMINI KEY: ${mask(
      GEMINI_API_KEY
    )}`
  );

  console.log(
    `👑 ADMIN IDS: ${
      ADMIN_IDS.length
        ? ADMIN_IDS.join(", ")
        : "CHƯA CẤU HÌNH"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    "================================================"
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

  if (!ADMIN_IDS.length) {
    console.warn(
      "⚠️ CHƯA CÓ ADMIN ID"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Không có PUBLIC_URL / RENDER_EXTERNAL_URL"
    );
  }
}

// ============================================================
// HTTP POST JSON
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
    const response = await fetch(url, {
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
    });

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
    encodeURIComponent(
      ZALO_BOT_TOKEN
    ) +
    `/${method}`
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

  if (
    result.data &&
    result.data.ok === false
  ) {
    const description =
      result.data.description ||
      result.data.message ||
      JSON.stringify(result.data);

    const error = new Error(
      `Zalo API error: ${description}`
    );

    error.zaloResponse =
      result.data;

    throw error;
  }

  return result.data;
}

// ============================================================
// GET ME
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
    `getMe thất bại: ${JSON.stringify(
      data
    )}`
  );
}

// ============================================================
// SEND MESSAGE
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

  if (!text) {
    text =
      "Bot không có nội dung để trả lời.";
  }

  const chunks =
    splitText(text, 1900);

  for (const chunk of chunks) {
    const data =
      await zaloApi(
        "sendMessage",
        {
          chat_id:
            String(chatId),
          text: chunk,
        }
      );

    if (!data?.ok) {
      throw new Error(
        `Zalo sendMessage thất bại: ${JSON.stringify(
          data
        )}`
      );
    }
  }

  return true;
}

// ============================================================
// SPLIT TEXT
// ============================================================

function splitText(
  text,
  maxLength = 1900
) {
  if (!text) {
    return [""];
  }

  if (
    text.length <= maxLength
  ) {
    return [text];
  }

  const result = [];

  let remaining =
    String(text);

  while (
    remaining.length >
    maxLength
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
      remaining.slice(
        0,
        cut
      )
    );

    remaining =
      remaining
        .slice(cut)
        .trim();
  }

  if (remaining) {
    result.push(
      remaining
    );
  }

  return result;
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
      "⚠️ sendChatAction:",
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
Bạn là Bot Mặt Đất Màu Xanh.

Bạn là chatbot chạy trên Zalo.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên.
- Thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn.
- Câu hỏi phức tạp thì giải thích rõ.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.

Tên bot:
Bot Mặt Đất Màu Xanh.

Người tạo:
An Na & Hoàng Vũ.

Nếu người dùng hỏi:
- Ai tạo bot?
- Ai làm bot?
- Bot này của ai?
- Ai đứng sau bot?
- Ai tạo Bot Mặt Đất Màu Xanh?

thì trả lời:
An Na & Hoàng Vũ.

Không tự bịa người tạo khác.

Bot có hệ thống lệnh:
- /help
- /hepl
- /ping
- /id
- /ad
- /bot
- /on
- /off
- /batquytac
- /tatbatquytat
- /adminid
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
        `🧠 Gemini: ${model}`
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
              maxOutputTokens:
                2048,
            },
          },
          60000
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.httpStatus}: ${JSON.stringify(
            response.data
          )}`
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

      const text =
        data
          ?.candidates?.[0]
          ?.content?.parts
          ?.map(
            (part) =>
              part.text || ""
          )
          .join("")
          .trim();

      if (!text) {
        throw new Error(
          `Gemini không trả text: ${JSON.stringify(
            data
          )}`
        );
      }

      activeGeminiModel =
        model;

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

      // Tự động thử model tiếp theo.
      continue;
    }
  }

  throw new Error(
    `Tất cả Gemini model đều lỗi: ${
      lastError?.message ||
      "Unknown error"
    }`
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
    typeof body !== "object"
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

  return {
    eventName:
      data.event_name || "",

    message,

    chatId:
      message?.chat?.id
        ? String(
            message.chat.id
          )
        : "",

    chatType:
      message?.chat?.chat_type ||
      "",

    userId:
      message?.from?.id
        ? String(
            message.from.id
          )
        : "",

    userName:
      message?.from
        ?.display_name ||
      message?.from?.name ||
      "",

    text:
      typeof message?.text ===
      "string"
        ? message.text.trim()
        : "",

    messageId:
      message?.message_id
        ? String(
            message.message_id
          )
        : "",
  };
}

// ============================================================
// ADMIN SYSTEM
// ============================================================

function refreshAdminIds() {
  ADMIN_IDS =
    parseAdminIds();
}

function isAdmin(
  userId,
  chatId
) {
  refreshAdminIds();

  const uid =
    String(userId || "").trim();

  const cid =
    String(chatId || "").trim();

  if (
    !uid &&
    !cid
  ) {
    return false;
  }

  return ADMIN_IDS.some(
    (adminId) =>
      adminId === uid ||
      adminId === cid
  );
}

// ============================================================
// COMMAND SYSTEM
// ============================================================

const COMMANDS =
  new Map();

function registerCommand(
  name,
  config
) {
  const normalized =
    name.toLowerCase();

  const command = {
    name: normalized,
    ...config,
  };

  COMMANDS.set(
    normalized,
    command
  );

  if (
    Array.isArray(
      config.aliases
    )
  ) {
    for (
      const alias of
        config.aliases
    ) {
      COMMANDS.set(
        alias.toLowerCase(),
        command
      );
    }
  }
}

// ============================================================
// /HELP
// ============================================================

registerCommand(
  "help",
  {
    aliases: [
      "h",
      "menu",
      "hepl",
    ],

    description:
      "Hiện tất cả lệnh",

    usage: "/help",

    adminOnly: false,

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
        "",
      ];

      for (
        const command of
          unique.values()
      ) {
        lines.push(
          `/${command.name} — ${
            command.description ||
            ""
          }`
        );
      }

      lines.push("");
      lines.push(
        "💬 Có thể nhắn tin bình thường để chat với AI."
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

    usage: "/ping",

    adminOnly: false,

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
      "Xem User ID và Chat ID",

    usage: "/id",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      userName,
      chatType,
    }) {
      await sendMessage(
        chatId,
        [
          "🆔 THÔNG TIN ID",
          "",
          `Tên: ${
            userName ||
            "Không có"
          }`,
          `User ID: ${
            userId ||
            "Không có"
          }`,
          `Chat ID: ${
            chatId ||
            "Không có"
          }`,
          `Chat type: ${
            chatType ||
            "Không rõ"
          }`,
          "",
          "👉 Nếu muốn cấp admin, lấy User ID ở đây rồi thêm vào ADMIN_IDS trên Render.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /AD
// ============================================================

registerCommand(
  "ad",
  {
    description:
      "Kiểm tra tài khoản hiện tại có phải admin không",

    usage: "/ad",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      userName,
      chatType,
    }) {
      const admin =
        isAdmin(
          userId,
          chatId
        );

      refreshAdminIds();

      await sendMessage(
        chatId,
        [
          "👑 KIỂM TRA ADMIN",
          "",
          `Tên: ${
            userName ||
            "Không có"
          }`,
          `User ID: ${
            userId ||
            "Không có"
          }`,
          `Chat ID: ${
            chatId ||
            "Không có"
          }`,
          `Chat type: ${
            chatType ||
            "Không rõ"
          }`,
          "",
          `Trạng thái: ${
            admin
              ? "✅ ADMIN"
              : "❌ KHÔNG PHẢI ADMIN"
          }`,
          "",
          "📋 ADMIN IDS ĐANG CẤU HÌNH:",
          ADMIN_IDS.length
            ? ADMIN_IDS.join(
                "\n"
              )
            : "CHƯA CÓ",
          "",
          admin
            ? "🟢 Tài khoản này dùng được lệnh admin."
            : "⚠️ Hãy lấy User ID phía trên và thêm chính xác ID đó vào ADMIN_IDS trên Render.",
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
      "Thông tin bot",

    usage: "/bot",

    adminOnly: false,

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
          `Bot AI: ${
            botEnabled
              ? "🟢 BẬT"
              : "🔴 TẮT"
          }`,
          `Chế độ đặc biệt: ${
            unrestrictedMode
              ? "🟡 BẬT"
              : "⚪ TẮT"
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

    usage: "/on",

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

    usage: "/off",

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
// /BATQUYTAC
// ============================================================

registerCommand(
  "batquytac",
  {
    description:
      "Bật chế độ đặc biệt của bot",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      unrestrictedMode =
        true;

      await sendMessage(
        chatId,
        [
          "🟡 ĐÃ BẬT CHẾ ĐỘ ĐẶC BIỆT.",
          "",
          "Bot sẽ dùng cấu hình đặc biệt của bot.",
          "⚠️ Chế độ này không tắt các giới hạn an toàn của hệ thống AI.",
          "",
          "Dùng /tatbatquytat để tắt.",
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
      unrestrictedMode =
        false;

      await sendMessage(
        chatId,
        [
          "⚪ Đã TẮT chế độ đặc biệt.",
          "",
          "Bot trở về chế độ bình thường.",
        ].join("\n")
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
      "Xem danh sách admin đang cấu hình",

    usage:
      "/adminid",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      refreshAdminIds();

      await sendMessage(
        chatId,
        [
          "👑 ADMIN IDS",
          "",
          ADMIN_IDS.length
            ? ADMIN_IDS.join(
                "\n"
              )
            : "CHƯA CÓ ADMIN",
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

  log(
    `👑 ADMIN CHECK: user=${update.userId} chat=${update.chatId} result=${admin}`
  );

  if (
    command.adminOnly &&
    !admin
  ) {
    await sendMessage(
      update.chatId,
      [
        "⛔ Lệnh này chỉ dành cho admin.",
        "",
        `User ID của bạn: ${
          update.userId ||
          "Không lấy được"
        }`,
        "",
        "👉 Gõ /ad để xem thông tin admin.",
      ].join("\n")
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
// GROUP MODE
// ============================================================
//
// Trong nhóm:
//
// - Lệnh /... luôn được xử lý.
// - Tin nhắn thường KHÔNG trả lời để tránh spam.
//
// Trong chat riêng:
//
// - Tin nhắn thường được Gemini trả lời.
// ============================================================

function isGroupChat(
  chatType
) {
  const value =
    String(
      chatType || ""
    ).toUpperCase();

  return (
    value === "GROUP" ||
    value === "GROUP_CHAT" ||
    value === "GROUPS"
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
    chatType,
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  log(
    "================================================"
  );

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
    `💬 CHAT TYPE: ${
      chatType || "Unknown"
    }`
  );

  log(
    `💬 TEXT: ${text}`
  );

  // ----------------------------------------------------------
  // COMMAND
  // ----------------------------------------------------------

  const parsed =
    parseCommand(text);

  if (parsed) {
    const exists =
      COMMANDS.has(
        parsed.command
      );

    if (exists) {
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
        "Dùng /help hoặc /hepl để xem tất cả lệnh.",
      ].join("\n")
    );

    return;
  }

  // ----------------------------------------------------------
  // GROUP CHAT
  // ----------------------------------------------------------

  if (
    isGroupChat(
      chatType
    )
  ) {
    log(
      "👥 GROUP: bỏ qua tin nhắn thường để tránh spam."
    );

    return;
  }

  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------

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
    } catch (error) {
      log(
        "❌ MEMORY SEND ERROR:",
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
      "✅ ĐÃ GỬI TRẢ LỜI"
    );
  } catch (error) {
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
          "Gemini có thể đang hết quota hoặc model đang bận.",
          "Bot đã tự thử các model dự phòng.",
          "",
          "Vui lòng thử lại sau.",
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
  async (req, res) => {
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

    const update =
      normalizeWebhook(
        req.body
      );

    if (!update) {
      return res.json({
        ok: true,
      });
    }

    log(
      "📩 ZALO WEBHOOK"
    );

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

    // Trả lời webhook ngay.
    res.json({
      ok: true,
    });

    // --------------------------------------------------------
    // TEXT
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // IMAGE
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.image.received"
    ) {
      if (
        update.chatId
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

    // --------------------------------------------------------
    // STICKER
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.sticker.received"
    ) {
      if (
        update.chatId
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

    // --------------------------------------------------------
    // VOICE
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (
        update.chatId
      ) {
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

      return;
    }
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/",
  (req, res) => {
    refreshAdminIds();

    res.json({
      ok: true,
      bot:
        "Bot Mặt Đất Màu Xanh",
      server: "online",
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
      specialMode:
        unrestrictedMode,
      adminCount:
        ADMIN_IDS.length,
      webhook:
        PUBLIC_URL
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
      "⚠️ Không có PUBLIC_URL. Không set webhook."
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
      `setWebhook thất bại: ${JSON.stringify(
        data
      )}`
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
    "🧠 Đang test Gemini..."
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
        "❌ ZALO getMe ERROR:",
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

  refreshAdminIds();

  console.log("");
  console.log(
    "================================================"
  );
  console.log(
    "🚀 BOT MẶT ĐẤT MÀU XANH ONLINE"
  );
  console.log(
    "================================================"
  );

  console.log(
    `🌐 PORT: ${PORT}`
  );

  console.log(
    `🔌 ZALO BOT API: ${
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
    `👑 ADMIN COUNT: ${
      ADMIN_IDS.length
    }`
  );

  console.log(
    `🟢 BOT: ${
      botEnabled
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `🟡 SPECIAL MODE: ${
      unrestrictedMode
        ? "ON"
        : "OFF"
    }`
  );

  console.log("");

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
    "🟢 ĐANG CHỜ TIN NHẮN ZALO..."
  );

  console.log(
    "================================================"
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
