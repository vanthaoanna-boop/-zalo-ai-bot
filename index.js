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
)
  .trim();

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_KEY ||
  ""
)
  .trim();

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

// Bộ nhớ
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

  if (
    value.length <= visible
  ) {
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
    await zaloApi(
      "getMe"
    );

  botInfo =
    data?.result || null;

  log(
    "ZALO getMe:",
    JSON.stringify(data)
  );

  return botInfo;
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
    text.length <= maxLength
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
    const chunk
    of chunks
  ) {
    const data =
      await zaloApi(
        "sendMessage",
        {
          chat_id:
            String(chatId),

          text:
            chunk
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
- Trả lời tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Có thể nói chuyện vui vẻ với người dùng.
- Không tự nhận mình là Google Gemini.
- Nếu người dùng hỏi ai tạo bot thì trả lời:
"An Na & Hoàng Vũ."

Không được tự bịa người tạo khác.

Nếu người dùng đang nói chuyện trực tiếp với bot
sau khi @Bot thì hãy trả lời đúng nội dung họ hỏi.

Không nói những câu như:
"Bạn chưa nhập câu hỏi."
nếu người dùng đã gửi nội dung sau @Bot.

Nếu tin nhắn là:
"/tin nhắn bất kỳ"
thì hãy hiểu phần sau dấu / là nội dung người dùng muốn hỏi,
không coi nó là lỗi command.
`;

const RULE_BREAK_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.

Tên bot:
Bot Mặt Đất Màu Xanh.

Người tạo:
An Na & Hoàng Vũ.

Trả lời bằng tiếng Việt.

Hãy trả lời tự nhiên theo ngữ cảnh người dùng.

Nếu người dùng @Bot rồi viết nội dung,
hãy trả lời nội dung đó.

Nếu nội dung bắt đầu bằng dấu / nhưng được gửi
sau @Bot thì vẫn xem nó là câu hỏi/nội dung
của người dùng, không xem là command.

Không tự nhận là Google Gemini.
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

  let lastError = null;

  const systemPrompt =
    ruleBreakEnabled
      ? RULE_BREAK_PROMPT
      : NORMAL_PROMPT;

  for (
    const model
    of GEMINI_MODELS
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

      lastError = error;

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
// NORMALIZE TEXT
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
    const rule
    of defaultMemories
  ) {
    for (
      const pattern
      of rule.patterns
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
// COMMANDS
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
    const alias
    of config.aliases || []
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
      "Xem tất cả lệnh",

    adminOnly:
      false,

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
          "→ Xem tất cả lệnh.",
          "",
          "/ping",
          "→ Kiểm tra bot.",
          "",
          "/id",
          "→ Xem ID.",
          "",
          "/bot",
          "→ Xem thông tin bot.",
          "",
          "/ad",
          "→ Kiểm tra Admin.",
          "",
          "💬 CHAT NHÓM:",
          "",
          "@Bot nội dung bất kỳ",
          "→ Bot sẽ trả lời.",
          "",
          "Ví dụ:",
          "@Bot mày đang làm gì?",
          "",
          "@Bot /ai tạo ra bạn",
          "→ Bot vẫn trả lời.",
          "",
          "Không cần @Bot trong chat riêng."
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
    description:
      "Kiểm tra bot",

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
    description:
      "Xem ID",

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
            `Chat ID: ${
              chatId
            }`,
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
// BOT
// ============================================================

registerCommand(
  "bot",
  {
    description:
      "Thông tin bot",

    handler:
      async ({
        chatId
      }) => {

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
            `Chat nhóm: ${
              groupChatEnabled
                ? "🟢 ON"
                : "🔴 OFF"
            }`,
            `Chế độ đặc biệt: ${
              ruleBreakEnabled
                ? "🔥 ON"
                : "🟢 OFF"
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
    description:
      "Kiểm tra Admin",

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
            `ID của bạn: ${
              userId ||
              "N/A"
            }`,

            `Bạn là Admin: ${
              admin
                ? "✅ CÓ"
                : "❌ KHÔNG"
            }`,

            "",

            `Số Admin: ${
              ADMIN_IDS.size
            }`,

            "",

            "Danh sách Admin:",

            ...(
              ADMIN_IDS.size
                ? [
                    ...ADMIN_IDS
                  ].map(
                    id =>
                      `• ${id}`
                  )
                ]
                : [
                    "• Chưa cấu hình"
                  ]
            )
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
    description:
      "Bật bot",

    adminOnly:
      true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        if (
          botEnabled
        ) {
          await sendMessage(
            chatId,
            "🟢 Bot đang bật rồi."
          );

          return;
        }

        botEnabled =
          true;

        offByAdmin =
          null;

        await sendMessage(
          chatId,

          [
            "🟢 Đã bật bot lại.",
            "",
            `Admin bật: ${
              userId
            }`
          ].join("\n")
        );

        log(
          "BOT ON BY:",
          userId
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
    description:
      "Tắt bot",

    adminOnly:
      true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        if (
          !botEnabled
        ) {
          await sendMessage(
            chatId,

            [
              "⛔ Bot đã tắt.",
              "",
              `Admin dùng /off trước: ${
                offByAdmin ||
                "Không xác định"
              }`,
              "",
              "Dùng /on để bật lại."
            ].join("\n")
          );

          return;
        }

        botEnabled =
          false;

        offByAdmin =
          String(userId);

        await sendMessage(
          chatId,

          [
            "🔴 Đã tắt bot.",
            "",
            `Admin tắt: ${
              userId
            }`,
            "",
            "Bot sẽ tắt cho tất cả.",
            "Admin dùng /on để bật lại."
          ].join("\n")
        );

        log(
          "BOT OFF BY:",
          userId
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
    description:
      "Tắt chat nhóm",

    adminOnly:
      true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        groupChatEnabled =
          false;

        await sendMessage(
          chatId,

          [
            "🔴 Đã tắt chat nhóm.",
            "",
            `Admin: ${
              userId
            }`,
            "",
            "Bot sẽ không trả lời @Bot trong nhóm.",
            "Các lệnh / vẫn hoạt động.",
            "",
            "Dùng /batnhom để bật lại."
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
    description:
      "Bật chat nhóm",

    adminOnly:
      true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        groupChatEnabled =
          true;

        await sendMessage(
          chatId,

          [
            "🟢 Đã bật chat nhóm.",
            "",
            `Admin: ${
              userId
            }`,
            "",
            "Trong nhóm:",
            "@Bot + nội dung bất kỳ",
            "→ Bot sẽ trả lời."
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
    description:
      "Bật chế độ đặc biệt",

    adminOnly:
      true,

    handler:
      async ({
        chatId
      }) => {

        ruleBreakEnabled =
          true;

        await sendMessage(
          chatId,

          [
            "🔥 Đã bật chế độ đặc biệt.",
            "",
            "Bot sẽ trả lời tự nhiên hơn theo ngữ cảnh."
          ].join("\n")
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
    description:
      "Tắt chế độ đặc biệt",

    adminOnly:
      true,

    handler:
      async ({
        chatId
      }) => {

        ruleBreakEnabled =
          false;

        await sendMessage(
          chatId,

          [
            "🟢 Đã tắt chế độ đặc biệt.",
            "",
            "Bot trở về chế độ bình thường."
          ].join("\n")
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
    description:
      "Ghi nhớ",

    adminOnly:
      true,

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
              "/ghinho câu hỏi - câu trả lời",
              "",
              "Ví dụ:",
              "/ghinho Hoàng Vũ là ai - Anh ấy k7"
            ].join("\n")
          );

          return;
        }

        const raw =
          text.trim();

        if (
          raw.includes(
            " - "
          )
        ) {

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

              "❌ Sai cú pháp."
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
              `🧠 Câu hỏi: ${
                question
              }`,
              `🤖 Trả lời: ${
                answer
              }`
            ].join("\n")
          );

          return;
        }

        memories.set(
          normalizeText(
            raw
          ),
          {
            question:
              raw,

            reply:
              null
          }
        );

        await sendMessage(
          chatId,

          [
            "🧠 Đã ghi nhớ:",
            "",
            raw
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
  if (
    !String(text)
      .trim()
      .startsWith("/")
  ) {
    return null;
  }

  const parts =
    String(text)
      .trim()
      .split(/\s+/);

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
        `❓ Không có lệnh /${
          parsed.command
        }`,

        "",

        "Dùng /help để xem lệnh."
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

    isAdmin:
      admin
  });

  return true;
}

// ============================================================
// KIỂM TRA GROUP
// ============================================================

function isGroupChat(
  chatType
) {
  const type =
    String(
      chatType || ""
    ).toUpperCase();

  return (
    type === "GROUP" ||
    type === "GROUP_CHAT"
  );
}

// ============================================================
// LẤY TÊN BOT
// ============================================================

function getBotName() {
  return (
    botInfo?.display_name ||
    botInfo?.account_name ||
    botInfo?.name ||
    "Bot Mặt Đất Màu Xanh"
  );
}

// ============================================================
// KIỂM TRA MESSAGE CÓ MENTION BOT KHÔNG
// ============================================================

function messageMentionsBot(
  message,
  text
) {
  const botId =
    botInfo?.id ||
    botInfo?.user_id ||
    botInfo?.uid ||
    botInfo?.bot_id ||
    "";

  const botName =
    getBotName();

  // ----------------------------------------------------------
  // 1. mentions
  // ----------------------------------------------------------

  const mentions =
    Array.isArray(
      message?.mentions
    )
      ? message.mentions
      : [];

  for (
    const mention
    of mentions
  ) {
    const mentionedId =
      mention?.user_id ||
      mention?.uid ||
      mention?.id ||
      mention?.bot_id ||
      mention?.target_id ||
      "";

    const mentionedName =
      mention?.name ||
      mention?.display_name ||
      mention?.username ||
      "";

    if (
      botId &&
      String(
        mentionedId
      ) ===
        String(botId)
    ) {
      return true;
    }

    if (
      mentionedName &&
      botName &&
      normalizeText(
        mentionedName
      ) ===
        normalizeText(
          botName
        )
    ) {
      return true;
    }
  }

  // ----------------------------------------------------------
  // 2. entities
  // ----------------------------------------------------------

  const entities =
    Array.isArray(
      message?.entities
    )
      ? message.entities
      : [];

  for (
    const entity
    of entities
  ) {
    const type =
      String(
        entity?.type ||
        entity?.kind ||
        ""
      ).toLowerCase();

    if (
      type.includes(
        "mention"
      )
    ) {
      const id =
        entity?.user_id ||
        entity?.uid ||
        entity?.id ||
        entity?.target_id ||
        "";

      if (
        botId &&
        String(id) ===
          String(botId)
      ) {
        return true;
      }

      const name =
        entity?.name ||
        entity?.display_name ||
        entity?.username ||
        "";

      if (
        name &&
        normalizeText(
          name
        ) ===
          normalizeText(
            botName
          )
      ) {
        return true;
      }
    }
  }

  // ----------------------------------------------------------
  // 3. Nếu webhook chỉ trả text
  //    thì kiểm tra @TênBot
  // ----------------------------------------------------------

  const normalizedText =
    normalizeText(
      text
    );

  const normalizedBotName =
    normalizeText(
      botName
    );

  if (
    normalizedBotName &&
    normalizedText.includes(
      normalizedBotName
    )
  ) {
    return true;
  }

  // Một số trường hợp tên bot được gửi có @
  const withoutAt =
    normalizedText.replace(
      /^@/,
      ""
    );

  if (
    withoutAt.startsWith(
      normalizedBotName
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================
// LẤY NỘI DUNG SAU @BOT
// ============================================================

function getMentionContent(
  message,
  text
) {
  let result =
    String(text || "")
      .trim();

  const botName =
    getBotName();

  // ----------------------------------------------------------
  // Nếu có mentions với offset/length
  // ----------------------------------------------------------

  const mentions =
    Array.isArray(
      message?.mentions
    )
      ? message.mentions
      : [];

  const botId =
    botInfo?.id ||
    botInfo?.user_id ||
    botInfo?.uid ||
    botInfo?.bot_id ||
    "";

  for (
    const mention
    of mentions
  ) {
    const mentionedId =
      mention?.user_id ||
      mention?.uid ||
      mention?.id ||
      mention?.bot_id ||
      mention?.target_id ||
      "";

    const mentionedName =
      mention?.name ||
      mention?.display_name ||
      mention?.username ||
      botName;

    const isBot =
      (
        botId &&
        String(
          mentionedId
        ) ===
          String(botId)
      ) ||
      (
        mentionedName &&
        normalizeText(
          mentionedName
        ) ===
          normalizeText(
            botName
          )
      );

    if (!isBot) {
      continue;
    }

    const offset =
      Number.isFinite(
        mention?.offset
      )
        ? mention.offset
        : null;

    const length =
      Number.isFinite(
        mention?.length
      )
        ? mention.length
        : null;

    if (
      offset !== null &&
      length !== null
    ) {
      result =
        (
          result.slice(
            0,
            offset
          ) +
          result.slice(
            offset +
              length
          )
        ).trim();

      break;
    }
  }

  // ----------------------------------------------------------
  // Xóa @TênBot ở đầu
  // ----------------------------------------------------------

  const escapedName =
    botName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `^@?${escapedName}\\s*`,
      "iu"
    );

  result =
    result
      .replace(
        regex,
        ""
      )
      .trim();

  // ----------------------------------------------------------
  // Nếu còn dạng @Bot
  // ----------------------------------------------------------

  result =
    result
      .replace(
        /^@\S+\s*/,
        ""
      )
      .trim();

  return result;
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
      data.event ||
      "",

    message,

    chatId:
      message?.chat?.id
        ? String(
            message.chat.id
          )
        : "",

    chatType:
      message?.chat?.chat_type ||
      message?.chat?.type ||
      "",

    userId:
      message?.from?.id
        ? String(
            message.from.id
          )
        : "",

    userName:
      message?.from?.display_name ||
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
    chatType,
    message
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  const isGroup =
    isGroupChat(
      chatType
    );

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
    chatType
  );

  log(
    "IS GROUP:",
    isGroup
  );

  log(
    "TEXT:",
    text
  );

  // ==========================================================
  // COMMAND ĐẶC BIỆT
  //
  // /help, /ping, /id...
  // luôn xử lý trước
  // ==========================================================

  const parsed =
    parseCommand(text);

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

  if (
    !botEnabled
  ) {

    log(
      "BOT OFF -> IGNORE"
    );

    return;
  }

  // ==========================================================
  // GROUP
  //
  // CHỈ TRẢ LỜI KHI @BOT
  // ==========================================================

  if (isGroup) {

    const mentioned =
      messageMentionsBot(
        message,
        text
      );

    log(
      "BOT MENTIONED:",
      mentioned
    );

    if (!mentioned) {

      log(
        "GROUP -> KHÔNG @BOT -> IGNORE"
      );

      return;
    }

    // Lấy phần nội dung sau @Bot
    const question =
      getMentionContent(
        message,
        text
      );

    log(
      "CONTENT AFTER @BOT:",
      question
    );

    if (!question) {

      await sendMessage(
        chatId,

        [
          "👋 Gọi mình có chuyện gì đó?",
          "",
          "Ví dụ:",
          "@Bot mày là ai?",
          "@Bot hôm nay thế nào?",
          "@Bot /ai tạo ra bạn?"
        ].join("\n")
      );

      return;
    }

    // --------------------------------------------------------
    // MEMORY SAU @BOT
    // --------------------------------------------------------

    const remembered =
      getRememberedAnswer(
        question
      );

    if (remembered) {

      log(
        "MEMORY HIT"
      );

      await sendMessage(
        chatId,
        remembered
      );

      return;
    }

    // --------------------------------------------------------
    // GEMINI
    // --------------------------------------------------------

    await sendTyping(
      chatId
    );

    try {

      const answer =
        await askGemini(
          question,
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
            "😵 Bot đang lỗi AI.",
            "",
            "Thử lại sau nhé."
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

    return;
  }

  // ==========================================================
  // CHAT RIÊNG
  //
  // Không cần @BOT
  // ==========================================================

  const remembered =
    getRememberedAnswer(
      text
    );

  if (remembered) {

    log(
      "MEMORY HIT"
    );

    await sendMessage(
      chatId,
      remembered
    );

    return;
  }

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

      botName:
        getBotName(),

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
    JSON.stringify(
      data
    )
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
    "=========================================="
  );

  console.log(
    "GROUP MODE:"
  );

  console.log(
    "@BOT + NỘI DUNG -> REP"
  );

  console.log(
    "TIN NHẮN THƯỜNG -> IGNORE"
  );

  console.log(
    "CHAT RIÊNG -> REP"
  );

  console.log(
    "=========================================="
  );

  if (
    ZALO_BOT_TOKEN
  ) {

    try {

      await getMe();

    } catch (
      error
    ) {

      log(
        "ZALO getMe ERROR:",
        error.message
      );
    }
  }

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
