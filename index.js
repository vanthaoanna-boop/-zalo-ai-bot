/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * Node.js >= 18
 *
 * ENV:
 *   PORT
 *   PUBLIC_URL
 *   ZALO_BOT_TOKEN
 *   ZALO_WEBHOOK_SECRET (optional)
 *   GEMINI_API_KEY
 *   GEMINI_MODEL (optional)
 *   ADMIN_IDS
 *
 * ADMIN_IDS ví dụ:
 *   123456789,987654321,555555555
 *
 * TÍNH NĂNG:
 *   /help
 *   /hepl
 *   /ping
 *   /id
 *   /bot
 *   /ad
 *   /adminid
 *   /on
 *   /off
 *   /batquytac
 *   /tatbatquytac
 *   /ghinho
 *
 * CHAT RIÊNG:
 *   Nhắn bình thường -> Gemini
 *
 * NHÓM:
 *   Chỉ xử lý tin bắt đầu bằng "/"
 *   Tin bình thường -> bỏ qua
 *
 * GHI NHỚ:
 *   /ghinho Anh Hoàng Vũ
 *
 *   hoặc:
 *
 *   /ghinho Anh Hoàng Vũ - Anh ấy K7
 *
 *   hoặc:
 *
 *   /ghinho rên đi em - ~~
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

const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

/*
 * Nhiều admin:
 *
 * ADMIN_IDS=111,222,333
 *
 * Có thể vẫn dùng ADMIN_ID cũ.
 */
const ADMIN_IDS_RAW = String(
  process.env.ADMIN_IDS ||
  process.env.ADMIN_ID ||
  ""
).trim();

const ADMIN_IDS = new Set(
  ADMIN_IDS_RAW
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

// ============================================================
// ZALO
// ============================================================

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ============================================================
// GEMINI MODELS
// ============================================================
//
// Không dùng gemini-2.5-flash vì model đó đã gây
// lỗi 404 trong log của bạn.
//
// Có thể đặt GEMINI_MODEL trên Render.
// ============================================================

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-3.7-flash",

  "gemini-3.6-flash",

  "gemini-3.5-flash",
].filter(
  (model, index, array) =>
    model &&
    array.indexOf(model) === index
);

// ============================================================
// STATE
// ============================================================

let botInfo = null;

let activeGeminiModel = null;

/*
 * Bot bật/tắt toàn cục.
 */
let botEnabled = true;

/*
 * Admin nào đã dùng /off.
 */
let botDisabledBy = null;

/*
 * Chế độ "thoải mái".
 *
 * Lưu ý:
 * Không thể biến command này thành cơ chế
 * vượt qua các giới hạn an toàn của model.
 */
let relaxedMode = false;

/*
 * Bộ nhớ do admin tạo bằng /ghinho.
 *
 * Map:
 *
 * trigger -> {
 *   trigger,
 *   answer,
 *   createdBy,
 *   createdAt
 * }
 */
const MEMORY = new Map();

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
// CONFIG CHECK
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

  console.log(
    `🌐 PORT: ${PORT}`
  );

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
      ADMIN_IDS.size
        ? [...ADMIN_IDS].join(", ")
        : "CHƯA CẤU HÌNH"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    `🧠 GEMINI MODELS: ${GEMINI_MODELS.join(
      ", "
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

  if (!ADMIN_IDS.size) {
    console.warn(
      "⚠️ CHƯA CÓ ADMIN IDS"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ CHƯA CÓ PUBLIC_URL"
    );
  }
}

// ============================================================
// GENERIC POST
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

    const error =
      new Error(
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
    "🔎 ĐANG KIỂM TRA ZALO BOT API..."
  );

  const data =
    await zaloApi(
      "getMe"
    );

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
        JSON.stringify(
          botInfo
        )
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

  const content =
    String(
      text ||
        "Xin lỗi, bot không có nội dung để trả lời."
    );

  const chunks =
    splitText(
      content,
      1900
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

          text: chunk,
        }
      );

    if (
      !data?.ok
    ) {
      throw new Error(
        `sendMessage thất bại: ${JSON.stringify(
          data
        )}`
      );
    }
  }

  return true;
}

// ============================================================
// SPLIT
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
      "⚠️ TYPING ERROR:",
      error.message
    );
  }
}

// ============================================================
// NORMALIZE VIETNAMESE
// ============================================================

function normalizeText(
  text
) {
  return String(
    text || ""
  )
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
// GEMINI URL
// ============================================================

function geminiUrl(
  model
) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(
      model
    ) +
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
  const modeText =
    relaxedMode
      ? `
