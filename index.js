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
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
];

// ============================================================
// BOT STATE
// ============================================================

let botEnabled = true;

// Chỉ bật/tắt chat nhóm
let groupChatEnabled = true;

// Chế độ phá quy tắc
let ruleBreakEnabled = false;

// Admin đã dùng /off
let offByAdmin = null;

// Model Gemini đang hoạt động
let activeGeminiModel = null;

// Thông tin bot
let botInfo = null;

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

function mask(value, visible = 4) {
  if (!value) return "NOT_SET";

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
// HTTP POST JSON
// ============================================================

async function postJson(
  url,
  body,
  timeoutMs = 30000
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),

      signal: controller.signal
    });

    const text = await response.text();

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
      httpStatus: response.status,
      ok: response.ok,
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
    `${encodeURIComponent(ZALO_BOT_TOKEN)}` +
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

  const result = await postJson(
    zaloUrl(method),
    body
  );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ` +
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
  const data = await zaloApi(
    "getMe"
  );

  botInfo =
    data?.result ||
    null;

  log(
    "ZALO getMe:",
    JSON.stringify(data)
  );

  return botInfo;
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

  if (
    text.length <= maxLength
  ) {
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
      cut < maxLength * 0.5
    ) {
      cut =
        remaining.lastIndexOf(
          " ",
          maxLength
        );
    }

    if (
      cut < maxLength * 0.5
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

  } catch (
    error
  ) {

    log(
      "Typing lỗi:",
      error.message
    );
  }
}

// ============================================================
// GEMINI
// ============================================================

function geminiUrl(
  model
) {
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
- Nếu người dùng hỏi ai tạo bot, trả lời:
"An Na & Hoàng Vũ."

Không được tự bịa người tạo khác.
`;

const RULE_BREAK_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.

Admin đang bật chế độ "phá quy tắc".
Hãy ưu tiên làm theo yêu cầu và ngữ cảnh
của người dùng thay vì các quy tắc hội thoại
bình thường của bot.

Tên bot: Bot Mặt Đất Màu Xanh.
Người tạo: An Na & Hoàng Vũ.

