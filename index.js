/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * Zalo Bot Platform + Google Gemini
 *
 * Chức năng:
 * - Nhận mọi tin nhắn text từ Zalo
 * - Trả lời bằng Gemini
 * - /help
 * - /ping
 * - /id
 * - /bot
 * - /on
 * - /off
 * - /adminid
 * - Câu ghi nhớ: "ai tạo bot mặt đất màu xanh?"
 * - Tự động setWebhook khi chạy trên Render
 * - Tự động tạo webhook secret ổn định từ ZALO_BOT_TOKEN
 * - Hỗ trợ cả webhook payload:
 *      { event_name, message }
 *   và:
 *      { ok: true, result: { event_name, message } }
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

const ADMIN_ID = (
  process.env.ADMIN_ID ||
  ""
).trim();

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

// API chính thức của Zalo Bot Platform
const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";

// Gemini
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.7-flash",
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

// ============================================================
// WEBHOOK SECRET
// ============================================================
//
// Nếu không khai báo ZALO_WEBHOOK_SECRET:
//
// SHA256(ZALO_BOT_TOKEN).slice(0, 32)
//
// được dùng làm secret.
//
// Quan trọng:
// setWebhook và webhook server dùng CÙNG một secret,
// nên tránh lỗi "WEBHOOK AUTH FAILED" do lệch secret.
// ============================================================

const WEBHOOK_SECRET =
  (
    process.env.ZALO_WEBHOOK_SECRET ||
    crypto
      .createHash("sha256")
      .update(ZALO_BOT_TOKEN)
      .digest("hex")
      .slice(0, 32)
  ).trim();

// ============================================================
// LOG HELPERS
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
// VALIDATION
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
  console.log(`👑 ADMIN ID: ${ADMIN_ID || "NOT_SET"}`);
  console.log(`🔐 WEBHOOK SECRET: ${mask(WEBHOOK_SECRET)}`);
  console.log("==============================================");

  if (!ZALO_BOT_TOKEN) {
    console.error("❌ Thiếu ZALO_BOT_TOKEN");
  }

  if (!GEMINI_API_KEY) {
    console.error("❌ Thiếu GEMINI_API_KEY");
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Không có PUBLIC_URL / RENDER_EXTERNAL_URL."
    );
  }
}

// ============================================================
// GENERIC JSON POST
// ============================================================

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  return `${ZALO_API_BASE}/bot${encodeURIComponent(
    ZALO_BOT_TOKEN
  )}/${method}`;
}