Chế độ hiện tại là "thoải mái".
Hãy nói chuyện tự nhiên, linh hoạt và bớt máy móc.
Tuy nhiên vẫn phải tuân thủ các giới hạn an toàn bắt buộc của hệ thống.
`
      : `
Chế độ bình thường.
`;

  return `
Bạn là Bot Mặt Đất Màu Xanh, chatbot chạy trên Zalo.

${modeText}

QUY TẮC:

- Trả lời bằng tiếng Việt nếu người dùng nói tiếng Việt.
- Tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

THÔNG TIN GHI NHỚ:

Nếu hệ thống cung cấp thông tin ghi nhớ phù hợp với câu hỏi,
hãy ưu tiên sử dụng thông tin đó.

Nếu không có thông tin ghi nhớ phù hợp,
hãy trả lời bằng kiến thức bình thường.

Không được tự bịa thông tin về người dùng.

Các lệnh của bot:
- /help
- /hepl
- /ping
- /id
- /bot
- /ad
- /adminid
- /on
- /off
- /batquytac
- /tatbatquytac
- /ghinho
`;
}

// ============================================================
// MEMORY ANSWER
// ============================================================

function findMemory(
  text
) {
  const normalized =
    normalizeText(
      text
    );

  if (!normalized) {
    return null;
  }

  /*
   * Ưu tiên trigger dài nhất.
   *
   * Ví dụ:
   * "anh hoàng vũ"
   * sẽ ưu tiên hơn
   * "hoàng vũ"
   */
  const memories =
    [...MEMORY.values()]
      .sort(
        (a, b) =>
          b.trigger.length -
          a.trigger.length
      );

  for (
    const memory of memories
  ) {
    const trigger =
      normalizeText(
        memory.trigger
      );

    if (
      !trigger
    ) {
      continue;
    }

    if (
      normalized ===
        trigger ||
      normalized.includes(
        trigger
      )
    ) {
      return memory;
    }
  }

  return null;
}

// ============================================================
// GEMINI ASK
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

  const memory =
    findMemory(
      userText
    );

  let memoryText =
    "Không có thông tin ghi nhớ phù hợp.";

  if (memory) {
    memoryText = `
Trigger ghi nhớ:
${memory.trigger}

