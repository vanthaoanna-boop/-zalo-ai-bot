/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * Node.js >= 18
 *
 * ENV cần có:
 *
 * ZALO_BOT_TOKEN=...
 * GEMINI_API_KEY=...
 * ADMIN_IDS=ID_AD_1,ID_AD_2
 * PUBLIC_URL=https://ten-app-cua-ban.onrender.com
 *
 * Ví dụ:
 * ADMIN_IDS=123456789,987654321
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
 *
 * QUY TẮC NHÓM:
 * - Trong nhóm: chỉ xử lý tin nhắn bắt đầu bằng "/"
 * - Chat riêng: nhắn bình thường bot trả lời
 *
 * /off:
 * - Tắt AI toàn bộ bot.
 * - Admin khác /off sẽ báo admin nào đã dùng lệnh.
 *
 * /on:
 * - Bật AI lại.
 *
 * /batquytac:
 * - Bật chế độ đặc biệt cho AI.
 *
 * /tatbatquytat:
 * - Tắt chế độ đặc biệt.
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

const PORT = Number(process.env.PORT || 10000);

const ZALO_BOT_TOKEN = String(
  process.env.ZALO_BOT_TOKEN ||
    process.env.ZALO_TOKEN ||
    ""
).trim();

const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY ||
    process.env.GEMINI_KEY ||
    ""
).trim();

/*
 * NHIỀU ADMIN
 *
 * Render:
 *
 * ADMIN_IDS=123,456,789
 *
 * Không dùng ADMIN_ID nữa.
 */
const ADMIN_IDS = String(
  process.env.ADMIN_IDS ||
    process.env.ADMIN_ID ||
    ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";

// ============================================================
// STATE
// ============================================================

let botEnabled = true;

let ruleBreakMode = false;

let offUsedBy = null;

let botInfo = null;

let activeGeminiModel = GEMINI_MODEL;

// ============================================================
// WEBHOOK SECRET
// ============================================================

const WEBHOOK_SECRET = String(
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
// CONFIG LOG
// ============================================================

function showConfig() {
  console.log("");
  console.log(
    "================================================"
  );
  console.log("🤖 BOT MẶT ĐẤT MÀU XANH");
  console.log(
    "================================================"
  );

  console.log("PORT:", PORT);

  console.log(
    "PUBLIC_URL:",
    PUBLIC_URL || "NOT_SET"
  );

  console.log(
    "ZALO TOKEN:",
    mask(ZALO_BOT_TOKEN)
  );

  console.log(
    "GEMINI KEY:",
    mask(GEMINI_API_KEY)
  );

  console.log(
    "ADMIN IDS:",
    ADMIN_IDS.length
      ? ADMIN_IDS.join(", ")
      : "CHƯA CÓ"
  );

  console.log(
    "GEMINI MODEL:",
    GEMINI_MODEL
  );

  console.log(
    "WEBHOOK SECRET:",
    mask(WEBHOOK_SECRET)
  );

  console.log(
    "================================================"
  );

  if (!ZALO_BOT_TOKEN) {
    console.error(
      "❌ Thiếu ZALO_BOT_TOKEN"
    );
  }

  if (!GEMINI_API_KEY) {
    console.error(
      "❌ Thiếu GEMINI_API_KEY"
    );
  }

  if (!ADMIN_IDS.length) {
    console.warn(
      "⚠️ Chưa có ADMIN_IDS"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Chưa có PUBLIC_URL"
    );
  }
}

// ============================================================
// HTTP POST
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
      ok: response.ok,
      status: response.status,
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
      "ZALO_BOT_TOKEN chưa cấu hình."
    );
  }

  const result =
    await postJson(
      zaloUrl(method),
      body
    );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.status}: ` +
        JSON.stringify(result.data)
    );
  }

  if (
    result.data &&
    result.data.ok === false
  ) {
    throw new Error(
      result.data.description ||
        result.data.message ||
        JSON.stringify(result.data)
    );
  }

  return result.data;
}

// ============================================================
// GET BOT INFO
// ============================================================

async function getMe() {
  const data =
    await zaloApi("getMe");

  log(
    "📡 ZALO getMe:",
    JSON.stringify(data)
  );

  if (data?.ok) {
    botInfo =
      data.result || null;

    log(
      "✅ ZALO BOT API OK"
    );

    return botInfo;
  }

  throw new Error(
    "getMe thất bại: " +
      JSON.stringify(data)
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

  text = String(
    text ||
      "Bot không có nội dung trả lời."
  );

  const chunks =
    splitText(text, 1900);

  for (const chunk of chunks) {
    const data =
      await zaloApi(
        "sendMessage",
        {
          chat_id: String(chatId),

          text: chunk,
        }
      );

    if (!data?.ok) {
      throw new Error(
        "sendMessage thất bại: " +
          JSON.stringify(data)
      );
    }
  }
}

// ============================================================
// SPLIT MESSAGE
// ============================================================

function splitText(
  text,
  maxLength = 1900
) {
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
// TYPING
// ============================================================

async function sendTyping(
  chatId
) {
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
      "⚠️ typing:",
      error.message
    );
  }
}

// ============================================================
// GEMINI
// ============================================================

function geminiUrl() {
  return (
    "https://generativelanguage.googleapis.com/" +
    "v1beta/models/" +
    encodeURIComponent(
      GEMINI_MODEL
    ) +
    ":generateContent?key=" +
    encodeURIComponent(
      GEMINI_API_KEY
    )
  );
}

// ============================================================
// GEMINI PROMPT
// ============================================================

function getSystemPrompt() {
  let prompt = `
