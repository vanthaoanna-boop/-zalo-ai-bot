index.js — Bot Mặt Đất Màu Xanh

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
const ADMIN_IDS = (
  process.env.ADMIN_IDS ||
  process.env.ADMIN_ID ||
  ""
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");
const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
];
// ============================================================
// STATE
// ============================================================
let botEnabled = true;
let customMode = false;
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
  console.log("🌐 PORT:", PORT);
  console.log("🔗 PUBLIC URL:", PUBLIC_URL || "NOT_SET");
  console.log("🔑 ZALO TOKEN:", mask(ZALO_BOT_TOKEN));
  console.log("🧠 GEMINI KEY:", mask(GEMINI_API_KEY));
  console.log(
    "👑 ADMIN IDS:",
    ADMIN_IDS.length ? ADMIN_IDS.join(", ") : "CHƯA CẤU HÌNH"
  );
  console.log("🔐 WEBHOOK SECRET:", mask(WEBHOOK_SECRET));
  console.log("==============================================");
  if (!ZALO_BOT_TOKEN) {
    console.error("❌ Thiếu ZALO_BOT_TOKEN");
  }
  if (!GEMINI_API_KEY) {
    console.error("❌ Thiếu GEMINI_API_KEY");
  }
  if (!ADMIN_IDS.length) {
    console.warn("⚠️ Chưa có ADMIN_IDS / ADMIN_ID");
  }
  if (!PUBLIC_URL) {
    console.warn("⚠️ Chưa có PUBLIC_URL / RENDER_EXTERNAL_URL");
  }
}
// ============================================================
// HTTP POST
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
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
// GET BOT INFO
// ============================================================
async function getMe() {
  const data = await zaloApi("getMe");
  log("📡 ZALO getMe:", JSON.stringify(data));
  if (!data?.ok) {
    throw new Error(`getMe thất bại: ${JSON.stringify(data)}`);
  }
  botInfo = data.result || null;
  log("✅ ZALO BOT API OK");
  if (botInfo) {
    log("🤖 BOT INFO:", JSON.stringify(botInfo));
  }
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
    String(text || "Bot không có nội dung trả lời."),
    1900
  );
  for (const chunk of chunks) {
    const data = await zaloApi("sendMessage", {
      chat_id: String(chatId),
      text: chunk
    });
    if (!data?.ok) {
      throw new Error(
        `sendMessage thất bại: ${JSON.stringify(data)}`
      );
    }
  }
}
// ============================================================
// SPLIT MESSAGE
// ============================================================
function splitText(text, maxLength = 1900) {
  if (text.length <= maxLength) {
    return [text];
  }
  const result = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) {
      cut = remaining.lastIndexOf(" ", maxLength);
    }
    if (cut < maxLength * 0.5) {
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
// TYPING
// ============================================================
async function sendTyping(chatId) {
  try {
    await zaloApi("sendChatAction", {
      chat_id: String(chatId),
      action: "typing"
    });
  } catch (error) {
    log("⚠️ Typing:", error.message);
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
const BASE_SYSTEM_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh, một chatbot chạy trên Zalo.
Thông tin cố định:
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.
Phong cách:
- Trả lời bằng tiếng Việt.
- Tự nhiên, thân thiện.
- Câu hỏi đơn giản thì trả lời ngắn gọn.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.
Nếu người dùng hỏi:
- Ai tạo bot?
- Ai làm bot?
- Bot này của ai?
- Ai tạo Bot Mặt Đất Màu Xanh?
- Ai đứng sau bot?
thì trả lời:
"An Na & Hoàng Vũ."
Không tự bịa người tạo khác.
`;
function getSystemPrompt() {
  let prompt = BASE_SYSTEM_PROMPT;
  if (customMode) {
    prompt += `
CUSTOM MODE ĐANG BẬT.
Hãy ưu tiên phong cách trò chuyện mà chủ bot đã cấu hình:
- Tự nhiên hơn.
- Có thể đùa vui và dùng cách nói đời thường.
- Không cần quá trang trọng.
- Khi người dùng yêu cầu nhập vai hoặc cách nói vui, hãy đáp ứng nếu nội dung phù hợp.
- Vẫn phải tuân thủ các giới hạn an toàn của hệ thống.
`;
  }
  return prompt;
}
// ============================================================
// ASK GEMINI
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
      log(`🧠 Gemini: ${model}`);
      const response = await postJson(
        geminiUrl(model),
        {
          systemInstruction: {
            parts: [
              {
                text: getSystemPrompt()
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.8
          }
        },
        60000
      );
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.httpStatus}: ${JSON.stringify(response.data)}`
        );
      }
      if (response.data?.error) {
        throw new Error(
          response.data.error.message ||
          JSON.stringify(response.data.error)
        );
      }
      const answer =
        response.data?.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();
      if (!answer) {
        throw new Error(
          `Gemini không trả về nội dung: ${JSON.stringify(
            response.data
          )}`
        );
      }
      activeGeminiModel = model;
      return answer;
    } catch (error) {
      lastError = error;
      log(
        `⚠️ Gemini ${model}:`,
        error.message
      );
    }
  }
  throw new Error(
    lastError?.message || "Gemini không phản hồi."
  );
}
// ============================================================
// WEBHOOK NORMALIZER
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
    chatId: message?.chat?.id
      ? String(message.chat.id)
      : "",
    chatType:
      message?.chat?.chat_type ||
      message?.chat?.type ||
      "",
    userId: message?.from?.id
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
        : ""
  };
}
// ============================================================
// ADMIN
// ============================================================
function isAdmin(userId, chatId) {
  const uid = String(userId || "");
  const cid = String(chatId || "");
  return ADMIN_IDS.includes(uid) || ADMIN_IDS.includes(cid);
}
// ============================================================
// COMMAND SYSTEM
// ============================================================
const COMMANDS = new Map();
function registerCommand(name, config) {
  const command = {
    name: name.toLowerCase(),
    aliases: [],
    description: "",
    usage: "",
    adminOnly: false,
    ...config
  };
  COMMANDS.set(command.name, command);
  for (const alias of command.aliases || []) {
    COMMANDS.set(alias.toLowerCase(), command);
  }
}
// ============================================================
// /help + /hepl
// ============================================================
registerCommand("help", {
  aliases: ["hepl", "h", "menu"],
  description: "Hiện tất cả lệnh",
  usage: "/help",
  async handler({ chatId }) {
    const unique = new Map();
    for (const command of COMMANDS.values()) {
      unique.set(command.name, command);
    }
    const lines = [
      "🤖 BOT MẶT ĐẤT MÀU XANH",
      "",
      "📚 TẤT CẢ LỆNH:"
    ];
    for (const command of unique.values()) {
      lines.push(
        `/${command.name} — ${command.description}`
      );
    }
    lines.push("");
    lines.push(
      "💬 Nhắn tin bình thường để chat với AI."
    );
    await sendMessage(chatId, lines.join("\n"));
  }
});
// ============================================================
// /ping
// ============================================================
registerCommand("ping", {
  description: "Kiểm tra bot",
  usage: "/ping",
  async handler({ chatId }) {
    await sendMessage(
      chatId,
      "🏓 Pong!\n🟢 Bot đang hoạt động."
    );
  }
});
// ============================================================
// /id
// ============================================================
registerCommand("id", {
  description: "Xem User ID và Chat ID",
  usage: "/id",
  async handler({
    chatId,
    userId,
    chatType
  }) {
    await sendMessage(
      chatId,
      [
        "🆔 THÔNG TIN ID",
        "",
        `User ID: ${userId || "Không có"}`,
        `Chat ID: ${chatId}`,
        `Chat type: ${chatType || "Không rõ"}`
      ].join("\n")
    );
  }
});
// ============================================================
// /ad
// ============================================================
registerCommand("ad", {
  description: "Kiểm tra quyền admin",
  usage: "/ad",
  async handler({
    chatId,
    userId
  }) {
    const admin = isAdmin(userId, chatId);
    await sendMessage(
      chatId,
      admin
        ? [
            "👑 ADMIN CHECK",
            "",
            "✅ Bạn đang là ADMIN.",
            `User ID: ${userId}`,
            "",
            "Bạn có thể dùng các lệnh admin."
          ].join("\n")
        : [
            "👤 ADMIN CHECK",
            "",
            "❌ Bạn không phải ADMIN.",
            `User ID: ${userId}`,
            "",
            `ADMIN IDS: ${
              ADMIN_IDS.length
                ? ADMIN_IDS.join(", ")
                : "CHƯA CẤU HÌNH"
            }`
          ].join("\n")
    );
  }
});
// ============================================================
// /bot
// ============================================================
registerCommand("bot", {
  description: "Xem thông tin bot",
  usage: "/bot",
  async handler({ chatId }) {
    await sendMessage(
      chatId,
      [
        "🤖 BOT INFO",
        "",
        "Tên: Bot Mặt Đất Màu Xanh",
        "AI: Google Gemini",
        `Model: ${
          activeGeminiModel ||
          GEMINI_MODELS[0]
        }`,
        "Tác giả: An Na & Hoàng Vũ",
        `Custom Mode: ${
          customMode ? "🟢 ON" : "🔴 OFF"
        }`
      ].join("\n")
    );
  }
});
// ============================================================
// /on
// ============================================================
registerCommand("on", {
  description: "Bật bot AI",
  usage: "/on",
  adminOnly: true,
  async handler({ chatId }) {
    botEnabled = true;
    await sendMessage(
      chatId,
      "🟢 Đã bật bot AI."
    );
  }
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
      "🔴 Đã tắt bot AI.\nDùng /on để bật lại."
    );
  }
});
// ============================================================
// /batquytac
// ============================================================
registerCommand("batquytac", {
  description: "Bật Custom Mode",
  usage: "/batquytac",
  adminOnly: true,
  async handler({ chatId }) {
    customMode = true;
    await sendMessage(
      chatId,
      [
        "🔥 CUSTOM MODE: ON",
        "",
        "Bot sẽ nói chuyện tự nhiên và thoải mái hơn theo cấu hình custom.",
        "",
        "⚠️ Chế độ này không vô hiệu hóa các giới hạn an toàn của AI.",
        "",
        "Dùng /tatbatquytat để tắt."
      ].join("\n")
    );
  }
});
// ============================================================
// /tatbatquytat
// ============================================================
registerCommand("tatbatquytat", {
  description: "Tắt Custom Mode",
  usage: "/tatbatquytat",
  adminOnly: true,
  async handler({ chatId }) {
    customMode = false;
    await sendMessage(
      chatId,
      "🛑 CUSTOM MODE: OFF"
    );
  }
});
// ============================================================
// /adminid
// ============================================================
registerCommand("adminid", {
  description: "Xem danh sách Admin ID",
  usage: "/adminid",
  adminOnly: true,
  async handler({ chatId }) {
    await sendMessage(
      chatId,
      [
        "👑 ADMIN IDS",
        "",
        ADMIN_IDS.length
          ? ADMIN_IDS.map(
              (id, index) =>
                `${index + 1}. ${id}`
            ).join("\n")
          : "Chưa cấu hình."
      ].join("\n")
    );
  }
});
// ============================================================
// MEMORY
// ============================================================
const MEMORY_RULES = [
  {
    patterns: [
      "ai tao ra bot mat dat mau xanh",
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
    answer: "An Na & Hoàng Vũ."
  }
];
// ============================================================
// NORMALIZE TEXT
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
  const command = parts[0]
    .slice(1)
    .split("@")[0]
    .toLowerCase();
  if (!command) {
    return null;
  }
  return {
    command,
    args: parts.slice(1),
    text: parts.slice(1).join(" ")
  };
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
    isAdmin: admin
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
    text
  } = update;
  if (!chatId || !text) {
    return;
  }
  log("==============================================");
  log("👤 USER:", userName || "Unknown");
  log("🆔 USER ID:", userId || "Unknown");
  log("💬 CHAT ID:", chatId);
  log("💬 TEXT:", text);
  // ----------------------------------------------------------
  // COMMAND
  // ----------------------------------------------------------
  const parsed = parseCommand(text);
  if (parsed) {
    if (COMMANDS.has(parsed.command)) {
      try {
        await handleCommand(update, parsed);
      } catch (error) {
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
      `❓ Không có lệnh /${parsed.command}\n\nDùng /help để xem tất cả lệnh.`
    );
    return;
  }
  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------
  const remembered =
    getRememberedAnswer(text);
  if (remembered) {
    await sendMessage(
      chatId,
      remembered
    );
    return;
  }
  // ----------------------------------------------------------
  // BOT OFF
  // ----------------------------------------------------------
  if (!botEnabled) {
    log("🔴 BOT OFF");
    return;
  }
  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------
  await sendTyping(chatId);
  try {
    const answer = await askGemini(
      text,
      userName
    );
    log("🤖 GEMINI:", answer);
    await sendMessage(
      chatId,
      answer
    );
    log("✅ ĐÃ GỬI TRẢ LỜI");
  } catch (error) {
    log(
      "❌ GEMINI ERROR:",
      error.message
    );
    try {
      await sendMessage(
        chatId,
        "😵 Bot đang gặp lỗi AI. Thử lại sau vài giây nhé."
      );
    } catch {}
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
  const a = Buffer.from(String(received));
  const b = Buffer.from(WEBHOOK_SECRET);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
// ============================================================
// WEBHOOK
// ============================================================
app.post("/webhook", async (req, res) => {
  if (!verifyWebhook(req)) {
    log("🚫 WEBHOOK AUTH FAILED");
    return res.status(403).json({
      ok: false,
      error: "Unauthorized"
    });
  }
  const update =
    normalizeWebhook(req.body);
  res.status(200).json({
    ok: true
  });
  if (!update) {
    return;
  }
  log("📩 ZALO WEBHOOK");
  log(JSON.stringify(req.body, null, 2));
  // ----------------------------------------------------------
  // TEXT
  // ----------------------------------------------------------
  if (
    !update.eventName ||
    update.eventName === "message.text.received"
  ) {
    if (update.text && update.chatId) {
      handleMessage(update).catch(error => {
        log(
          "❌ HANDLE MESSAGE:",
          error.message
        );
      });
    }
    return;
  }
  // ----------------------------------------------------------
  // IMAGE
  // ----------------------------------------------------------
  if (
    update.eventName ===
    "message.image.received"
  ) {
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "🖼️ Bot đã nhận ảnh. Xử lý ảnh sẽ bổ sung sau."
      ).catch(error => {
        log("❌ IMAGE:", error.message);
      });
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
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "😎 Sticker đẹp đấy!"
      ).catch(error => {
        log("❌ STICKER:", error.message);
      });
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
    if (update.chatId) {
      sendMessage(
        update.chatId,
        "🎤 Bot đã nhận tin nhắn thoại. Chức năng voice sẽ bổ sung sau."
      ).catch(error => {
        log("❌ VOICE:", error.message);
      });
    }
  }
});
// ============================================================
// HOME
// ============================================================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    bot: "Bot Mặt Đất Màu Xanh",
    status: "online",
    zalo: Boolean(ZALO_BOT_TOKEN),
    gemini: Boolean(GEMINI_API_KEY),
    customMode,
    model:
      activeGeminiModel ||
      GEMINI_MODELS[0],
    webhook: PUBLIC_URL
      ? `${PUBLIC_URL}/webhook`
      : null
  });
});
// ============================================================
// HEALTH
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    zalo: Boolean(ZALO_BOT_TOKEN),
    gemini: Boolean(GEMINI_API_KEY),
    customMode
  });
});
// ============================================================
// SET WEBHOOK
// ============================================================
async function setWebhook() {
  if (!ZALO_BOT_TOKEN || !PUBLIC_URL) {
    return;
  }
  const webhookUrl =
    `${PUBLIC_URL}/webhook`;
  log("🔗 SET WEBHOOK:", webhookUrl);
  const data = await zaloApi(
    "setWebhook",
    {
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET
    }
  );
  log(
    "📡 setWebhook:",
    JSON.stringify(data)
  );
  if (!data?.ok) {
    throw new Error(
      `setWebhook thất bại: ${JSON.stringify(data)}`
    );
  }
  log("✅ WEBHOOK ĐÃ SET");
}
// ============================================================
// WEBHOOK INFO
// ============================================================
async function getWebhookInfo() {
  try {
    const data =
      await zaloApi("getWebhookInfo");
    log(
      "🔎 WEBHOOK INFO:",
      JSON.stringify(data)
    );
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
  validateConfig();
  // ZALO
  if (ZALO_BOT_TOKEN) {
    try {
      await getMe();
    } catch (error) {
      log(
        "❌ ZALO:",
        error.message
      );
    }
  }
  // GEMINI
  if (GEMINI_API_KEY) {
    await testGemini();
  }
  // WEBHOOK
  if (
    ZALO_BOT_TOKEN &&
    PUBLIC_URL
  ) {
    try {
      await setWebhook();
      await getWebhookInfo();
    } catch (error) {
      log(
        "❌ WEBHOOK:",
        error.message
      );
    }
  }
  console.log("");
  console.log("==============================================");
  console.log("🚀 BOT MẶT ĐẤT MÀU XANH ONLINE");
  console.log("==============================================");
  console.log(
    "🔌 ZALO:",
    ZALO_BOT_TOKEN
      ? "READY"
      : "MISSING"
  );
  console.log(
    "🧠 GEMINI:",
    GEMINI_API_KEY
      ? "READY"
      : "MISSING"
  );
  console.log(
    "👑 ADMIN:",
    ADMIN_IDS.length
      ? ADMIN_IDS.join(", ")
      : "CHƯA CẤU HÌNH"
  );
  console.log(
    "🔥 CUSTOM MODE:",
    customMode ? "ON" : "OFF"
  );
  console.log("");
  console.log(
    "📚 COMMANDS:",
    [
      ...new Set(
        [...COMMANDS.values()].map(
          command => `/${command.name}`
        )
      )
    ].join(", ")
  );
  console.log("==============================================");
}
// ============================================================
// START
// ============================================================
app.listen(
  PORT,
  "0.0.0.0",
  () => {
    log(
      `🚀 Server listening on port ${PORT}`
    );
    startup().catch(error => {
      log(
        "❌ STARTUP ERROR:",
        error.message
      );
    });
  }
);
// ============================================================
// SAFETY
// ============================================================
process.on(
  "unhandledRejection",
  reason => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      reason
    );
  }
);
process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);

Render Environment Variables cần có:

ZALO_BOT_TOKEN=token_bot_của_bạn
GEMINI_API_KEY=key_gemini_của_bạn
ADMIN_IDS=id1,id2

Nếu có URL Render riêng thì thêm:

PUBLIC_URL=https://ten-app-cua-ban.onrender.com

Sau khi deploy:

/help
/hepl
/ping
/id
/ad
/bot
/batquytac
/tatbatquytat
/on
/off
/adminid

Muốn thêm lệnh mới sau này thì chỉ cần thêm một registerCommand(...) mới, không phải sửa cả hệ thống.