Câu trả lời ghi nhớ:
${memory.answer}
`;
  }

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

THÔNG TIN GHI NHỚ LIÊN QUAN:
${memoryText}

TIN NHẮN:
${userText}
`;

  let lastError =
    null;

  for (
    const model of GEMINI_MODELS
  ) {
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
                role:
                  "user",

                parts: [
                  {
                    text:
                      prompt,
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

      if (
        !response.ok
      ) {
        const error =
          new Error(
            `HTTP ${
              response.httpStatus
            }: ${JSON.stringify(
              response.data
            )}`
          );

        error.httpStatus =
          response.httpStatus;

        error.responseData =
          response.data;

        throw error;
      }

      const data =
        response.data;

      if (
        data?.error
      ) {
        const error =
          new Error(
            data.error.message ||
              JSON.stringify(
                data.error
              )
          );

        error.httpStatus =
          response.httpStatus;

        error.geminiError =
          data.error;

        throw error;
      }

      const text =
        data
          ?.candidates?.[0]
          ?.content
          ?.parts
          ?.map(
            (part) =>
              part.text ||
              ""
          )
          .join("")
          .trim();

      if (!text) {
        throw new Error(
          "Gemini không trả về text."
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

      /*
       * 404:
       * model không tồn tại / không còn hỗ trợ.
       *
       * 429:
       * quota/rate limit.
       *
       * Cả hai đều thử model tiếp theo.
       */
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

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  const chatType =
    String(
      chat.chat_type ||
        data.chat_type ||
        ""
    ).toUpperCase();

  /*
   * Một số payload có thể dùng:
   * GROUP
   * group
   * GROUP_CHAT
   *
   * nên kiểm tra rộng hơn.
   */
  const isGroup =
    chatType ===
      "GROUP" ||
    chatType ===
      "GROUP_CHAT" ||
    chatType.includes(
      "GROUP"
    );

  return {
    eventName:
      data.event_name ||
      data.event ||
      "",

    message,

    chatId:
      chat?.id
        ? String(chat.id)
        : "",

    chatType,

    isGroup,

    userId:
      from?.id
        ? String(from.id)
        : "",

    userName:
      from?.display_name ||
      from?.name ||
      "",

    text:
      typeof message.text ===
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
  const normalizedName =
    String(name)
      .toLowerCase();

  const command = {
    name:
      normalizedName,
    ...config,
  };

  COMMANDS.set(
    normalizedName,
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
        String(alias)
          .toLowerCase(),
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

    usage:
      "/help",

    adminOnly:
      false,

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
          `• /${command.name} — ${
            command.description ||
            ""
          }`
        );
      }

      lines.push("");
      lines.push(
        "👥 Trong nhóm: bot chỉ trả lời tin bắt đầu bằng /."
      );

      lines.push(
        "💬 Chat riêng: có thể nhắn bình thường."
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

    adminOnly:
      false,

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

    adminOnly:
      false,

    async handler({
      chatId,
      userId,
      chatType,
      isGroup,
    }) {
      await sendMessage(
        chatId,
        [
          "🆔 THÔNG TIN ID",
          "",
          `Chat ID: ${
            chatId ||
            "Không có"
          }`,
          `User ID: ${
            userId ||
            "Không có"
          }`,
          `Chat type: ${
            chatType ||
            "Không rõ"
          }`,
          `Group: ${
            isGroup
              ? "true"
              : "false"
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

    adminOnly:
      false,

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
          `Bot: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ: ${
            relaxedMode
              ? "😎 THOẢI MÁI"
              : "🛡️ BÌNH THƯỜNG"
          }`,
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
      "Kiểm tra quyền admin",

    usage:
      "/ad",

    adminOnly:
      false,

    async handler({
      chatId,
      userId,
      isAdmin,
    }) {
      if (isAdmin) {
        await sendMessage(
          chatId,
          [
            "👑 ADMIN CHECK",
            "",
            "✅ Bạn là ADMIN.",
            `🆔 User ID: ${
              userId ||
              "Không có"
            }`,
          ].join("\n")
        );
      } else {
        await sendMessage(
          chatId,
          [
            "👤 ADMIN CHECK",
            "",
            "❌ Bạn không phải admin.",
            `🆔 User ID: ${
              userId ||
              "Không có"
            }`,
          ].join("\n")
        );
      }
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

    adminOnly:
      true,

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 DANH SÁCH ADMIN",
          "",
          ADMIN_IDS.size
            ? [...ADMIN_IDS]
                .map(
                  (id, index) =>
                    `${index + 1}. ${id}`
                )
                .join("\n")
            : "Chưa có admin.",
        ].join("\n")
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
      "Tắt bot toàn cục",

    usage:
      "/off",

    adminOnly:
      true,

    async handler({
      chatId,
      userId,
    }) {
      if (!botEnabled) {
        await sendMessage(
          chatId,
          [
            "🔴 BOT ĐÃ ĐƯỢC TẮT.",
            "",
            `Admin tắt bot: ${
              botDisabledBy ||
              "Không rõ"
            }`,
            "",
            "Dùng /on để bật lại.",
          ].join("\n")
        );

        return;
      }

      botEnabled =
        false;

      botDisabledBy =
        String(
          userId
        );

      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT BOT TOÀN CỤC.",
          "",
          `Admin thực hiện: ${userId}`,
          "",
          "Admin khác dùng /off sẽ không thể tắt lần nữa.",
          "Dùng /on để bật lại.",
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
      "Bật bot lại",

    usage:
      "/on",

    adminOnly:
      true,

    async handler({
      chatId,
      userId,
    }) {
      if (botEnabled) {
        await sendMessage(
          chatId,
          "🟢 BOT ĐANG BẬT SẴN."
        );

        return;
      }

      botEnabled =
        true;

      const previous =
        botDisabledBy;

      botDisabledBy =
        null;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT BOT LẠI.",
          "",
          `Admin bật lại: ${userId}`,
          `Admin đã tắt trước đó: ${
            previous ||
            "Không rõ"
          }`,
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
      "Bật chế độ trò chuyện thoải mái",

    usage:
      "/batquytac",

    adminOnly:
      true,

    async handler({
      chatId,
      userId,
    }) {
      relaxedMode =
        true;

      await sendMessage(
        chatId,
        [
          "😎 ĐÃ BẬT CHẾ ĐỘ THOẢI MÁI.",
          "",
          "Bot sẽ trả lời tự nhiên và linh hoạt hơn.",
          "Các giới hạn an toàn bắt buộc của hệ thống vẫn được áp dụng.",
          "",
          `Admin: ${userId}`,
          "",
          "Dùng /tatbatquytac để tắt.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /TATBATQUYTAC
// ============================================================

registerCommand(
  "tatbatquytac",
  {
    description:
      "Tắt chế độ trò chuyện thoải mái",

    usage:
      "/tatbatquytac",

    adminOnly:
      true,

    async handler({
      chatId,
      userId,
    }) {
      relaxedMode =
        false;

      await sendMessage(
        chatId,
        [
          "🛡️ ĐÃ TẮT CHẾ ĐỘ THOẢI MÁI.",
          "",
          "Bot quay lại chế độ bình thường.",
          "",
          `Admin: ${userId}`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /GHINHO
// ============================================================
//
// CÚ PHÁP:
//
// /ghinho Anh Hoàng Vũ
//
// -> chỉ nhớ trigger.
//
//
//
// /ghinho Anh Hoàng Vũ - Anh ấy K7
//
// -> trigger: Anh Hoàng Vũ
// -> answer : Anh ấy K7
//
//
// /ghinho rên đi em - ~~
//
// -> trigger: rên đi em
// -> answer : ~~
//
// Chỉ ADMIN dùng được.
// ============================================================

registerCommand(
  "ghinho",
  {
    description:
      "Admin thêm thông tin ghi nhớ",

    usage:
      "/ghinho <nội dung> [- câu trả lời]",

    adminOnly:
      true,

    async handler({
      chatId,
      userId,
      text,
    }) {
      const value =
        String(
          text || ""
        ).trim();

      if (!value) {
        await sendMessage(
          chatId,
          [
            "🧠 CÁCH DÙNG:",
            "",
            "/ghinho Anh Hoàng Vũ",
            "",
            "Hoặc:",
            "/ghinho Anh Hoàng Vũ - Anh ấy K7",
            "",
            "Hoặc:",
            "/ghinho rên đi em - ~~",
            "",
            "Có dấu '-' thì phần trước là nội dung nhớ, phần sau là câu bot trả lời.",
            "Không có '-' thì bot chỉ ghi nhớ phần đó.",
          ].join("\n")
        );

        return;
      }

      /*
       * Chỉ tách dấu '-' đầu tiên.
       *
       * Ví dụ:
       *
       * "abc - xyz - 123"
       *
       * trigger = abc
       * answer  = xyz - 123
       */
      const separator =
        value.indexOf(
          " - "
        );

      let trigger =
        value;

      let answer =
        "";

      if (
        separator !==
        -1
      ) {
        trigger =
          value
            .slice(
              0,
              separator
            )
            .trim();

        answer =
          value
            .slice(
              separator +
                3
            )
            .trim();
      }

      if (!trigger) {
        await sendMessage(
          chatId,
          "❌ Nội dung ghi nhớ không được trống."
        );

        return;
      }

      const normalizedTrigger =
        normalizeText(
          trigger
        );

      MEMORY.set(
        normalizedTrigger,
        {
          trigger,
          answer:
            answer ||
            "",
          createdBy:
            String(
              userId
            ),
          createdAt:
            new Date().toISOString(),
        }
      );

      await sendMessage(
        chatId,
        [
          "🧠 ĐÃ GHI NHỚ.",
          "",
          `📌 Nội dung: ${trigger}`,
          answer
            ? `💬 Câu trả lời: ${answer}`
            : "💬 Câu trả lời: dùng nội dung ghi nhớ để hỗ trợ AI.",
          "",
          `👑 Admin: ${userId}`,
          `📚 Tổng ghi nhớ: ${MEMORY.size}`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// MEMORY BUILT-IN
// ============================================================

MEMORY.set(
  normalizeText(
    "ai tạo ra bot mặt đất màu xanh"
  ),
  {
    trigger:
      "ai tạo ra bot mặt đất màu xanh",

    answer:
      "An Na & Hoàng Vũ.",

    createdBy:
      "SYSTEM",

    createdAt:
      new Date().toISOString(),
  }
);

MEMORY.set(
  normalizeText(
    "ai làm bot này"
  ),
  {
    trigger:
      "ai làm bot này",

    answer:
      "An Na & Hoàng Vũ.",

    createdBy:
      "SYSTEM",

    createdAt:
      new Date().toISOString(),
  }
);

MEMORY.set(
  normalizeText(
    "bot này của ai"
  ),
  {
    trigger:
      "bot này của ai",

    answer:
      "An Na & Hoàng Vũ.",

    createdBy:
      "SYSTEM",

    createdAt:
      new Date().toISOString(),
  }
);

// ============================================================
// PARSE COMMAND
// ============================================================

function parseCommand(
  text
) {
  const value =
    String(
      text || ""
    ).trim();

  if (
    !value.startsWith(
      "/"
    )
  ) {
    return null;
  }

  const parts =
    value.split(
      /\s+/
    );

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

function isAdmin(
  userId,
  chatId
) {
  const user =
    String(
      userId || ""
    );

  const chat =
    String(
      chatId || ""
    );

  return (
    ADMIN_IDS.has(
      user
    ) ||
    ADMIN_IDS.has(
      chat
    )
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
      [
        "⛔ LỆNH NÀY CHỈ DÀNH CHO ADMIN.",
        "",
        `User ID: ${
          update.userId ||
          "Không có"
        }`,
        "",
        "Dùng /ad để kiểm tra quyền.",
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
    isGroup,
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
    `💬 CHAT ID: ${
      chatId
    }`
  );

  log(
    `👥 GROUP: ${
      isGroup
    }`
  );

  log(
    `📌 CHAT TYPE: ${
      chatType ||
      "Unknown"
    }`
  );

  log(
    `💬 TEXT: ${
      text
    }`
  );

  // ==========================================================
  // GROUP MODE
  // ==========================================================
  //
  // Trong nhóm:
  //
  // "Hello"
  //
  // -> BỎ QUA
  //
  // "/ping"
  //
  // -> XỬ LÝ
  //
  // "/hỏi Gemini..."
  //
  // -> Nếu không phải command thì đưa vào Gemini.
  //
  // ==========================================================

  if (
    isGroup &&
    !text.startsWith("/")
  ) {
    log(
      "👥 GROUP MESSAGE KHÔNG CÓ / -> BỎ QUA"
    );

    return;
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(
      text
    );

  if (
    parsed
  ) {
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
        } catch (
          sendError
        ) {
          log(
            "❌ SEND COMMAND ERROR:",
            sendError.message
          );
        }
      }

      return;
    }

    /*
     * Trong nhóm:
     *
     * /hello
     *
     * không phải command.
     *
     * Cho phép đưa phần sau "/" cho Gemini.
     */
    if (
      isGroup &&
      parsed.text
    ) {
      log(
        `🧠 GROUP AI COMMAND: ${parsed.text}`
      );

      await askAndReply(
        update,
        parsed.text
      );

      return;
    }

    /*
     * Chat riêng dùng /abc không tồn tại:
     */
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

  // ==========================================================
  // MEMORY DIRECT ANSWER
  // ==========================================================

  const remembered =
    findMemory(
      text
    );

  if (
    remembered &&
    remembered.answer
  ) {
    log(
      "🧠 MEMORY HIT:",
      remembered.trigger
    );

    try {
      await sendMessage(
        chatId,
        remembered.answer
      );
    } catch (
      error
    ) {
      log(
        "❌ SEND MEMORY ERROR:",
        error.message
      );
    }

    return;
  }

  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (
    !botEnabled
  ) {
    log(
      `🔴 BOT OFF - bỏ qua tin nhắn. Disabled by: ${
        botDisabledBy ||
        "Unknown"
      }`
    );

    return;
  }

  // ==========================================================
  // GEMINI
  // ==========================================================

  await askAndReply(
    update,
    text
  );
}

// ============================================================
// ASK AND REPLY
// ============================================================

async function askAndReply(
  update,
  text
) {
  const {
    chatId,
    userName,
  } = update;

  if (
    !text ||
    !String(
      text
    ).trim()
  ) {
    return;
  }

  if (
    !botEnabled
  ) {
    return;
  }

  await sendTyping(
    chatId
  );

  try {
    log(
      "🧠 ĐANG HỎI GEMINI..."
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
  } catch (
    error
  ) {
    log(
      "❌ GEMINI ERROR:",
      error.message
    );

    /*
     * Nếu tất cả model đều hết quota,
     * trả lời rõ ràng thay vì chỉ nói
     * "kiểm tra API key".
     */
    const message =
      String(
        error.message ||
          ""
      );

    let reply =
      "😵 Bot đang gặp lỗi AI.\n\n";

    if (
      message.includes(
        "429"
      ) ||
      message
        .toLowerCase()
        .includes(
          "quota"
        ) ||
      message
        .toLowerCase()
        .includes(
          "resource_exhausted"
        )
    ) {
      reply +=
        "⚠️ Gemini đang hết quota/rate limit. Hãy chờ quota reset hoặc dùng API key/project khác.";
    } else if (
      message.includes(
        "404"
      ) ||
      message
        .toLowerCase()
        .includes(
          "not_found"
        )
    ) {
      reply +=
        "⚠️ Model Gemini hiện tại không khả dụng. Kiểm tra GEMINI_MODEL trên Render.";
    } else {
      reply +=
        "Vui lòng thử lại sau vài giây.";
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

function verifyWebhook(
  req
) {
  const received =
    req.headers[
      "x-bot-api-secret-token"
    ];

  if (
    !received
  ) {
    return false;
  }

  const receivedString =
    String(
      received
    );

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
      !verifyWebhook(
        req
      )
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
      "📩 ZALO WEBHOOK:"
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

    log(
      `👥 GROUP: ${
        update.isGroup
      }`
    );

    log(
      `📌 CHAT TYPE: ${
        update.chatType
      }`
    );

    // --------------------------------------------------------
    // TRẢ 200 NGAY
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
      /*
       * Trong group không tự động trả lời
       * vì group chỉ phản hồi command "/".
       */
      if (
        update.isGroup
      ) {
        return;
      }

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
        update.isGroup
      ) {
        return;
      }

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
        update.isGroup
      ) {
        return;
      }

      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại. Chức năng voice sẽ bổ sung sau."
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

      relaxedMode,

      adminCount:
        ADMIN_IDS.size,

      memoryCount:
        MEMORY.size,

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
  if (
    !ZALO_BOT_TOKEN
  ) {
    return;
  }

  if (
    !PUBLIC_URL
  ) {
    log(
      "⚠️ Không có PUBLIC_URL -> không set webhook."
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
    "🔗 ĐANG SET ZALO WEBHOOK:"
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
    JSON.stringify(
      data
    )
  );

  if (
    data?.ok
  ) {
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
      JSON.stringify(
        data
      )
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
// GEMINI TEST
// ============================================================

async function testGemini() {
  if (
    !GEMINI_API_KEY
  ) {
    return false;
  }

  log(
    "🧠 ĐANG TEST GEMINI..."
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
      ADMIN_IDS.size
        ? `${ADMIN_IDS.size} ADMIN`
        : "CHƯA CẤU HÌNH"
    }`
  );

  console.log(
    `🤖 BOT STATE: ${
      botEnabled
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `😎 RELAXED MODE: ${
      relaxedMode
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `🧠 MEMORY: ${MEMORY.size}`
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
    "👥 GROUP MODE: CHỈ TRẢ LỜI TIN BẮT ĐẦU BẰNG /"
  );

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
      `🚀 Server listening on ${PORT}`
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