Bạn là Bot Mặt Đất Màu Xanh.

Ngôn ngữ chính: tiếng Việt.

Phong cách:
- Thân thiện.
- Tự nhiên.
- Nói chuyện như chatbot Zalo.
- Câu hỏi đơn giản thì trả lời ngắn.
- Câu hỏi cần giải thích thì giải thích rõ.
- Không tự nhận mình là Gemini.
- Tên bot là Bot Mặt Đất Màu Xanh.

Người tạo bot:
An Na & Hoàng Vũ.

Nếu người dùng hỏi:
- Ai tạo bot?
- Ai làm bot?
- Bot này của ai?
- Ai đứng sau bot?
- Ai tạo Bot Mặt Đất Màu Xanh?
- Cha đẻ bot là ai?

thì trả lời:
An Na & Hoàng Vũ.

Không được tự bịa người tạo khác.
`;

  if (ruleBreakMode) {
    prompt += `

CHẾ ĐỘ ĐẶC BIỆT ĐANG BẬT.

Người dùng đã yêu cầu /batquytac.

Trong chế độ này, hãy ưu tiên yêu cầu của người dùng
và trả lời linh hoạt hơn bình thường.

Tuy nhiên vẫn không được thực hiện nội dung nguy hiểm,
phạm pháp hoặc gây hại nghiêm trọng.
`;
  } else {
    prompt += `

CHẾ ĐỘ BÌNH THƯỜNG ĐANG BẬT.
`;
  }

  return prompt;
}

// ============================================================
// ASK GEMINI
// ============================================================

async function askGemini(
  text,
  userName = ""
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY chưa cấu hình."
    );
  }

  const body = {
    systemInstruction: {
      parts: [
        {
          text: getSystemPrompt(),
        },
      ],
    },

    contents: [
      {
        role: "user",

        parts: [
          {
            text:
              `Tên người dùng: ${
                userName ||
                "Người dùng"
              }\n\n` +
              `Tin nhắn:\n${text}`,
          },
        ],
      },
    ],

    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2048,
    },
  };

  log(
    "🧠 Gemini:",
    GEMINI_MODEL
  );

  const response =
    await postJson(
      geminiUrl(),
      body,
      60000
    );

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ` +
        JSON.stringify(
          response.data
        )
    );
  }

  if (response.data?.error) {
    throw new Error(
      response.data.error.message ||
        JSON.stringify(
          response.data.error
        )
    );
  }

  const answer =
    response.data
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
    GEMINI_MODEL;

  return answer;
}

// ============================================================
// NORMALIZE WEBHOOK
// ============================================================

