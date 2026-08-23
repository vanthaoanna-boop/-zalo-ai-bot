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
    "bot mat dat mau xanh"
  ];

  if (
    botName &&
    normalized.startsWith(
      "@" + botName
    )
  ) {
    return true;
  }

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

  // ==========================================================
  // MEMORY MẶC ĐỊNH
  // ==========================================================

  for (
    const rule of
      defaultMemories
  ) {
    for (
      const pattern of
        rule.patterns
    ) {
      const normalizedPattern =
        normalizeText(
          pattern
        );

      if (
        normalized ===
          normalizedPattern ||
        normalized.includes(
          normalizedPattern
        )
      ) {
        return rule.answer;
      }
    }
  }

  // ==========================================================
  // MEMORY DO ADMIN GHI
  // ==========================================================

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
      ) ||
      question.includes(
        normalized
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
          "/help",
          "→ Xem lệnh.",
          "",
          "/ping",
          "→ Kiểm tra bot.",
          "",
          "/id",
          "→ Xem ID.",
          "",
          "/bot",
          "→ Thông tin bot.",
          "",
          "/ad",
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
            "/on",
            "→ Bật bot.",
            "",
            "/off",
            "→ Tắt bot.",
            "",
            "/batnhom",
            "→ Bật chat nhóm.",
            "",
            "/tatnhom",
            "→ Tắt chat nhóm.",
            "",
            "/batquytac",
            "→ Bật chế độ đặc biệt.",
            "",
            "/tatbatquytac",
            "→ Tắt chế độ đặc biệt.",
            "",
            "/ghinho câu hỏi - câu trả lời",
            "→ Ghi nhớ.",
            "",
            "/ghinho câu hỏi",
            "nội dung dòng 1",
            "nội dung dòng 2",
            "→ Ghi nhớ nhiều dòng."
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
            }`,
            `Memory: ${
              memories.size
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

        // ------------------------------------------------------
        // Không có nội dung
        // ------------------------------------------------------

        if (
          !text ||
          !text.trim()
        ) {

          await sendMessage(
            chatId,
            [
              "🧠 CÁCH DÙNG:",
              "",
              "1️⃣ Có dấu -:",
              "/ghinho câu hỏi - câu trả lời",
              "",
              "2️⃣ Không cần dấu -:",
              "/ghinho câu hỏi",
              "nội dung dòng 1",
              "nội dung dòng 2",
              "nội dung dòng 3",
              "",
              "Ví dụ:",
              "/ghinho thông tin về Hoàng Vũ",
              "Tiktok hoangvu_102_ ( acc chính )",
              "vuhoang_102 ( acc phụ )",
              "YT @hoangvu_102"
            ].join("\n")
          );

          return;
        }

        // ------------------------------------------------------
        // QUAN TRỌNG:
        //
        // text ở đây PHẢI giữ nguyên \n
        // nhờ parseCommand() bên dưới.
        // ------------------------------------------------------

        const raw =
          String(text)
            .replace(
              /\r\n/g,
              "\n"
            )
            .replace(
              /\r/g,
              "\n"
            )
            .trim();

        let question = "";
        let answer = "";

        // ------------------------------------------------------
        // KIỂU 1:
        //
        // /ghinho Hoàng Vũ là ai - Là người tạo bot
        // ------------------------------------------------------

        const dashMatch =
          raw.match(
            /^([\s\S]*?)\s+-\s+([\s\S]+)$/
          );

        if (dashMatch) {

          question =
            dashMatch[1]
              .trim();

          answer =
            dashMatch[2]
              .trim();

        } else {

          // ----------------------------------------------------
          // KIỂU 2:
          //
          // /ghinho thông tin về Hoàng Vũ
          // dòng 1
          // dòng 2
          // dòng 3
          //
          // Dòng đầu = câu hỏi
          // Phần còn lại = câu trả lời
          // ----------------------------------------------------

          const lines =
            raw
              .split("\n")
              .map(
                line =>
                  line.trim()
              );

          // Xóa dòng trống ở đầu/cuối
          while (
            lines.length &&
            !lines[0]
          ) {
            lines.shift();
          }

          while (
            lines.length &&
            !lines[
              lines.length - 1
            ]
          ) {
            lines.pop();
          }

          if (
            lines.length < 2
          ) {

            await sendMessage(
              chatId,
              [
                "❌ Không xác định được nội dung.",
                "",
                "Dùng:",
                "/ghinho câu hỏi - câu trả lời",
                "",
                "Hoặc:",
                "/ghinho câu hỏi",
                "nội dung dòng 1",
                "nội dung dòng 2"
              ].join("\n")
            );

            return;
          }

          question =
            lines[0]
              .trim();

          answer =
            lines
              .slice(1)
              .join("\n")
              .trim();
        }

        // ------------------------------------------------------
        // KIỂM TRA
        // ------------------------------------------------------

        if (
          !question ||
          !answer
        ) {

          await sendMessage(
            chatId,
            [
              "❌ Câu hỏi hoặc nội dung đang bị trống.",
              "",
              "Hãy nhập lại /ghinho."
            ].join("\n")
          );

          return;
        }

        // ------------------------------------------------------
        // GIỚI HẠN MEMORY
        // ------------------------------------------------------

        if (
          question.length >
          500
        ) {

          await sendMessage(
            chatId,
            "❌ Câu hỏi quá dài. Tối đa 500 ký tự."
          );

          return;
        }

        if (
          answer.length >
          10000
        ) {

          await sendMessage(
            chatId,
            "❌ Nội dung ghi nhớ quá dài. Tối đa 10000 ký tự."
          );

          return;
        }

        // ------------------------------------------------------
        // NORMALIZE QUESTION
        // ------------------------------------------------------

        const normalizedQuestion =
          normalizeText(
            question
          );

        if (
          !normalizedQuestion
        ) {

          await sendMessage(
            chatId,
            "❌ Câu hỏi không hợp lệ."
          );

          return;
        }

        // ------------------------------------------------------
        // LƯU
        // ------------------------------------------------------

        memories.set(
          normalizedQuestion,
          {
            question,
            reply:
              answer
          }
        );

        // ------------------------------------------------------
        // LOG
        // ------------------------------------------------------

        log(
          "=========================================="
        );

        log(
          "🧠 MEMORY SAVED"
        );

        log(
          "QUESTION:",
          question
        );

        log(
          "ANSWER:",
          answer
        );

        log(
          "MEMORY COUNT:",
          memories.size
        );

        log(
          "=========================================="
        );

        // ------------------------------------------------------
        // TRẢ KẾT QUẢ
        // ------------------------------------------------------

        await sendMessage(
          chatId,
          [
            "✅ ĐÃ GHI NHỚ!",
            "",
            `🧠 ${question}`,
            "",
            "🤖 Nội dung:",
            answer
          ].join("\n")
        );
      }
  }
);

