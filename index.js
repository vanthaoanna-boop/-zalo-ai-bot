const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(
  express.json({
    limit: "2mb"
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

const ADMIN_IDS = new Set(
  (
    process.env.ADMIN_IDS ||
    process.env.ADMIN_ID ||
    ""
  )
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
);

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-3.6-flash",

  "gemini-3.5-flash",

  "gemini-3.5-flash-lite"
];

// ============================================================
// STATE
// ============================================================

let botEnabled = true;

let groupChatEnabled = true;

let ruleBreakEnabled = false;

let botInfo = null;

let activeGeminiModel = null;

let offByAdmin = null;

// Memory
const memories = new Map();

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

function mask(
  value,
  visible = 4
) {
  if (!value) {
    return "NOT_SET";
  }

  if (value.length <= visible) {
    return "*".repeat(
      value.length
    );
  }

  return (
    value.slice(0, visible) +
    "*".repeat(
      Math.max(
        4,
        value.length - visible
      )
    )
  );
}

// ============================================================
// POST JSON
// ============================================================

async function postJson(
  url,
  body,
  timeoutMs = 30000
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () =>
      controller.abort(),
    timeoutMs
  );

  try {
    const response =
      await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          body === undefined
            ? undefined
            : JSON.stringify(body),

        signal: controller.signal
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
        raw: text
      };
    }

    return {
      httpStatus:
        response.status,

      ok:
        response.ok,

      data
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
    )}` +
    `/${method}`
  );
}

async function zaloApi(
  method,
  body
) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "Thiếu ZALO_BOT_TOKEN."
    );
  }

  const result =
    await postJson(
      zaloUrl(method),
      body
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
    result.data?.ok === false
  ) {
    throw new Error(
      result.data.description ||
        result.data.message ||
        JSON.stringify(
          result.data
        )
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

  botInfo =
    data?.result || null;

  log(
    "ZALO getMe:",
    JSON.stringify(data)
  );

  return botInfo;
}

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
// BOT MENTION
//
// QUAN TRỌNG:
// Nhận các dạng:
//
// @Bot Mat Dat Mau Xanh /ping
// @Bot Mặt Đất Màu Xanh /ping
// @bot /ping
//
// Sau khi nhận mention sẽ bỏ phần @bot ra,
// phần còn lại mới đưa vào command/Gemini.
// ============================================================

function isBotMention(text) {
  const value =
    String(text || "").trim();

  if (!value.startsWith("@")) {
    return false;
  }

  const normalized =
    normalizeText(value);

  const botName =
    normalizeText(
      botInfo?.display_name ||
        botInfo?.account_name ||
        ""
    );

  const aliases = [
    "bot mat dat mau xanh",
    "bot mat dat mau xanh",
    "bot mat dat mau xanh"
  ];

  // Tên bot lấy từ getMe()
  if (
    botName &&
    normalized.startsWith(
      "@" + botName
    )
  ) {
    return true;
  }

  // Tên cố định để chống trường hợp getMe
  // không trả display_name
  for (
    const alias of aliases
  ) {
    if (
      normalized.startsWith(
        "@" + alias
      )
    ) {
      return true;
    }
  }

  // Cho phép @bot /ping
  if (
    /^@\s*bot\b/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================
// REMOVE BOT MENTION
// ============================================================

function removeBotMention(text) {
  let value =
    String(text || "").trim();

  if (!value) {
    return "";
  }

  const normalized =
    normalizeText(value);

  const botName =
    normalizeText(
      botInfo?.display_name ||
        botInfo?.account_name ||
        ""
    );

  // @Bot Mặt Đất Màu Xanh
  if (
    botName &&
    normalized.startsWith(
      "@" + botName
    )
  ) {
    const originalLower =
      value.toLowerCase();

    const botNameLower =
      botName.toLowerCase();

    const index =
      originalLower.indexOf(
        botNameLower,
        1
      );

    if (index !== -1) {
      return value
        .slice(
          index +
            botName.length
        )
        .trim();
    }
  }

  // @Bot Mat Dat Mau Xanh
  const fixedRegex =
    /^@\s*bot\s+mat\s+dat\s+mau\s+xanh\b/i;

  if (
    fixedRegex.test(value)
  ) {
    return value
      .replace(
        fixedRegex,
        ""
      )
      .trim();
  }

  // @Bot
  if (
    /^@\s*bot\b/i.test(value)
  ) {
    return value
      .replace(
        /^@\s*bot\b/i,
        ""
      )
      .trim();
  }

  return value;
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

  text = String(text);

  if (
    text.length <=
    maxLength
  ) {
    return [text];
  }

  const result = [];

  let remaining = text;

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
      maxLength * 0.5
    ) {
      cut =
        remaining.lastIndexOf(
          " ",
          maxLength
        );
    }

    if (
      cut <
      maxLength * 0.5
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

  const chunks =
    splitText(
      text ||
        "Không có nội dung."
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

          text: chunk
        }
      );

    if (
      data?.ok === false
    ) {
      throw new Error(
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

        action:
          "typing"
      }
    );

  } catch (error) {
    log(
      "Typing lỗi:",
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

const NORMAL_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.

Thông tin cố định:
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo: An Na & Hoàng Vũ.
- Nói tiếng Việt.
- Tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Không tự nhận là Google Gemini.
- Không nói mình là AI khác.
- Khi người dùng hỏi ai tạo bot, trả lời:
"An Na & Hoàng Vũ."

Không được tự bịa người tạo khác.

Nếu người dùng nói chuyện bình thường,
hãy trả lời tự nhiên như một người bạn.
`;