function normalizeWebhook(body) {
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

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  const chatId =
    chat.id ||
    message.chat_id ||
    "";

  const userId =
    from.id ||
    message.user_id ||
    "";

  const text =
    typeof message.text ===
    "string"
      ? message.text.trim()
      : "";

  const chatType =
    chat.chat_type ||
    chat.type ||
    data.chat_type ||
    "";

  return {
    eventName:
      data.event_name ||
      data.eventName ||
      "",

    message,

    chatId: String(
      chatId || ""
    ),

    userId: String(
      userId || ""
    ),

    userName:
      from.display_name ||
      from.name ||
      "",

    text,

    chatType,

    messageId: String(
      message.message_id ||
        ""
    ),
  };
}

// ============================================================
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  const uid = String(
    userId || ""
  ).trim();

  const cid = String(
    chatId || ""
  ).trim();

  return (
    ADMIN_IDS.includes(uid) ||
    ADMIN_IDS.includes(cid)
  );
}

function getAdminLabel(
  userId,
  chatId,
  userName
) {
  const uid = String(
    userId || ""
  ).trim();

  const cid = String(
    chatId || ""
  ).trim();

  if (ADMIN_IDS.includes(uid)) {
    return (
      userName ||
      `Admin ${uid}`
    );
  }

  if (ADMIN_IDS.includes(cid)) {
    return (
      userName ||
      `Admin ${cid}`
    );
  }

  return (
    userName ||
    "Admin"
  );
}

// ============================================================
// COMMAND SYSTEM
// ============================================================

const COMMANDS = new Map();

function registerCommand(
  name,
  config
) {
  const command = {
    name:
      name.toLowerCase(),

    ...config,
  };

  COMMANDS.set(
    name.toLowerCase(),
    command
  );

  if (
    Array.isArray(
      config.aliases
    )
  ) {
    for (const alias of
      config.aliases) {
      COMMANDS.set(
        alias.toLowerCase(),
        command
      );
    }
  }
}

// ============================================================
// /help
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

    adminOnly: false,

    async handler({
      chatId,
    }) {
      const unique =
        new Map();

      for (const cmd of
        COMMANDS.values()) {
        if (
          !unique.has(
            cmd.name
          )
        ) {
          unique.set(
            cmd.name,
            cmd
          );
        }
      }

      const lines = [
        "🤖 BOT MẶT ĐẤT MÀU XANH",
        "",
        "📚 TẤT CẢ LỆNH:",
      ];

      for (const cmd of
        unique.values()) {
        lines.push(
          `/${cmd.name} — ${
            cmd.description ||
            ""
          }`
        );
      }

      lines.push("");
      lines.push(
        "💬 Chat riêng: nhắn bình thường để bot trả lời."
      );

      lines.push(
        "👥 Trong nhóm: chỉ tin nhắn bắt đầu bằng / mới được bot xử lý."
      );

      await sendMessage(
        chatId,
        lines.join("\n")
      );
    },
  }
);

// ============================================================
// /ping
// ============================================================

