/**
 * BOT MẶT ĐẤT MÀU XANH
 * Zalo Bot Platform + Google Gemini
 *
 * Node.js >= 18
 *
 * Render ENV:
 * ZALO_BOT_TOKEN=...
 * GEMINI_API_KEY=...
 * ADMIN_IDS=ID1,ID2
 * PUBLIC_URL=https://ten-service.onrender.com
 * ZALO_WEBHOOK_SECRET=... (không bắt buộc)
 * GEMINI_MODEL=gemini-3.7-flash (không bắt buộc)
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

// Hỗ trợ nhiều admin:
// ADMIN_IDS=123,456,789
// Vẫn tương thích ADMIN_ID cũ.
const ADMIN_IDS = [
  ...new Set(
    (
      process.env.ADMIN_IDS ||
      process.env.ADMIN_ID ||
      ""
    )
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  ),
];

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";

const GEMINI_MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL || "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
    ].filter(Boolean)
  ),
];

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
  (
    ZALO_BOT_TOKEN
      ? crypto
          .createHash("sha256")
          .update(ZALO_BOT_TOKEN)
          .digest("hex")
          .slice(0, 32)
      : ""
  )
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

  console.log(
    `👑 ADMIN IDS: ${
      ADMIN_IDS.length
        ? ADMIN_IDS.map((x) => mask(x, 3)).join(", ")
        : "NOT_SET"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(WEBHOOK_SECRET)}`
  );

  console.log("==============================================");

  if (!ZALO_BOT_TOKEN) {
    console.error("❌ Thiếu ZALO_BOT_TOKEN");
  }

  if (!GEMINI_API_KEY) {
    console.error("❌ Thiếu GEMINI_API_KEY");
  }

  if (!ADMIN_IDS.length) {
    console.warn("⚠️ Chưa cấu hình ADMIN_IDS.");
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Không có PUBLIC_URL / RENDER_EXTERNAL_URL."
    );
  }
}

// ============================================================
// HTTP JSON
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
  if (!ZALO_BOT_TOKEN) {
    throw new Error(
      "ZALO_BOT_TOKEN chưa được cấu hình."
    );
  }

  return (
    `${ZALO_API_BASE}/bot` +
    `${encodeURIComponent(ZALO_BOT_TOKEN)}/${method}`
  );
}

async function zaloApi(method, body) {
  const result = await postJson(
    zaloUrl(method),
    body
  );

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ` +
      `${JSON.stringify(result.data)}`
    );
  }

  if (result.data?.ok === false) {
    throw new Error(
      result.data.description ||
      result.data.message ||
      JSON.stringify(result.data)
    );
  }

  return result.data;
}

// ============================================================
// ZALO GET ME
// ============================================================

async function getMe() {
  const data = await zaloApi("getMe");

  botInfo = data?.result || null;

  log(
    "📡 ZALO getMe:",
    JSON.stringify(data)
  );

  if (!data?.ok) {
    throw new Error(
      `getMe thất bại: ${JSON.stringify(data)}`
    );
  }

  log("✅ ZALO BOT API: OK");

  return botInfo;
}

// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage(chatId, text) {
  if (!chatId) {
    throw new Error("Không có chat_id.");
  }

  const chunks = splitText(
    text ||
      "Xin lỗi, bot không có nội dung để trả lời.",
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
// SPLIT LONG TEXT
// ============================================================

function splitText(
  text,
  maxLength = 1900
) {
  text = String(text || "");

  if (text.length <= maxLength) {
    return [text];
  }

  const result = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(
      "\n",
      maxLength
    );

    if (cut < maxLength * 0.5) {
      cut = remaining.lastIndexOf(
        " ",
        maxLength
      );
    }

    if (cut < maxLength * 0.5) {
      cut = maxLength;
    }

    result.push(
      remaining.slice(0, cut)
    );

    remaining =
      remaining.slice(cut).trim();
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
      "⚠️ typing:",
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
    encodeURIComponent(GEMINI_API_KEY)
  );
}

// ============================================================
// GEMINI SYSTEM PROMPT
// ============================================================

const GEMINI_SYSTEM_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh, chatbot chạy trên Zalo.

Quy tắc:

- Trả lời bằng tiếng Việt.
- Tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Tên bot là Bot Mặt Đất Màu Xanh.
- Người tạo bot là An Na & Hoàng Vũ.
- Nếu người dùng hỏi ai tạo bot, ai làm bot,
  bot của ai, cha đẻ bot, ai đứng sau bot,
  hoặc câu có ý nghĩa tương đương,
  trả lời chính xác:

"An Na & Hoàng Vũ."

- Không tự bịa người tạo khác.

Nếu bot đang ở chế độ /batquytac:

- Đây chỉ là chế độ ứng dụng do admin bật.
- Không tuyên bố rằng chính sách, giới hạn an toàn
  hoặc quy định của hệ thống/API đã bị vô hiệu hóa.
- Vẫn trả lời trong phạm vi API cho phép.

Không tiết lộ:
- API key
- Zalo token
- webhook secret
- biến môi trường
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

  const prompt = [
    `Tên người dùng: ${
      userName || "Người dùng"
    }`,

    `Chế độ bot: ${
      unrestrictedMode
        ? "BATQUYTAC"
        : "BÌNH THƯỜNG"
    }`,

    "",

    "Tin nhắn:",
    String(userText),
  ].join("\n");

  let lastError = null;

  for (const model of GEMINI_MODELS) {
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
              maxOutputTokens: 2048,
              temperature: 0.7,
            },
          },
          60000
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.httpStatus}: ` +
          `${JSON.stringify(
            response.data
          )}`
        );
      }

      const data =
        response.data;

      if (data?.error) {
        throw new Error(
          data.error.message ||
          JSON.stringify(data.error)
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
      lastError = error;

      log(
        `⚠️ GEMINI ${model} lỗi:`,
        error.message
      );
    }
  }

  throw new Error(
    "Tất cả Gemini model đều lỗi: " +
    (lastError?.message ||
      "Unknown error")
  );
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
  COMMANDS.set(
    name.toLowerCase(),
    {
      name:
        name.toLowerCase(),
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
          name:
            name.toLowerCase(),
          ...config,
        }
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
      "h",
      "menu",
    ],

    description:
      "Xem danh sách lệnh",

    usage:
      "/help",

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
        "📚 DANH SÁCH LỆNH:",
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
        "💬 Nhắn tin bình thường để hỏi AI."
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
// /id
// ============================================================

registerCommand(
  "id",
  {
    description:
      "Xem ID",

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
  }
);

// ============================================================
// /bot
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
          "",
          "🟢 Server đang hoạt động.",
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
      "Bật bot",

    usage:
      "/on",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      botEnabled =
        true;

      await sendMessage(
        chatId,
        "🟢 Đã BẬT bot."
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
      "Tắt bot AI",

    usage:
      "/off",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      botEnabled =
        false;

      await sendMessage(
        chatId,
        "🔴 Đã TẮT bot AI.\nDùng /on để bật lại."
      );
    },
  }
);

// ============================================================
// /adminid
// ============================================================

registerCommand(
  "adminid",
  {
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
          `Số admin: ${
            ADMIN_IDS.length
          }`,
          `ID hiện tại: ${chatId}`,
          "",
          ADMIN_IDS.length
            ? "✅ Admin đã được cấu hình."
            : "⚠️ Chưa có ADMIN_IDS.",
        ].join("\n")
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
      "Bật chế độ đặc biệt cho admin",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      unrestrictedMode =
        !unrestrictedMode;

      await sendMessage(
        chatId,
        unrestrictedMode
          ? "⚡ Đã BẬT chế độ BATQUYTAC."
          : "🟢 Đã TẮT chế độ BATQUYTAC."
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
// COMMAND PARSER
// ============================================================

function parseCommand(
  text
) {
  const value =
    String(
      text || ""
    ).trim();

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

  const args =
    parts.slice(1);

  return {
    command,
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
  const uid =
    String(
      userId || ""
    );

  const cid =
    String(
      chatId || ""
    );

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
      try {
        await handleCommand(
          update,
          parsed
        );
      } catch (
        error
      ) {
        log(
          `❌ COMMAND /${parsed.command}:`,
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
        "Dùng /help để xem lệnh.",
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

  if (remembered) {
    try {
      await sendMessage(
        chatId,
        remembered
      );
    } catch (
      error
    ) {
      log(
        "❌ MEMORY SEND:",
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

    try {
      await sendMessage(
        chatId,
        "😵 Bot đang gặp lỗi AI. Vui lòng thử lại sau vài giây."
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
    !received ||
    !WEBHOOK_SECRET
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
      `📌 EVENT: ${
        update.eventName
      }`
    );

    // Trả 200 ngay.
    res.json({
      ok: true,
    });

    // ----------------------------------------------------------
    // TEXT
    // ----------------------------------------------------------

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
            "❌ HANDLE MESSAGE:",
            error.message
          );
        }
      );

      return;
    }

    // ----------------------------------------------------------
    // IMAGE
    // ----------------------------------------------------------

    if (
      update.eventName ===
      "message.image.received"
    ) {
      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🖼️ Bot đã nhận ảnh. Xử lý ảnh sẽ bổ sung sau."
        ).catch(
          (error) =>
            log(
              "❌ IMAGE:",
              error.message
            )
        );
      }

      return;
    }

    // ----------------------------------------------------------
    // STICKER
    // ----------------------------------------------------------

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
          (error) =>
            log(
              "❌ STICKER:",
              error.message
            )
        );
      }

      return;
    }

    // ----------------------------------------------------------
    // VOICE
    // ----------------------------------------------------------

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại. Xử lý voice sẽ bổ sung sau."
        ).catch(
          (error) =>
            log(
              "❌ VOICE:",
              error.message
            )
        );
      }
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

      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],

      botEnabled,

      unrestrictedMode,

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
      status: "online",

      zalo:
        Boolean(
          ZALO_BOT_TOKEN
        ),

      gemini:
        Boolean(
          GEMINI_API_KEY
        ),
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
    log(
      "⚠️ Thiếu token hoặc PUBLIC_URL -> bỏ qua setWebhook."
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

  if (!data?.ok) {
    throw new Error(
      `setWebhook thất bại: ${JSON.stringify(data)}`
    );
  }

  log(
    "✅ WEBHOOK ĐÃ ĐƯỢC SET"
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
        "❌ ZALO getMe:",
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
        "❌ WEBHOOK SETUP:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // FINAL LOG
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
      ADMIN_IDS.length
    } ID`
  );

  console.log(
    `⚡ BATQUYTAC: ${
      unrestrictedMode
        ? "ON"
        : "OFF"
    }`
  );

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

  console.log(
    "🟢 ĐANG CHỜ TIN NHẮN ZALO..."
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