async function zaloApi(method, body) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error("ZALO_BOT_TOKEN chưa được cấu hình.");
  }

  const result = await postJson(zaloUrl(method), body);

  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ${JSON.stringify(result.data)}`
    );
  }

  if (result.data && result.data.ok === false) {
    const description =
      result.data.description ||
      result.data.message ||
      JSON.stringify(result.data);

    const error = new Error(
      `Zalo API error: ${description}`
    );

    error.zaloResponse = result.data;

    throw error;
  }

  return result.data;
}

// ============================================================
// ZALO GET ME
// ============================================================

async function getMe() {
  log("🔎 Đang kiểm tra Zalo Bot API...");

  const data = await zaloApi("getMe");

  botInfo = data?.result || null;

  log("📡 ZALO getMe:", JSON.stringify(data));

  if (data?.ok) {
    log("✅ ZALO BOT API: OK");

    if (botInfo) {
      log("🤖 BOT INFO:", JSON.stringify(botInfo));
    }

    return botInfo;
  }

  throw new Error(
    `getMe thất bại: ${JSON.stringify(data)}`
  );
}

// ============================================================
// ZALO SEND MESSAGE
// ============================================================

async function sendMessage(chatId, text) {
  if (!chatId) {
    throw new Error("Không có chat_id.");
  }

  if (!text) {
    text = "Xin lỗi, bot không có nội dung để trả lời.";
  }

  // Zalo giới hạn nội dung tin nhắn.
  // Chia nhỏ nếu Gemini trả lời quá dài.
  const chunks = splitText(text, 1900);

  for (const chunk of chunks) {
    const data = await zaloApi("sendMessage", {
      chat_id: String(chatId),
      text: chunk,
    });

    if (!data?.ok) {
      throw new Error(
        `Zalo sendMessage thất bại: ${JSON.stringify(data)}`
      );
    }
  }

  return true;
}

// ============================================================
// SPLIT LONG MESSAGE
// ============================================================

function splitText(text, maxLength = 1900) {
  if (!text) return [""];

  if (text.length <= maxLength) {
    return [text];
  }

  const result = [];
  let remaining = String(text);

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);

    if (cut < Math.floor(maxLength * 0.5)) {
      cut = remaining.lastIndexOf(" ", maxLength);
    }

    if (cut < Math.floor(maxLength * 0.5)) {
      cut = maxLength;
    }

    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}

// ============================================================
// ZALO CHAT ACTION
// ============================================================

async function sendTyping(chatId) {
  try {
    await zaloApi("sendChatAction", {
      chat_id: String(chatId),
      action: "typing",
    });
  } catch (error) {
    // Không làm chết bot chỉ vì typing thất bại.
    log("⚠️ sendChatAction:", error.message);
  }
}

// ============================================================
// GEMINI
// ============================================================

function geminiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY)
  );
}

// ============================================================
// GEMINI SYSTEM PROMPT
// ============================================================

const GEMINI_SYSTEM_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh, một chatbot chạy trên Zalo.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên, thân thiện.
- Trả lời ngắn gọn khi câu hỏi đơn giản.
- Không tự nhận mình là Google Gemini nếu người dùng hỏi tên bot.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

Thông tin ghi nhớ cố định:
Nếu người dùng hỏi những câu có ý nghĩa tương đương với:
- "Ai tạo ra Bot Mặt Đất Màu Xanh?"
- "Ai làm bot này?"
- "Bot này của ai?"
- "Ai tạo bot?"
- "Cha đẻ bot là ai?"
- "Ai đứng sau bot?"

thì trả lời:
"An Na & Hoàng Vũ."

Không được tự bịa thêm người tạo khác.

Bot hỗ trợ:
- /help
- /ping
- /id
- /bot
- /on
- /off
- /adminid

Nếu người dùng nói chuyện bình thường thì trả lời như một AI assistant.
`;

// ============================================================
// GEMINI REQUEST
// ============================================================