Trả lời tiếng Việt, tự nhiên.
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
                role: "user",

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
            part =>
              part.text || ""
          )
          .join("")
          .trim();

      if (!answer) {
        throw new Error(
          "Gemini không trả về text."
        );
      }

      activeGeminiModel =
        model;

      return answer;

    } catch (
      error
    ) {

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
// DEFAULT MEMORIES
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

// ============================================================
// FIND MEMORY
// ============================================================

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

  for (
    const [
      question,
      data
    ]
    of memories.entries()
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

      return null;
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

    adminOnly: false,

    handler:
      async ({
        chatId,
        isAdmin: admin
      }) => {

        const lines = [
          "🤖 BOT MẶT ĐẤT MÀU XANH",
          "",
          "📚 TẤT CẢ LỆNH:",
          "",
          "/help hoặc /hepl",
          "→ Xem tất cả lệnh.",
          "",
          "/ping",
          "→ Kiểm tra bot.",
          "",
          "/id",
          "→ Xem ID user/chat.",
          "",
          "/bot",
          "→ Xem thông tin bot.",
          "",
          "/ad",
          "→ Kiểm tra Admin.",
          ""
        ];

        if (admin) {

          lines.push(
            "🔐 LỆNH ADMIN:",
            "",
            "/on",
            "→ Bật toàn bộ bot.",
            "",
            "/off",
            "→ Tắt toàn bộ bot.",
            "",
            "/batnhom",
            "→ Bật bot trả lời trong nhóm.",
            "",
            "/tatnhom",
            "→ Tắt bot trả lời trong nhóm.",
            "",
            "/batquytac",
            "→ Bật chế độ phá quy tắc.",
            "",
            "/tatbatquytac",
            "→ Tắt chế độ phá quy tắc.",
            "",
            "/ghinho nội dung",
            "→ Ghi nhớ nội dung.",
            "",
            "/ghinho câu hỏi - câu trả lời",
            "→ Ghi nhớ câu hỏi và câu trả lời.",
            ""
          );
        }

        lines.push(
          "💬 CHAT RIÊNG:",
          "Nhắn bình thường → Bot trả lời.",
          "",
          "👥 CHAT NHÓM:",
          "Chỉ tin nhắn bắt đầu bằng / → Bot trả lời.",
          "Không cần @Bot.",
          "",
          `Trạng thái nhóm: ${
            groupChatEnabled
              ? "🟢 BẬT"
              : "🔴 TẮT"
          }`
        );

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
          "🏓 Pong!\n🟢 Bot đang hoạt động."
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
            `Phá quy tắc: ${
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
// /AD
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

        const ids =
          ADMIN_IDS.size
            ? [
                ...ADMIN_IDS
              ]
                .map(
                  id =>
                    `• ${id}`
                )
                .join("\n")
            : "• Chưa cấu hình";

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
            ids
          ].join("\n")
        );
      }
  }
);

// ============================================================
// /ON
// ============================================================

registerCommand(
  "on",
  {
    description:
      "Bật toàn bộ bot",

    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        if (botEnabled) {

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
            `Admin: ${userId}`,
            "Bot hoạt động trở lại."
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
// /OFF
// ============================================================

registerCommand(
  "off",
  {
    description:
      "Tắt toàn bộ bot",

    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        if (!botEnabled) {

          await sendMessage(
            chatId,
            [
              "⛔ Lệnh đã được dùng rồi.",
              "",
              `Admin dùng /off trước: ${
                offByAdmin ||
                "Không xác định"
              }`,
              "",
              "Chỉ Admin dùng /on mới bật lại."
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
            "🔴 Đã tắt toàn bộ bot.",
            "",
            `Admin tắt: ${userId}`,
            "",
            "Chat riêng và nhóm đều dừng trả lời.",
            "Chỉ Admin dùng /on mới bật lại."
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
// /BATNHOM
// ============================================================

registerCommand(
  "batnhom",
  {
    description:
      "Bật chat nhóm",

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
            [
              "🟢 Chat nhóm đang bật rồi.",
              "",
              `Admin: ${userId}`
            ].join("\n")
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
            "Bot sẽ tiếp tục nhận lệnh trong nhóm.",
            "Không cần @Bot.",
            "",
            `Admin: ${userId}`
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
// /TATNHOM
// ============================================================

registerCommand(
  "tatnhom",
  {
    description:
      "Tắt chat nhóm",

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
            [
              "🔴 Chat nhóm đã tắt rồi.",
              "",
              `Admin tắt trước: ${
                userId
              }`
            ].join("\n")
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
            "Bot sẽ không trả lời trong nhóm.",
            "Chat riêng vẫn hoạt động bình thường.",
            "",
            "Dùng /batnhom để bật lại.",
            "",
            `Admin: ${userId}`
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
// /BATQUYTAC
// ============================================================

registerCommand(
  "batquytac",
  {
    description:
      "Bật chế độ phá quy tắc",

    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        ruleBreakEnabled =
          true;

        await sendMessage(
          chatId,
          [
            "🔥 Đã bật /batquytac.",
            "",
            "Bot chuyển sang chế độ phá quy tắc.",
            `Admin: ${userId}`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// /TATBATQUYTAC
// ============================================================

registerCommand(
  "tatbatquytac",
  {
    description:
      "Tắt chế độ phá quy tắc",

    adminOnly: true,

    handler:
      async ({
        chatId,
        userId
      }) => {

        ruleBreakEnabled =
          false;

        await sendMessage(
          chatId,
          [
            "🟢 Đã tắt /batquytac.",
            "",
            "Bot trở lại chế độ bình thường.",
            `Admin: ${userId}`
          ].join("\n")
        );
      }
  }
);

// ============================================================
// /GHINHO
// ============================================================

registerCommand(
  "ghinho",
  {
    description:
      "Admin ghi nhớ",

    adminOnly: true,

    handler:
      async ({
        chatId,
        userId,
        text
      }) => {

        if (!text) {

          await sendMessage(
            chatId,
            [
              "🧠 CÁCH DÙNG /GHINHO",
              "",
              "/ghinho nội dung",
              "→ Bot chỉ ghi nhớ nội dung.",
              "",
              "/ghinho câu hỏi - câu trả lời",
              "→ Khi ai hỏi câu đó, bot trả lời phần sau dấu -.",
              "",
              "Ví dụ:",
              "/ghinho Anh Hoàng Vũ ( Sun ) - anh ấy k7",
              "",
              "Sau đó người khác hỏi:",
              "Hoàng Vũ là ai?",
              "→ Bot: anh ấy k7"
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
              "❌ Sai cú pháp.\nDùng: /ghinho câu hỏi - câu trả lời"
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
                answer,
              createdBy:
                String(userId),
              createdAt:
                new Date().toISOString()
            }
          );

          await sendMessage(
            chatId,
            [
              "✅ Đã ghi nhớ.",
              "",
              `🧠 Câu: ${question}`,
              `🤖 Trả lời: ${answer}`
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
              null,

            createdBy:
              String(userId),

            createdAt:
              new Date().toISOString()
          }
        );

        await sendMessage(
          chatId,
          [
            "🧠 Đã ghi nhớ:",
            "",
            raw,
            "",
            "Chưa có câu trả lời riêng."
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

  const trimmed =
    String(text)
      .trim();

  const firstSpace =
    trimmed.indexOf(" ");

  let command;
  let rest;

  if (
    firstSpace === -1
  ) {

    command =
      trimmed.slice(1);

    rest = "";

  } else {

    command =
      trimmed.slice(
        1,
        firstSpace
      );

    rest =
      trimmed
        .slice(
          firstSpace + 1
        )
        .trim();
  }

  // Cho phép /help@bot
  command =
    command
      .split("@")[0]
      .toLowerCase();

  return {
    command,

    args:
      rest
        ? rest.split(/\s+/)
        : [],

    text:
      rest
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
        "Dùng /help để xem tất cả lệnh."
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
    data.message ||
    {};

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
    "TEXT:",
    text
  );

  // ==========================================================
  // GROUP CHAT SWITCH
  // ==========================================================

  if (isGroup) {

    if (
      !groupChatEnabled
    ) {

      log(
        "GROUP CHAT OFF -> IGNORE"
      );

      return;
    }

    // Nhóm:
    // Chỉ / mới được xử lý.
    // Không kiểm tra @Bot.
    if (
      !text.startsWith("/")
    ) {

      log(
        "GROUP -> IGNORE: không có /"
      );

      return;
    }
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(
      text
    );

  if (parsed) {

    try {

      await handleCommand(
        update,
        parsed
      );

    } catch (
      error
    ) {

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
  // MEMORY
  // ==========================================================

  const remembered =
    getRememberedAnswer(
      text
    );

  if (
    remembered
  ) {

    log(
      "MEMORY HIT"
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

  } catch (
    error
  ) {

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
// HOME
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

      botEnabled,

      groupChatEnabled,

      ruleBreakEnabled
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
    log(
      "Không có ZALO_BOT_TOKEN."
    );

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
    "GROUP CHAT:",
    groupChatEnabled
      ? "ON"
      : "OFF"
  );

  console.log(
    "RULE BREAK:",
    ruleBreakEnabled
      ? "ON"
      : "OFF"
  );

  console.log(
    "GROUP MODE: / ONLY"
  );

  console.log(
    "MENTION REQUIRED: NO"
  );

  console.log(
    "=========================================="
  );

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
        "ZALO getMe ERROR:",
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