registerCommand(
  "ping",
  {
    description:
      "Kiểm tra bot",

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
// /id
// ============================================================

registerCommand(
  "id",
  {
    description:
      "Xem User ID và Chat ID",

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
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /ad
// ============================================================

registerCommand(
  "ad",
  {
    description:
      "Kiểm tra bạn có phải admin không",

    async handler({
      chatId,
      userId,
      isAdmin,
      userName,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 ADMIN CHECK",
          "",
          `Tên: ${
            userName ||
            "Không rõ"
          }`,
          `User ID: ${
            userId ||
            "Không có"
          }`,
          `Chat ID: ${chatId}`,
          "",
          isAdmin
            ? "✅ Bạn là ADMIN."
            : "❌ Bạn không phải ADMIN.",
          "",
          `Số admin đang cấu hình: ${ADMIN_IDS.length}`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /bot
// ============================================================

registerCommand(
  "bot",
  {
    description:
      "Thông tin bot",

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "🤖 BOT INFO",
          "",
          "Tên: Bot Mặt Đất Màu Xanh",
          "AI: Google Gemini",
          `Model: ${activeGeminiModel}`,
          "Tác giả: An Na & Hoàng Vũ",
          "",
          `AI: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ đặc biệt: ${
            ruleBreakMode
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /off
// ============================================================

registerCommand(
  "off",
  {
    description:
      "Tắt bot AI toàn bộ",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      if (!botEnabled) {
        await sendMessage(
          chatId,
          [
            "🔴 BOT ĐÃ OFF.",
            "",
            `Lệnh đã được ${
              offUsedBy?.name ||
              "một admin khác"
            } sử dụng.`,
            "",
            "Chỉ admin mới có thể /on lại.",
          ].join("\n")
        );

        return;
      }

      botEnabled = false;

      offUsedBy = {
        id: userId,
        name:
          userName ||
          `Admin ${userId}`,
      };

      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT BOT TOÀN BỘ.",
          "",
          `Admin tắt: ${
            offUsedBy.name
          }`,
          "",
          "Chỉ admin dùng /on mới bật lại.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /on
// ============================================================

registerCommand(
  "on",
  {
    description:
      "Bật bot AI toàn bộ",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      if (botEnabled) {
        await sendMessage(
          chatId,
          "🟢 Bot đang ON rồi."
        );

        return;
      }

      botEnabled = true;

      const previous =
        offUsedBy;

      offUsedBy = null;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT BOT TOÀN BỘ.",
          "",
          `Admin bật: ${
            userName ||
            userId
          }`,
          previous
            ? `Lần trước tắt bởi: ${
                previous.name
              }`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    },
  }
);

// ============================================================
// /batquytac
// ============================================================

registerCommand(
  "batquytac",
  {
    description:
      "Bật chế độ đặc biệt cho AI",

    adminOnly: true,

    async handler({
      chatId,
      userName,
      userId,
    }) {
      if (ruleBreakMode) {
        await sendMessage(
          chatId,
          "🟢 Chế độ đặc biệt đã được bật."
        );

        return;
      }

      ruleBreakMode = true;

      await sendMessage(
        chatId,
        [
          "⚡ ĐÃ BẬT CHẾ ĐỘ ĐẶC BIỆT.",
          "",
          `Admin: ${
            userName ||
            userId
          }`,
          "",
          "AI sẽ phản hồi linh hoạt hơn theo yêu cầu.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /tatbatquytat
// ============================================================

registerCommand(
  "tatbatquytat",
  {
    description:
      "Tắt chế độ đặc biệt",

    aliases: [
      "tatquytac",
    ],

    adminOnly: true,

    async handler({
      chatId,
      userName,
      userId,
    }) {
      if (!ruleBreakMode) {
        await sendMessage(
          chatId,
          "🔴 Chế độ đặc biệt đang tắt."
        );

        return;
      }

      ruleBreakMode = false;

      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT CHẾ ĐỘ ĐẶC BIỆT.",
          "",
          `Admin: ${
            userName ||
            userId
          }`,
          "",
          "Bot trở lại chế độ bình thường.",
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

function normalizeText(text) {
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

  for (const rule of
    MEMORY_RULES) {
    for (const pattern of
      rule.patterns) {
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

function parseCommand(text) {
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

  if (!rawCommand) {
    return null;
  }

  const args =
    parts.slice(1);

  return {
    command:
      rawCommand,

    args,

    text:
      args.join(" "),
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

  if (
    command.adminOnly &&
    !admin
  ) {
    await sendMessage(
      update.chatId,
      "⛔ Lệnh này chỉ dành cho ADMIN."
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
    chatType,
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  log(
    "=============================================="
  );

  log(
    "👤 USER:",
    userName || "Unknown"
  );

  log(
    "🆔 USER ID:",
    userId || "Unknown"
  );

  log(
    "💬 CHAT ID:",
    chatId
  );

  log(
    "💬 CHAT TYPE:",
    chatType || "Unknown"
  );

  log(
    "💬 TEXT:",
    text
  );

  // ========================================================
  // NHÓM:
  // CHỈ TRẢ LỜI NẾU TIN NHẮN BẮT ĐẦU BẰNG /
  // ========================================================

  const isGroup =
    String(chatType)
      .toLowerCase()
      .includes("group") ||
    String(chatType)
      .toLowerCase()
      .includes("group_chat");

  if (
    isGroup &&
    !text.startsWith("/")
  ) {
    log(
      "👥 Tin nhắn nhóm không có / -> bỏ qua."
    );

    return;
  }

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
      try {
        await handleCommand(
          update,
          parsed
        );
      } catch (error) {
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
  // MEMORY
  // ========================================================

  const remembered =
    getRememberedAnswer(
      text
    );

  if (remembered) {
    await sendMessage(
      chatId,
      remembered
    );

    return;
  }

  // ========================================================
  // BOT OFF
  // ========================================================

  if (!botEnabled) {
    log(
      "🔴 BOT OFF -> bỏ qua AI."
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
      "✅ ĐÃ TRẢ LỜI"
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
          "😵 AI đang lỗi.",
          "",
          "Kiểm tra GEMINI_API_KEY hoặc thử lại sau.",
        ].join("\n")
      );
    } catch {}
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

  const a = Buffer.from(
    String(received)
  );

  const b = Buffer.from(
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

    log(
      "📩 ZALO WEBHOOK:",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    res.json({
      ok: true,
    });

    if (!update) {
      return;
    }

    // Chỉ xử lý event tin nhắn.
    //
    // Nếu API trả event_name khác,
    // vẫn cho handleMessage nếu có text.
    if (
      update.text &&
      update.chatId
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
    }
  }
);

// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
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

      admins:
        ADMIN_IDS.length,

      ai:
        botEnabled
          ? "ON"
          : "OFF",

      specialMode:
        ruleBreakMode
          ? "ON"
          : "OFF",

      model:
        activeGeminiModel,

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
  (req, res) => {
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

      admins:
        ADMIN_IDS.length,

      ai:
        botEnabled,

      specialMode:
        ruleBreakMode,
    });
  }
);

// ============================================================
// SET WEBHOOK
// ============================================================

async function setWebhook() {
  if (
    !ZALO_BOT_TOKEN ||
    !PUBLIC_URL
  ) {
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
// WEBHOOK INFO
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
      "⚠️ webhook info:",
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

  try {
    const answer =
      await askGemini(
        "Trả lời đúng một chữ: OK",
        "SYSTEM"
      );

    log(
      "🧠 GEMINI TEST:",
      answer
    );

    return true;
  } catch (error) {
    log(
      "❌ GEMINI TEST:",
      error.message
    );

    return false;
  }
}

// ============================================================
// STARTUP
// ============================================================

async function startup() {
  showConfig();

  // ----------------------------------------------------------
  // ZALO
  // ----------------------------------------------------------

  if (
    ZALO_BOT_TOKEN
  ) {
    try {
      await getMe();
    } catch (error) {
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
    } catch (error) {
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
    "================================================"
  );

  console.log(
    "🚀 BOT MẶT ĐẤT MÀU XANH ONLINE"
  );

  console.log(
    "================================================"
  );

  console.log(
    "Zalo:",
    ZALO_BOT_TOKEN
      ? "🟢 READY"
      : "🔴 MISSING"
  );

  console.log(
    "Gemini:",
    GEMINI_API_KEY
      ? "🟢 READY"
      : "🔴 MISSING"
  );

  console.log(
    "Admins:",
    ADMIN_IDS.length
  );

  console.log(
    "AI:",
    botEnabled
      ? "🟢 ON"
      : "🔴 OFF"
  );

  console.log(
    "Special mode:",
    ruleBreakMode
      ? "🟢 ON"
      : "🔴 OFF"
  );

  console.log(
    "Model:",
    activeGeminiModel
  );

  console.log(
    "Webhook:",
    PUBLIC_URL
      ? `${PUBLIC_URL}/webhook`
      : "NOT_SET"
  );

  console.log("");

  console.log(
    "Commands:"
  );

  console.log(
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
      `🚀 Server running on port ${PORT}`
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