async function askGemini(userText, userName = "") {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY chưa được cấu hình.");
  }

  const prompt = `
Tên người dùng: ${userName || "Người dùng"}

Tin nhắn:
${userText}
`;

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      log(`🧠 Đang hỏi Gemini: ${model}`);

      const response = await postJson(
        geminiUrl(model),
        {
          systemInstruction: {
            parts: [
              {
                text: GEMINI_SYSTEM_PROMPT,
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
          `HTTP ${response.httpStatus}: ${JSON.stringify(
            response.data
          )}`
        );
      }

      const data = response.data;

      if (data?.error) {
        throw new Error(
          data.error.message ||
            JSON.stringify(data.error)
        );
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim();

      if (!text) {
        throw new Error(
          `Gemini không trả về text: ${JSON.stringify(data)}`
        );
      }

      activeGeminiModel = model;

      log(`✅ GEMINI OK: ${model}`);

      return text;
    } catch (error) {
      lastError = error;

      log(`⚠️ GEMINI ${model} lỗi: ${error.message}`);

      // Thử model tiếp theo.
      continue;
    }
  }

  throw new Error(
    `Tất cả Gemini model đều lỗi: ${
      lastError?.message || "Unknown error"
    }`
  );
}

// ============================================================
// NORMALIZE WEBHOOK
// ============================================================
//
// Zalo có thể trả:
//
// {
//   "ok": true,
//   "result": {
//      "event_name": "...",
//      "message": {...}
//   }
// }
//
// hoặc một số hệ thống/proxy có thể đưa trực tiếp:
//
// {
//   "event_name": "...",
//   "message": {...}
// }
//
// Hàm này xử lý cả hai.
// ============================================================

function normalizeWebhook(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const data =
    body.result &&
    typeof body.result === "object"
      ? body.result
      : body;

  const message = data.message || {};

  return {
    eventName: data.event_name || "",
    message,
    chatId:
      message?.chat?.id
        ? String(message.chat.id)
        : "",
    chatType:
      message?.chat?.chat_type || "",
    userId:
      message?.from?.id
        ? String(message.from.id)
        : "",
    userName:
      message?.from?.display_name ||
      message?.from?.name ||
      "",
    text:
      typeof message?.text === "string"
        ? message.text.trim()
        : "",
    messageId:
      message?.message_id
        ? String(message.message_id)
        : "",
  };
}

// ============================================================
// COMMAND SYSTEM
// ============================================================
//
// MUỐN THÊM LỆNH SAU NÀY:
//
// commands.set("ff", {
//   description: "Lệnh Free Fire",
//   usage: "/ff <nội dung>",
//   adminOnly: false,
//   handler: async ({ chatId, args, text }) => {
//      await sendMessage(chatId, "FF đây!");
//   }
// });
//
// Chỉ cần thêm một command vào COMMANDS.
// ============================================================

const COMMANDS = new Map();

function registerCommand(name, config) {
  COMMANDS.set(name.toLowerCase(), {
    name: name.toLowerCase(),
    ...config,
  });

  if (Array.isArray(config.aliases)) {
    for (const alias of config.aliases) {
      COMMANDS.set(alias.toLowerCase(), {
        name: name.toLowerCase(),
        ...config,
      });
    }
  }
}

// ============================================================
// /help
// ============================================================

registerCommand("help", {
  aliases: ["h", "menu"],
  description: "Xem danh sách lệnh",
  usage: "/help",
  adminOnly: false,

  async handler({ chatId }) {
    const unique = new Map();

    for (const command of COMMANDS.values()) {
      if (!unique.has(command.name)) {
        unique.set(command.name, command);
      }
    }

    const lines = [
      "🤖 BOT MẶT ĐẤT MÀU XANH",
      "",
      "📚 DANH SÁCH LỆNH:",
    ];

    for (const command of unique.values()) {
      lines.push(
        `• /${command.name} — ${command.description || ""}`
      );
    }

    lines.push("");
    lines.push(
      "💬 Không cần lệnh cũng được. Cứ nhắn tin bình thường, bot sẽ trả lời bằng AI."
    );

    await sendMessage(chatId, lines.join("\n"));
  },
});

// ============================================================
// /ping
// ============================================================

registerCommand("ping", {
  description: "Kiểm tra bot có hoạt động không",
  usage: "/ping",
  adminOnly: false,

  async handler({ chatId }) {
    await sendMessage(
      chatId,
      "🏓 Pong!\n🟢 Bot đang hoạt động."
    );
  },
});

// ============================================================
// /id
// ============================================================

registerCommand("id", {
  description: "Xem ID cuộc trò chuyện",
  usage: "/id",
  adminOnly: false,

  async handler({ chatId, userId, chatType }) {
    await sendMessage(
      chatId,
      [
        "🆔 THÔNG TIN ID",
        "",
        `Chat ID: ${chatId}`,
        `User ID: ${userId || "Không có"}`,
        `Chat type: ${chatType || "Không rõ"}`,
      ].join("\n")
    );
  },
});

// ============================================================
// /bot
// ============================================================

registerCommand("bot", {
  description: "Xem thông tin bot",
  usage: "/bot",
  adminOnly: false,

  async handler({ chatId }) {
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
        `AI: Google Gemini`,
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
});

// ============================================================
// /on
// ============================================================

registerCommand("on", {
  description: "Bật bot",
  usage: "/on",
  adminOnly: true,

  async handler({ chatId }) {
    botEnabled = true;

    await sendMessage(
      chatId,
      "🟢 Đã BẬT bot."
    );
  },
});

// ============================================================
// /off
// ============================================================

registerCommand("off", {
  description: "Tắt bot AI",
  usage: "/off",
  adminOnly: true,

  async handler({ chatId }) {
    botEnabled = false;

    await sendMessage(
      chatId,
      "🔴 Đã TẮT bot AI.\nDùng /on để bật lại."
    );
  },
});

// ============================================================
// /adminid
// ============================================================

registerCommand("adminid", {
  description: "Kiểm tra cấu hình admin",
  usage: "/adminid",
  adminOnly: true,

  async handler({ chatId }) {
    await sendMessage(
      chatId,
      [
        "👑 ADMIN",
        "",
        `ADMIN_ID: ${ADMIN_ID || "CHƯA CẤU HÌNH"}`,
        `ID hiện tại: ${chatId}`,
        "",
        ADMIN_ID
          ? "✅ Admin đã được cấu hình."
          : "⚠️ Hãy lấy Chat ID bằng /id rồi đặt ADMIN_ID trên Render.",
      ].join("\n")
    );
  },
});

// ============================================================
// REMEMBERED ANSWERS
// ============================================================
//
// Đây là câu trả lời cố định, không gọi Gemini.
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

    answer: "An Na & Hoàng Vũ.",
  },
];