// ============================================================
// PARSE COMMAND
//
// QUAN TRỌNG NHẤT:
//
// KHÔNG dùng:
// split(/\s+/)
//
// Vì cách đó sẽ làm mất xuống dòng.
//
// Hàm này giữ nguyên toàn bộ nội dung phía sau command.
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

  // Ví dụ:
  //
  // /ghinho thông tin về Hoàng Vũ
  // Tiktok abc
  // YT xyz
  //
  // command = ghinho
  //
  // text giữ nguyên:
  //
  // thông tin về Hoàng Vũ
  // Tiktok abc
  // YT xyz

  const match =
    value.match(
      /^\/([^\s]+)(?:\s+([\s\S]*))?$/
    );

  if (!match) {
    return null;
  }

  const command =
    String(
      match[1] || ""
    )
      .split("@")[0]
      .toLowerCase();

  const textContent =
    match[2] !== undefined
      ? match[2]
      : "";

  return {
    command,

    args:
      textContent
        .trim()
        .split(/\s+/)
        .filter(Boolean),

    // GIỮ NGUYÊN XUỐNG DÒNG
    text:
      textContent.trim()
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

    messageText =
      text;
  }

  // ==========================================================
  // CHỈ @BOT
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
      "🧠 MEMORY HIT"
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
        chat