const RULE_BREAK_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.

Tên bot: Bot Mặt Đất Màu Xanh.
Người tạo: An Na & Hoàng Vũ.

Trả lời tiếng Việt.
Tự nhiên.
Thân thiện.
Không tự nhận mình là Google Gemini.
`;

async function askGemini(
  userText,
  userName = ""
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Thiếu GEMINI_API_KEY."
    );
  }

  let lastError =
    null;

  const systemPrompt =
    ruleBreakEnabled
      ? RULE_BREAK_PROMPT
      : NORMAL_PROMPT;

  for (
    const model of GEMINI_MODELS
  ) {
    try {
      log(
        "Gemini model:",
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
                    systemPrompt
                }
              ]
            },

            contents: [
              {
                role:
                  "user",

                parts: [
                  {
                    text:
                      `Tên người dùng: ${
                        userName ||
                        "Người dùng"
                      }\n\n` +
                      `Tin nhắn:\n${userText}`
                  }
                ]
              }
            ],

            generationConfig: {
              maxOutputTokens:
                2048
            }
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
            part =>
              part.text || ""
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

      return text;

    } catch (error) {
      lastError =
        error;

      log(
        `Gemini ${model} lỗi:`,
        error.message
      );
    }
  }

  throw new Error(
    lastError?.message ||
      "Gemini lỗi."
  );
}

// ============================================================
// MEMORY
// ============================================================

const defaultMemories = [
  {
    patterns: [
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
      "tac gia bot"
    ],

    answer:
      "An Na & Hoàng Vũ."
  }
];

function getRememberedAnswer(
  text
) {
  const normalized =
    normalizeText(text);

  for (
    const rule of
      defaultMemories
  ) {
    for (
      const pattern of
        rule.patterns
    ) {
      if (
        normalized ===
          normalizeText(
            pattern
          ) ||
        normalized.includes(
          normalizeText(
            pattern
          )
        )
      ) {
        return rule.answer;
      }
    }
  }

  for (
    const [
      question,
      data
    ] of memories.entries()
  ) {
    if (
      normalized ===
        question ||
      normalized.includes(
        question
      )
    ) {
      if (
        typeof data ===
        "string"
      ) {
        return data;
      }

      if (
        data &&
        data.reply
      ) {
        return data.reply;
      }
    }
  }

  return null;
}

// ============================================================
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  return (
    ADMIN_IDS.has(
      String(
        userId || ""
      )
    ) ||
    ADMIN_IDS.has(
      String(
        chatId || ""
      )
    )
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
  COMMANDS.set(
    name.toLowerCase(),
    {
      name:
        name.toLowerCase(),

      ...config
    }
  );

  for (
    const alias of
      config.aliases || []
  ) {
    COMMANDS.set(
      alias.toLowerCase(),
      {
        name:
          name.toLowerCase(),

        ...config
      }
    );
  }
}

// ============================================================
// HELP
// ============================================================

registerCommand(
  "help",
  {
    aliases: [
      "hepl",
      "h",
      "menu"
    ],

    description:
      "Xem lệnh",

    adminOnly: false,

    handler:
      async ({
        chatId,
        isAdmin: admin
      }) => {
        const lines = [
          "🤖 BOT MẶT ĐẤT MÀU XANH",
          "",
          "📚 LỆNH:",
          "",
          "@Bot /help",
          "→ Xem lệnh.",
          "",
          "@Bot /ping",
          "→ Kiểm tra bot.",
          "",
          "@Bot /id",
          "→ Xem ID.",
          "",
          "@Bot /bot",
          "→ Thông tin bot.",
          "",
          "@Bot /ad",
          "→ Kiểm tra Admin.",
          "",
          "💬 CHAT NHÓM:",
          "",
          "@Bot xin chào",
          "→ Bot trả lời bằng AI.",
          "",
          "@Bot mày là ai?",
          "→ Bot trả lời.",
          "",
          "Không @Bot trong nhóm",
          "→ Bot không trả lời.",
          "",
          "💬 CHAT RIÊNG:",
          "→ Nhắn bình thường bot sẽ trả lời."
        ];

        if (admin) {
          lines.push(
            "",
            "🔐 ADMIN:",
            "",
            "@Bot /on",
            "→ Bật bot.",
            "",
            "@Bot /off",
            "→ Tắt bot.",
            "",
            "@Bot /batnhom",
            "→ Bật chat nhóm.",
            "",
            "@Bot /tatnhom",
            "→ Tắt chat nhóm.",
            "",
            "@Bot /batquytac",
            "→ Bật chế độ đặc biệt.",
            "",
            "@Bot /tatbatquytac",
            "→ Tắt chế độ đặc biệt.",
            "",
            "@Bot /ghinho câu hỏi - câu trả lời",
            "→ Ghi nhớ."
          );
        }

        await sendMessage(
          chatId,
          lines.join("\n")
        );
      }
  }
);

// ============================================================
// PING
// ============================================================

registerCommand(
  "ping",
  {
    handler:
      async ({
        chatId
      }) => {
        await sendMessage(
          chatId,
          [
            "🏓 Pong!",
            "🟢 Bot đang hoạt động."
          ].join("\n")
        );
      }
  }
);

// ============================================================
// ID
// ============================================================

registerCommand(
  "id",
  {
    handler:
      async ({
        chatId,
        userId,
        chatType
      }) => {
        await sendMessage(
          chatId,
          [
            "🆔 THÔNG TIN ID",
            "",
            `Chat ID: ${chatId}`,
            `User ID: ${
              userId ||
              "Không có"
            }`,
            `Chat type: ${
              chatType ||
              "Không rõ"
            }`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// BOT INFO
// ============================================================

registerCommand(
  "bot",
  {
    handler:
      async ({
        chatId
      }) => {
        const name =
          botInfo
            ?.display_name ||
          botInfo
            ?.account_name ||
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
            `Chat nhóm: ${
              groupChatEnabled
                ? "🟢 ON"
                : "🔴 OFF"
            }`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// ADMIN CHECK
// ============================================================

registerCommand(
  "ad",
  {
    handler:
      async ({
        chatId,
        userId,
        isAdmin: admin
      }) => {
        await sendMessage(
          chatId,
          [
            "👑 ADMIN CHECK",
            "",
            `ID: ${
              userId ||
              "N/A"
            }`,
            `Admin: ${
              admin
                ? "✅ CÓ"
                : "❌ KHÔNG"
            }`,
            "",
            `Số Admin: ${
              ADMIN_IDS.size
            }`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// ON
// ============================================================

registerCommand(
  "on",
  {
    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {
        botEnabled =
          true;

        offByAdmin =
          null;

        await sendMessage(
          chatId,
          [
            "🟢 Đã bật bot.",
            "",
            `Admin: ${userId}`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// OFF
// ============================================================

registerCommand(
  "off",
  {
    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {
        botEnabled =
          false;

        offByAdmin =
          String(userId);

        await sendMessage(
          chatId,
          [
            "🔴 Đã tắt bot.",
            "",
            `Admin: ${userId}`,
            "",
            "Chỉ Admin dùng /on mới bật lại."
          ].join("\n")
        );
      }
  }
);

// ============================================================
// TẮT CHAT NHÓM
// ============================================================

registerCommand(
  "tatnhom",
  {
    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {
        if (
          !groupChatEnabled
        ) {
          await sendMessage(
            chatId,
            "🔴 Chat nhóm đang tắt rồi."
          );

          return;
        }

        groupChatEnabled =
          false;

        await sendMessage(
          chatId,
          [
            "🔴 Đã tắt chat nhóm.",
            "",
            `Admin: ${userId}`,
            "",
            "Bot sẽ không trả lời @Bot trong nhóm.",
            "",
            "Dùng @Bot /batnhom để bật lại."
          ].join("\n")
        );

        log(
          "GROUP CHAT OFF BY:",
          userId
        );
      }
  }
);

// ============================================================
// BẬT CHAT NHÓM
// ============================================================

registerCommand(
  "batnhom",
  {
    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {
        if (
          groupChatEnabled
        ) {
          await sendMessage(
            chatId,
            "🟢 Chat nhóm đang bật rồi."
          );

          return;
        }

        groupChatEnabled =
          true;

        await sendMessage(
          chatId,
          [
            "🟢 Đã bật chat nhóm.",
            "",
            `Admin: ${userId}`,
            "",
            "Bây giờ @Bot rồi nhắn gì cũng được."
          ].join("\n")
        );

        log(
          "GROUP CHAT ON BY:",
          userId
        );
      }
  }
);

// ============================================================
// BAT QUY TAC
// ============================================================

registerCommand(
  "batquytac",
  {
    adminOnly: true,

    handler:
      async ({
        chatId
      }) => {
        ruleBreakEnabled =
          true;

        await sendMessage(
          chatId,
          "🔥 Đã bật chế độ đặc biệt."
        );
      }
  }
);

// ============================================================
// TAT QUY TAC
// ============================================================

registerCommand(
  "tatbatquytac",
  {
    adminOnly: true,

    handler:
      async ({
        chatId
      }) => {
        ruleBreakEnabled =
          false;

        await sendMessage(
          chatId,
          "🟢 Đã tắt chế độ đặc biệt."
        );
      }
  }
);

// ============================================================
// GHINHO
// ============================================================

registerCommand(
  "ghinho",
  {
    adminOnly: true,

    handler:
      async ({
        chatId,
        text
      }) => {
        if (!text) {
          await sendMessage(
            chatId,
            [
              "🧠 CÁCH DÙNG",
              "",
              "@Bot /ghinho câu hỏi - câu trả lời",
              "",
              "Ví dụ:",
              "@Bot /ghinho Hoàng Vũ là ai - Anh ấy là k7"
            ].join("\n")
          );

          return;
        }

        const raw =
          text.trim();

        if (
          !raw.includes(
            " - "
          )
        ) {
          await sendMessage(
            chatId,
            "❌ Dùng: /ghinho câu hỏi - câu trả lời"
          );

          return;
        }

        const index =
          raw.indexOf(
            " - "
          );

        const question =
          raw
            .slice(
              0,
              index
            )
            .trim();

        const answer =
          raw
            .slice(
              index + 3
            )
            .trim();

        if (
          !question ||
          !answer
        ) {
          await sendMessage(
            chatId,
            "❌ Câu hỏi hoặc câu trả lời bị trống."
          );

          return;
        }

        memories.set(
          normalizeText(
            question
          ),
          {
            question,
            reply:
              answer
          }
        );

        await sendMessage(
          chatId,
          [
            "✅ Đã ghi nhớ.",
            "",
            `🧠 ${question}`,
            `🤖 ${answer}`
          ].join("\n")
        );
      }
  }
);

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
    value.split(
      /\s+/
    );

  const command =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  return {
    command,

    args:
      parts.slice(1),

    text:
      parts
        .slice(1)
        .join(" ")
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
    await sendMessage(
      update.chatId,
      [
        `❓ Không có lệnh /${parsed.command}`,
        "",
        "Dùng @Bot /help"
      ].join("\n")
    );

    return true;
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
      "⛔ Lệnh này chỉ dành cho Admin."
    );

    return true;
  }

  await command.handler({
    ...update,
    ...parsed,
    isAdmin: admin
  });

  return true;
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
      data.event_name ||
      "",

    message,

    chatId:
      message?.chat?.id
        ? String(
            message.chat.id
          )
        : "",

    chatType:
      message?.chat
        ?.chat_type ||
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
      message?.from
        ?.name ||
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
        : ""
  };
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
    chatType
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  const normalizedChatType =
    String(
      chatType || ""
    ).toUpperCase();

  const isGroup =
    normalizedChatType ===
      "GROUP" ||
    normalizedChatType ===
      "GROUP_CHAT";

  log(
    "=========================================="
  );

  log(
    "USER:",
    userName ||
      "Unknown"
  );

  log(
    "USER ID:",
    userId ||
      "Unknown"
  );

  log(
    "CHAT ID:",
    chatId
  );

  log(
    "CHAT TYPE:",
    normalizedChatType
  );

  log(
    "IS GROUP:",
    isGroup
  );

  log(
    "GROUP CHAT ENABLED:",
    groupChatEnabled
  );

  log(
    "RAW TEXT:",
    text
  );

  // ==========================================================
  // GROUP
  //
  // CHỈ TRẢ LỜI KHI CÓ @BOT
  // ==========================================================

  let messageText =
    text;

  if (isGroup) {

    if (
      !groupChatEnabled
    ) {
      log(
        "GROUP CHAT OFF -> IGNORE"
      );

      return;
    }

    if (
      !isBotMention(text)
    ) {
      log(
        "GROUP WITHOUT @BOT -> IGNORE"
      );

      return;
    }

    // Bỏ @Bot ra
    messageText =
      removeBotMention(
        text
      );

    log(
      "BOT MENTION DETECTED"
    );

    log(
      "AFTER REMOVE MENTION:",
      messageText
    );

  } else {

    // Chat riêng:
    // Không cần @Bot
    messageText =
      text;
  }

  // ==========================================================
  // Nếu chỉ @Bot mà không có nội dung
  // ==========================================================

  if (!messageText) {
    await sendMessage(
      chatId,
      [
        "👋 Có mình đây!",
        "",
        "Nhắn @Bot rồi hỏi gì đó nhé."
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(
      messageText
    );

  if (parsed) {

    try {

      await handleCommand(
        update,
        parsed
      );

    } catch (error) {

      log(
        "COMMAND ERROR:",
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

  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (!botEnabled) {

    log(
      "BOT OFF -> IGNORE"
    );

    return;
  }

  // ==========================================================
  // MEMORY
  // ==========================================================

  const remembered =
    getRememberedAnswer(
      messageText
    );

  if (remembered) {

    log(
      "MEMORY HIT"
    );

    try {

      await sendMessage(
        chatId,
        remembered
      );

    } catch (error) {

      log(
        "MEMORY SEND ERROR:",
        error.message
      );
    }

    return;
  }

  // ==========================================================
  // GEMINI
  // ==========================================================

  await sendTyping(
    chatId
  );

  try {

    const answer =
      await askGemini(
        messageText,
        userName
      );

    log(
      "GEMINI:",
      answer
    );

    await sendMessage(
      chatId,
      answer
    );

  } catch (error) {

    log(
      "GEMINI ERROR:",
      error.message
    );

    try {

      await sendMessage(
        chatId,
        [
          "😵 Bot đang gặp lỗi AI.",
          "",
          "Vui lòng thử lại sau."
        ].join("\n")
      );

    } catch (
      sendError
    ) {

      log(
        "SEND ERROR:",
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

    if (
      !verifyWebhook(req)
    ) {

      log(
        "WEBHOOK AUTH FAILED"
      );

      return res
        .status(403)
        .json({
          ok: false,
          error:
            "Unauthorized"
        });
    }

    const update =
      normalizeWebhook(
        req.body
      );

    log(
      "ZALO WEBHOOK:",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    // ACK ngay
    res.json({
      ok: true
    });

    if (!update) {
      return;
    }

    log(
      "EVENT:",
      update.eventName
    );

    // ========================================================
    // TEXT
    // ========================================================

    if (
      update.eventName ===
      "message.text.received"
    ) {

      handleMessage(
        update
      ).catch(
        error => {
          log(
            "HANDLE MESSAGE ERROR:",
            error.message
          );
        }
      );

      return;
    }

    // ========================================================
    // IMAGE
    // ========================================================

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
          error => {
            log(
              "IMAGE ERROR:",
              error.message
            );
          }
        );
      }

      return;
    }

    // ========================================================
    // STICKER
    // ========================================================

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
          error => {
            log(
              "STICKER ERROR:",
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

      status:
        "online",

      botEnabled,

      groupChatEnabled,

      ruleBreakEnabled,

      gemini:
        Boolean(
          GEMINI_API_KEY
        ),

      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],

      adminCount:
        ADMIN_IDS.size,

      webhook:
        PUBLIC_URL
          ? `${PUBLIC_URL}/webhook`
          : null
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
        "online"
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
      "Không có PUBLIC_URL."
    );

    return;
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log(
    "SET WEBHOOK:",
    webhookUrl
  );

  const data =
    await zaloApi(
      "setWebhook",
      {
        url:
          webhookUrl,

        secret_token:
          WEBHOOK_SECRET
      }
    );

  log(
    "SET WEBHOOK RESULT:",
    JSON.stringify(data)
  );
}

// ============================================================
// STARTUP
// ============================================================

async function startup() {

  console.log("");

  console.log(
    "=========================================="
  );

  console.log(
    "🤖 BOT MẶT ĐẤT MÀU XANH"
  );

  console.log(
    "=========================================="
  );

  console.log(
    "PORT:",
    PORT
  );

  console.log(
    "PUBLIC URL:",
    PUBLIC_URL ||
      "NOT_SET"
  );

  console.log(
    "ZALO TOKEN:",
    mask(
      ZALO_BOT_TOKEN
    )
  );

  console.log(
    "GEMINI KEY:",
    mask(
      GEMINI_API_KEY
    )
  );

  console.log(
    "GEMINI MODEL:",
    GEMINI_MODELS.join(
      ", "
    )
  );

  console.log(
    "ADMIN IDS:",
    ADMIN_IDS.size
  );

  console.log(
    "WEBHOOK SECRET:",
    mask(
      WEBHOOK_SECRET
    )
  );

  console.log(
    "GROUP MODE: @BOT ONLY"
  );

  console.log(
    "GROUP CHAT:",
    groupChatEnabled
      ? "ON"
      : "OFF"
  );

  console.log(
    "=========================================="
  );

  // ==========================================================
  // GET BOT
  // ==========================================================

  if (
    ZALO_BOT_TOKEN
  ) {

    try {

      await getMe();

      log(
        "BOT NAME:",
        botInfo
          ?.display_name ||
          botInfo
            ?.account_name ||
          "Unknown"
      );

    } catch (
      error
    ) {

      log(
        "ZALO getMe ERROR:",
        error.message
      );
    }
  }

  // ==========================================================
  // WEBHOOK
  // ==========================================================

  if (
    ZALO_BOT_TOKEN &&
    PUBLIC_URL
  ) {

    try {

      await setWebhook();

    } catch (
      error
    ) {

      log(
        "SET WEBHOOK ERROR:",
        error.message
      );
    }
  }

  console.log("");

  console.log(
    "🚀 BOT ĐÃ ONLINE"
  );

  console.log(
    "🟢 ĐANG CHỜ TIN NHẮN..."
  );

  console.log(
    "=========================================="
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
      `Server listening on ${PORT}`
    );

    startup().catch(
      error => {

        log(
          "STARTUP ERROR:",
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
  reason => {

    console.error(
      "UNHANDLED REJECTION:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  error => {

    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);