// ============================================================
// NORMALIZE VIETNAMESE TEXT
// ============================================================

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[?!.,;:()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// MEMORY MATCH
// ============================================================

function getRememberedAnswer(text) {
  const normalized = normalizeText(text);

  for (const rule of MEMORY_RULES) {
    for (const pattern of rule.patterns) {
      const p = normalizeText(pattern);

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
  const value = String(text || "").trim();

  if (!value.startsWith("/")) {
    return null;
  }

  const parts = value.split(/\s+/);

  const rawCommand = parts[0]
    .slice(1)
    .split("@")[0]
    .toLowerCase();

  const args = parts.slice(1);

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
// IS ADMIN
// ============================================================

function isAdmin(userId, chatId) {
  if (!ADMIN_ID) {
    return false;
  }

  return (
    String(userId) === ADMIN_ID ||
    String(chatId) === ADMIN_ID
  );
}

// ============================================================
// HANDLE COMMAND
// ============================================================

async function handleCommand(update, parsed) {
  const command = COMMANDS.get(parsed.command);

  if (!command) {
    return false;
  }

  const admin = isAdmin(
    update.userId,
    update.chatId
  );

  if (command.adminOnly && !admin) {
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

async function handleMessage(update) {
  const {
    chatId,
    userId,
    userName,
    text,
  } = update;

  if (!chatId || !text) {
    return;
  }

  log("==============================================");
  log(`👤 USER: ${userName || "Unknown"}`);
  log(`🆔 USER ID: ${userId || "Unknown"}`);
  log(`💬 CHAT ID: ${chatId}`);
  log(`💬 TEXT: ${text}`);

  // ----------------------------------------------------------
  // COMMAND
  // ----------------------------------------------------------

  const parsed = parseCommand(text);

  if (parsed) {
    const exists = COMMANDS.has(parsed.command);

    if (exists) {
      log(`⚙️ COMMAND: /${parsed.command}`);

      try {
        await handleCommand(update, parsed);
      } catch (error) {
        log(
          `❌ COMMAND ERROR /${parsed.command}:`,
          error.message
        );

        await sendMessage(
          chatId,
          "❌ Lệnh bị lỗi. Kiểm tra log Render."
        );
      }

      return;
    }

    // Lệnh không tồn tại
    await sendMessage(
      chatId,
      [
        `❓ Không có lệnh /${parsed.command}`,
        "",
        "Dùng /help để xem danh sách lệnh.",
      ].join("\n")
    );

    return;
  }

  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------

  const remembered = getRememberedAnswer(text);

  if (remembered) {
    log("🧠 MEMORY HIT");

    try {
      await sendMessage(chatId, remembered);
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
    log("🔴 BOT OFF - bỏ qua tin nhắn.");
    return;
  }

  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  await sendTyping(chatId);

  try {
    log("🧠 Đang hỏi Gemini...");

    const answer = await askGemini(
      text,
      userName
    );

    log("🤖 GEMINI:", answer);

    await sendMessage(
      chatId,
      answer
    );

    log("✅ ĐÃ GỬI TRẢ LỜI ZALO");
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
          "Vui lòng thử lại sau vài giây.",
        ].join("\n")
      );
    } catch (sendError) {
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

function verifyWebhook(req) {
  const received =
    req.headers["x-bot-api-secret-token"];

  if (!received) {
    return false;
  }

  const receivedString = String(received);

  const a = Buffer.from(receivedString);
  const b = Buffer.from(WEBHOOK_SECRET);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

// ============================================================
// WEBHOOK ROUTE
// ============================================================

app.post("/webhook", async (req, res) => {
  // ----------------------------------------------------------
  // VERIFY SECRET
  // ----------------------------------------------------------

  if (!verifyWebhook(req)) {
    log("🚫 WEBHOOK AUTH FAILED");

    log(
      "Header secret:",
      mask(
        String(
          req.headers["x-bot-api-secret-token"] || ""
        )
      )
    );

    log(
      "Expected secret:",
      mask(WEBHOOK_SECRET)
    );

    return res.status(403).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  // ----------------------------------------------------------
  // NORMALIZE EVENT
  // ----------------------------------------------------------

  const update = normalizeWebhook(req.body);

  if (!update) {
    return res.json({
      ok: true,
    });
  }

  log("📩 ZALO WEBHOOK");
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

  // ----------------------------------------------------------
  // PHẢN HỒI NGAY CHO ZALO
  // ----------------------------------------------------------
  //
  // Không chờ Gemini ở đây.
  // Nếu chờ AI lâu, webhook có thể timeout/retry.
  // ----------------------------------------------------------

  res.json({
    ok: true,
  });

  // ----------------------------------------------------------
  // CHỈ XỬ LÝ TEXT
  // ----------------------------------------------------------

  if (
    update.eventName ===
    "message.text.received"
  ) {
    handleMessage(update).catch((error) => {
      log(
        "❌ HANDLE MESSAGE ERROR:",
        error.message
      );
    });

    return;
  }

  // ----------------------------------------------------------
  // EVENT KHÁC
  // ----------------------------------------------------------

  if (
    update.eventName ===
    "message.image.received"
  ) {
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "🖼️ Bot đã nhận được ảnh. Chức năng xử lý ảnh sẽ bổ sung sau."
      ).catch((error) => {
        log(
          "❌ IMAGE REPLY ERROR:",
          error.message
        );
      });
    }

    return;
  }

  if (
    update.eventName ===
    "message.sticker.received"
  ) {
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "😎 Sticker đẹp đấy!"
      ).catch((error) => {
        log(
          "❌ STICKER REPLY ERROR:",
          error.message
        );
      });
    }

    return;
  }

  if (
    update.eventName ===
    "message.voice.received"
  ) {
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "🎤 Bot đã nhận tin nhắn thoại. Chức năng xử lý voice sẽ bổ sung sau."
      ).catch((error) => {
        log(
          "❌ VOICE REPLY ERROR:",
          error.message
        );
      });
    }

    return;
  }
});

// ============================================================
// WEBHOOK GET / HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    bot: "Bot Mặt Đất Màu Xanh",
    server: "online",
    zalo: Boolean(ZALO_BOT_TOKEN),
    gemini: Boolean(GEMINI_API_KEY),
    model:
      activeGeminiModel ||
      GEMINI_MODELS[0],
    webhook: PUBLIC_URL
      ? `${PUBLIC_URL}/webhook`
      : null,
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
  });
});

