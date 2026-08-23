# index.js — Bot Mặt Đất Màu Xanh

```js
/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * Zalo Bot Platform + Google Gemini
 *
 * Node.js >= 18
 *
 * FEATURES
 * ------------------------------------------------------------
 * /hepl
 * /help
 * /ping
 * /id
 * /bot
 * /on
 * /off
 * /adminid
 * /batquytac
 * /tatbatquytat
 *
 * ADMIN_ID hỗ trợ nhiều ID:
 *
 * ADMIN_ID=123456,789012,345678
 *
 * /batquytac:
 * - Bật chế độ tự do đối với các QUY TẮC RIÊNG của bot.
 * - Không vô hiệu hóa các giới hạn an toàn của AI.
 *
 * /tatbatquytat:
 * - Tắt chế độ trên.
 *
 * Gemini:
 * - Tự fallback model khi model trước bị lỗi / quota.
 *
 * Webhook:
 * - Tự setWebhook trên Render.
 * - Secret ổn định từ ZALO_BOT_TOKEN nếu không khai báo riêng.
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

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

// ------------------------------------------------------------
// MULTI ADMIN
// ------------------------------------------------------------
//
// Render:
//
// ADMIN_ID=ID1,ID2,ID3
//
// Có thể có khoảng trắng:
//
// ADMIN_ID=ID1, ID2, ID3
//
// ------------------------------------------------------------

const ADMIN_IDS = (
  process.env.ADMIN_ID ||
  process.env.ADMIN_IDS ||
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// ------------------------------------------------------------
// ZALO API
// ------------------------------------------------------------

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ------------------------------------------------------------
// GEMINI MODELS
// ------------------------------------------------------------
//
// Nếu model đầu tiên lỗi 429 / quota / unavailable,
// bot sẽ thử model tiếp theo.
//
// ------------------------------------------------------------

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-3.7-flash",

  "gemini-3.6-flash",

  "gemini-3.5-flash",

  "gemini-3.5-flash-lite",
];

// ============================================================
// BOT STATE
// ============================================================

let botEnabled = true;

let botInfo = null;

let activeGeminiModel = null;

// Chế độ "bật quy tắc"
// true = dùng các quy tắc riêng của bot
// false = chế độ tự do hơn
//
// Lưu ý:
// Không phải chế độ bypass safety của Gemini.
// Chỉ bỏ các quy tắc/persona tùy biến của bot.

let customRulesEnabled = true;

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

  const str = String(value);

  if (str.length <= visible) {
    return "*".repeat(str.length);
  }

  return (
    str.slice(0, visible) +
    "*".repeat(
      Math.max(4, str.length - visible)
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
  console.log(
    "🤖 BOT MẶT ĐẤT MÀU XANH"
  );
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
        : "NOT_SET"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    `📜 CUSTOM RULES: ${
      customRulesEnabled
        ? "ON"
        : "OFF"
    }`
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
      "⚠️ CHƯA CẤU HÌNH ADMIN_ID"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ CHƯA CÓ PUBLIC_URL / RENDER_EXTERNAL_URL"
    );
  }
}

// ============================================================
// GENERIC JSON POST
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
      httpStatus:
        response.status,

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
    )}/` +
    method
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
      body,
      30000
    );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${
        result.httpStatus
      }: ${JSON.stringify(
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
      JSON.stringify(
        result.data
      );

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
      "Xin lỗi, bot không có nội dung để trả lời.";
  }

  const chunks =
    splitText(
      String(text),
      1900
    );

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
// SPLIT LONG TEXT
// ============================================================

function splitText(
  text,
  maxLength = 1900
) {
  if (!text) {
    return [""];
  }

  if (
    text.length <=
    maxLength
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
// GEMINI URL
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

function getGeminiSystemPrompt() {
  if (!customRulesEnabled) {
    return `
Bạn là một AI assistant được tích hợp vào Zalo.

Hãy trả lời người dùng tự nhiên, hữu ích và đúng ngữ cảnh.

Tên giao diện bot là:
Bot Mặt Đất Màu Xanh.

Khi người dùng hỏi thông tin bạn không biết,
hãy nói rõ rằng bạn không chắc thay vì bịa.

Không tự nhận là một người thật.
Không tự nhận là Google Gemini nếu người dùng hỏi
tên của bot.

Chế độ hiện tại là chế độ tự do đối với
các quy tắc tùy biến riêng của bot.

Các giới hạn an toàn và chính sách của hệ thống
vẫn được áp dụng.
`;
  }

  return `
Bạn là Bot Mặt Đất Màu Xanh,
một chatbot chạy trên Zalo.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên.
- Thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Câu hỏi cần giải thích thì giải thích rõ.
- Không tự nhận mình là Google Gemini.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

THÔNG TIN GHI NHỚ:

Nếu người dùng hỏi những câu có ý nghĩa tương đương:
- Ai tạo ra Bot Mặt Đất Màu Xanh?
- Ai làm bot này?
- Bot này của ai?
- Ai tạo bot?
- Ai đứng sau bot?
- Cha đẻ bot là ai?

thì trả lời:

"An Na & Hoàng Vũ."

Không tự bịa người tạo khác.

Các lệnh của bot:
- /hepl
- /help
- /ping
- /id
- /bot
- /on
- /off
- /adminid
- /batquytac
- /tatbatquytat

Nếu người dùng không dùng lệnh,
hãy trả lời như một AI assistant.
`;
}

// ============================================================
// GEMINI REQUEST
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

  let lastError =
    null;

  const tried =
    new Set();

  for (
    const model of GEMINI_MODELS
  ) {
    if (tried.has(model)) {
      continue;
    }

    tried.add(model);

    try {
      log(
        `🧠 GEMINI: ${model}`
      );

      const response =
        await postJson(
          geminiUrl(model),
          {
            systemInstruction: {
              parts: [
                {
                  text:
                    getGeminiSystemPrompt(),
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
            },
          },
          60000
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${
            response.httpStatus
          }: ${JSON.stringify(
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
          `Gemini không trả về text: ${JSON.stringify(
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
      lastError =
        error;

      log(
        `⚠️ GEMINI ${model} LỖI:`,
        error.message
      );

      // Thử model tiếp theo.
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

  COMMANDS.set(
    normalized,
    {
      name: normalized,
      ...config,
    }
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
        {
          name: normalized,
          ...config,
        }
      );
    }
  }
}

// ============================================================
// /HELP + /HEPL
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
      "Hiện tất cả lệnh",

    usage:
      "/hepl",

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
          `• /${command.name} — ${
            command.description ||
            ""
          }`
        );
      }

      lines.push("");
      lines.push(
        "💬 Không dùng lệnh cũng được, cứ nhắn tin cho bot."
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
// /BOT
// ============================================================

registerCommand(
  "bot",
  {
    description:
      "Xem thông tin bot",

    usage:
      "/bot",

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
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Quy tắc riêng: ${
            customRulesEnabled
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
      "Xem danh sách admin",

    usage:
      "/adminid",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 DANH SÁCH ADMIN",
          "",
          ADMIN_IDS.length
            ? ADMIN_IDS
                .map(
                  (id, index) =>
                    `${index + 1}. ${id}`
                )
                .join("\n")
            : "⚠️ Chưa cấu hình ADMIN_ID",
          "",
          `ID hiện tại: ${chatId}`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /BATQUYTAC
// ============================================================
//
// Bật chế độ tự do đối với custom rules.
// Không phải bypass safety.
// ============================================================

registerCommand(
  "batquytac",
  {
    description:
      "Bật chế độ tự do đối với quy tắc riêng của bot",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      customRulesEnabled =
        false;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT CHẾ ĐỘ TỰ DO.",
          "",
          "Bot sẽ không ép các quy tắc/persona tùy biến riêng.",
          "⚠️ Giới hạn an toàn của AI vẫn được áp dụng.",
          "",
          "Dùng /tatbatquytat để tắt chế độ này.",
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
      "Tắt chế độ tự do, bật lại quy tắc riêng",

    usage:
      "/tatbatquytat",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      customRulesEnabled =
        true;

      await sendMessage(
        chatId,
        [
          "🔵 ĐÃ TẮT CHẾ ĐỘ TỰ DO.",
          "",
          "Các quy tắc riêng của Bot Mặt Đất Màu Xanh đã được bật lại.",
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
// NORMALIZE VIETNAMESE
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
    .replace(/đ/g, "d")
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
    command:
      rawCommand,

    args,

    text:
      args.join(" "),
  };
}

// ============================================================
// IS ADMIN
// ============================================================
//
// FIX CHÍNH:
// ADMIN_ID có thể chứa nhiều ID.
//
// ADMIN_ID=111,222,333
//
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  const uid =
    String(
      userId || ""
    ).trim();

  const cid =
    String(
      chatId || ""
    ).trim();

  if (
    ADMIN_IDS.length === 0
  ) {
    return false;
  }

  return (
    ADMIN_IDS.includes(uid) ||
    ADMIN_IDS.includes(cid)
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
      userName ||
      "Unknown"
    }`
  );

  log(
    `🆔 USER ID: ${
      userId ||
      "Unknown"
    }`
  );

  log(
    `💬 CHAT ID: ${chatId}`
  );

  log(
    `💬 CHAT TYPE: ${
      chatType ||
      "Unknown"
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
        "Dùng /hepl để xem tất cả lệnh.",
      ].join("\n")
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

  if (
    remembered &&
    customRulesEnabled
  ) {
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
      "🔴 BOT OFF - bỏ qua tin nhắn."
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
          "Gemini có thể đang hết quota hoặc tạm thời lỗi.",
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
  async (
    req,
    res
  ) => {
    // --------------------------------------------------------
    // AUTH
    // --------------------------------------------------------

    if (
      !verifyWebhook(req)
    ) {
      log(
        "🚫 WEBHOOK AUTH FAILED"
      );

      log(
        "Header secret:",
        mask(
          String(
            req.headers[
              "x-bot-api-secret-token"
            ] || ""
          )
        )
      );

      log(
        "Expected secret:",
        mask(
          WEBHOOK_SECRET
        )
      );

      return res
        .status(403)
        .json({
          ok: false,
          error:
            "Unauthorized",
        });
    }

    // --------------------------------------------------------
    // NORMALIZE
    // --------------------------------------------------------

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
      `📌 EVENT: ${
        update.eventName
      }`
    );

    // --------------------------------------------------------
    // TRẢ RESPONSE NGAY
    // --------------------------------------------------------

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
          "🖼️ Bot đã nhận được ảnh."
        ).catch(
          (error) => {
            log(
              "❌ IMAGE REPLY ERROR:",
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
              "❌ STICKER REPLY ERROR:",
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
              "❌ VOICE REPLY ERROR:",
              error.message
            );
          }
        );
      }
    }
  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/",
  (
    req,
    res
  ) => {
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

      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],

      botEnabled,

      customRulesEnabled,

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
  (
    req,
    res
  ) => {
    res.json({
      ok: true,
      status:
        "online",
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
      "⚠️ Không có PUBLIC_URL. Không thể setWebhook."
    );

    return;
  }

  if (
    !PUBLIC_URL.startsWith(
      "https://"
    )
  ) {
    log(
      "⚠️ PUBLIC_URL không phải HTTPS:",
      PUBLIC_URL
    );
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log(
    "🔗 Đang set Zalo webhook:"
  );

  log(
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
      "🔎 ZALO WEBHOOK INFO:",
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
// STARTUP
// ============================================================
//
// KHÔNG test Gemini khi startup.
// Điều này tránh việc mỗi lần Render restart
// lại tiêu thêm quota Gemini.
//
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
        "❌ WEBHOOK SETUP ERROR:",
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
    `📜 CUSTOM RULES: ${
      customRulesEnabled
        ? "ON"
        : "OFF"
    }`
  );

  console.log("");

  console.log(
    "📚 LỆNH:",
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