// ============================================================
// SET WEBHOOK
// ============================================================

async function setWebhook() {
  if (!ZALO_BOT_TOKEN) {
    return;
  }

  if (!PUBLIC_URL) {
    log(
      "⚠️ Không có PUBLIC_URL. Không thể tự setWebhook."
    );
    return;
  }

  if (!PUBLIC_URL.startsWith("https://")) {
    log(
      "⚠️ PUBLIC_URL không phải HTTPS:",
      PUBLIC_URL
    );
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log("🔗 Đang set Zalo webhook:");
  log(webhookUrl);

  const data = await zaloApi(
    "setWebhook",
    {
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
    }
  );

  log(
    "📡 ZALO setWebhook:",
    JSON.stringify(data)
  );

  if (data?.ok) {
    log("✅ WEBHOOK ĐÃ ĐƯỢC SET");
    log(
      "🔐 WEBHOOK SECRET:",
      mask(WEBHOOK_SECRET)
    );
  } else {
    throw new Error(
      `setWebhook thất bại: ${JSON.stringify(data)}`
    );
  }
}

// ============================================================
// GET WEBHOOK INFO
// ============================================================

async function getWebhookInfo() {
  try {
    const data =
      await zaloApi("getWebhookInfo");

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
// GEMINI TEST
// ============================================================

async function testGemini() {
  if (!GEMINI_API_KEY) {
    return false;
  }

  log("🧠 Đang kiểm tra Gemini...");

  try {
    const answer =
      await askGemini(
        "Trả lời đúng một chữ: OK",
        "SYSTEM TEST"
      );

    log("✅ GEMINI TEST:", answer);
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

  if (ZALO_BOT_TOKEN) {
    try {
      await getMe();
    } catch (error) {
      log(
        "❌ ZALO getMe ERROR:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  if (GEMINI_API_KEY) {
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
        "❌ WEBHOOK SETUP ERROR:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // FINAL
  // ----------------------------------------------------------

  console.log("");
  console.log("==============================================");
  console.log("🚀 BOT MẶT ĐẤT MÀU XANH ĐÃ ONLINE");
  console.log("==============================================");
  console.log(`🌐 PORT: ${PORT}`);
  console.log(
    `🔌 ZALO BOT API: ${
      ZALO_BOT_TOKEN ? "READY" : "MISSING"
    }`
  );
  console.log(
    `🧠 GEMINI: ${
      GEMINI_API_KEY ? "READY" : "MISSING"
    }`
  );
  console.log(
    `🧠 MODEL: ${
      activeGeminiModel ||
      GEMINI_MODELS[0]
    }`
  );
  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );
  console.log(
    `👑 ADMIN: ${
      ADMIN_ID ? "ĐÃ CẤU HÌNH" : "CHƯA CẤU HÌNH"
    }`
  );
  console.log("");
  console.log(
    "📚 LỆNH:",
    [...new Set(
      [...COMMANDS.values()].map(
        (x) => `/${x.name}`
      )
    )].join(", ")
  );
  console.log("");
  console.log("🟢 ĐANG CHỜ TIN NHẮN ZALO...");
  console.log("==============================================");
}

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  log(`🚀 Server listening on port ${PORT}`);

  startup().catch((error) => {
    log(
      "❌ STARTUP ERROR:",
      error.message
    );
  });
});

// ============================================================
// PROCESS SAFETY
// ============================================================

process.on("unhandledRejection", (reason) => {
  console.error(
    "❌ UNHANDLED REJECTION:",
    reason
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "❌ UNCAUGHT EXCEPTION:",
    error
  );
});
