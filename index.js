
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
    .split(/[,;\n]/)
    .map(x => x.trim())
    .filter(Boolean)
);

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
].filter((v, i, a) => a.indexOf(v) === i);

// ============================================================
// STATE
// ============================================================

let botEnabled = true;
let groupChatEnabled = true;
let ruleBreakEnabled = false;
let botInfo = null;
let activeGeminiModel = null;
let offByAdmin = null;

// Mỗi nhóm có trạng thái ADCHAT riêng.
const adminChatOnly = new Map();

// Memory
const memories = new Map();

// Chống xử lý lại cùng một tin nhắn.
const processedMessages = new Set();

// ============================================================
// LOG
// ============================================================

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function mask(value, visible = 4) {
  if (!value) return "NOT_SET";
  if (value.length <= visible) return "*".repeat(value.length);

  return value.slice(0, visible) +
    "*".repeat(Math.max(4, value.length - visible));
}

// ============================================================
// HTTP HELPERS
// ============================================================

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
      ok: response.ok,
      httpStatus: response.status,
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

async function zaloApi(method, body) {
  if (!ZALO_BOT_TOKEN) {
    throw new Error("Thiếu ZALO_BOT_TOKEN.");
  }

  const result = await postJson(
    zaloUrl(method),
    body
  );

  if (!result.ok || result.data?.ok === false) {
    throw new Error(
      `Zalo HTTP ${result.httpStatus}: ` +
      JSON.stringify(result.data)
    );
  }

  return result.data;
}

async function getMe() {
  const data = await zaloApi("getMe");

  botInfo = data?.result || null;

  log("BOT INFO:", JSON.stringify(botInfo));

  return botInfo;
}

// ============================================================
// TEXT HELPERS
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

function splitText(text, maxLength = 1900) {
  if (!text) return [""];

  text = String(text);

  if (text.length <= maxLength) return [text];

  const result = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);

    if (cut < maxLength * 0.5) {
      cut = remaining.lastIndexOf(" ", maxLength);
    }

    if (cut < maxLength * 0.5) cut = maxLength;

    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) result.push(remaining);

  return result;
}

// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage(chatId, text) {
  if (!chatId) throw new Error("Không có chat_id.");

  const chunks = splitText(text || "Không có nội dung.");

  for (const chunk of chunks) {
    await zaloApi("sendMessage", {
      chat_id: String(chatId),
      text: chunk
    });
  }

  return true;
}

async function sendTyping(chatId) {
  try {
    await zaloApi("sendChatAction", {
      chat_id: String(chatId),
      action: "typing"
    });
  } catch (error) {
    log("Typing lỗi:", error.message);
  }
}

// ============================================================
// GEMINI
// ============================================================

const NORMAL_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.

Tên bot: Bot Mặt Đất Màu Xanh.
Người tạo: An Na & Hoàng Vũ.

Trả lời bằng tiếng Việt, tự nhiên, thân thiện.
Câu hỏi đơn giản thì trả lời ngắn gọn.
Không tự bịa người tạo khác.
Khi được hỏi ai tạo bot, trả lời: An Na & Hoàng Vũ.
Không tự nhận mình là Google Gemini.
`;

const RULE_BREAK_PROMPT = `
Bạn là Bot Mặt Đất Màu Xanh.
Người tạo: An Na & Hoàng Vũ.
Trả lời tiếng Việt, tự nhiên và thân thiện.
`;

function geminiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/" +
    "v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY)
  );
}

async function askGemini(userText, userName = "") {
  if (!GEMINI_API_KEY) {
    throw new Error("Thiếu GEMINI_API_KEY.");
  }

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      log("Gemini model:", model);

      const response = await postJson(
        geminiUrl(model),
        {
          systemInstruction: {
            parts: [{
              text: ruleBreakEnabled
                ? RULE_BREAK_PROMPT
                : NORMAL_PROMPT
            }]
          },
          contents: [{
            role: "user",
            parts: [{
              text:
                `Tên người dùng: ${userName || "Người dùng"}\n\n` +
                `Tin nhắn:\n${userText}`
            }]
          }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.8
          }
        },
        60000
      );

      if (!response.ok || response.data?.error) {
        throw new Error(
          response.data?.error?.message ||
          `HTTP ${response.httpStatus}: ` +
          JSON.stringify(response.data)
        );
      }

      const answer = response.data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!answer) {
        throw new Error("Gemini không trả về nội dung.");
      }

      activeGeminiModel = model;
      return answer;

    } catch (error) {
      lastError = error;
      log(`Gemini ${model} lỗi:`, error.message);
    }
  }

  throw new Error(lastError?.message || "Gemini lỗi.");
}

// ============================================================
// MEMORY
// ============================================================

const defaultMemories = [{
  patterns: [
    "ai tao bot mat dat mau xanh",
    "ai lam bot mat dat mau xanh",
    "ai tao bot nay",
    "ai lam bot nay",
    "bot nay cua ai",
    "ai tao bot",
    "ai lam bot",
    "tac gia bot"
  ],
  answer: "An Na & Hoàng Vũ."
}];

function getRememberedAnswer(text) {
  const normalized = normalizeText(text);

  for (const rule of defaultMemories) {
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

  const entries = [...memories.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  for (const [question, data] of entries) {
    if (
      normalized === question ||
      normalized.includes(question)
    ) {
      return typeof data === "string"
        ? data
        : data?.reply || null;
    }
  }

  return null;
}

// ============================================================
// ADMIN
// ============================================================

function isAdmin(userId, chatId) {
  return (
    ADMIN_IDS.has(String(userId || "")) ||
    ADMIN_IDS.has(String(chatId || ""))
  );
}

// ============================================================
// COMMAND SYSTEM
// ============================================================

const COMMANDS = new Map();

function registerCommand(name, config) {
  const command = {
    name: name.toLowerCase(),
    ...config
  };

  COMMANDS.set(command.name, command);

  for (const alias of config.aliases || []) {
    COMMANDS.set(alias.toLowerCase(), command);
  }
}

function parseCommand(text) {
  const value = String(text || "").trim();

  if (!value.startsWith("/")) return null;

  const match = value.match(
    /^\/([^\s]+)(?:\s+([\s\S]*))?$/
  );

  if (!match) return null;

  return {
    command: match[1].split("@")[0].toLowerCase(),
    args: (match[2] || "").trim().split(/\s+/).filter(Boolean),
    text: (match[2] || "").trim()
  };
}

// ============================================================
// HELP
// ============================================================

registerCommand("help", {
  aliases: ["hepl", "h", "menu"],

  handler: async ({ chatId, isAdmin: admin }) => {
    const lines = [
      "🤖 BOT MẶT ĐẤT MÀU XANH",
      "",
      "📚 LỆNH:",
      "/help - Xem hướng dẫn",
      "/ping - Kiểm tra bot",
      "/id - Xem ID",
      "/bot - Thông tin bot",
      "/ad - Kiểm tra Admin",
      "",
      "💬 CHAT NHÓM:",
      "@Bot xin chào",
      "Bot chỉ trả lời khi được nhắc tên.",
      "",
      "🔐 LỆNH ADMIN:",
      "/on - Bật bot",
      "/off - Tắt bot",
      "/batnhom - Bật chat nhóm",
      "/tatnhom - Tắt chat nhóm",
      "/adchat - Chỉ Admin được chat trong nhóm",
      "/batquytac - Bật chế độ đặc biệt",
      "/tatbatquytac - Tắt chế độ đặc biệt",
      "/ghinho câu hỏi - câu trả lời"
    ];

    if (admin) {
      lines.push(
        "",
        "ADCHAT hoạt động riêng cho từng nhóm.",
        "Gõ /adchat lần nữa để tắt."
      );
    }

    await sendMessage(chatId, lines.join("\n"));
  }
});

// ============================================================
// PING
// ============================================================

registerCommand("ping", {
  handler: async ({ chatId }) => {
    await sendMessage(chatId, "🏓 Pong!\n🟢 Bot đang hoạt động.");
  }
});

// ============================================================
// ID
// ============================================================

registerCommand("id", {
  handler: async ({ chatId, userId, chatType }) => {
    await sendMessage(chatId, [
      "🆔 THÔNG TIN ID",
      "",
      `Chat ID: ${chatId}`,
      `User ID: ${userId || "Không có"}`,
      `Chat type: ${chatType || "Không rõ"}`
    ].join("\n"));
  }
});

// ============================================================
// BOT INFO
// ============================================================

registerCommand("bot", {
  handler: async ({ chatId }) => {
    await sendMessage(chatId, [
      "🤖 BOT INFO",
      "",
      `Tên: ${botInfo?.display_name || "Bot Mặt Đất Màu Xanh"}`,
      `Model: ${activeGeminiModel || GEMINI_MODELS[0]}`,
      "Tác giả: An Na & Hoàng Vũ",
      `Bot: ${botEnabled ? "🟢 ON" : "🔴 OFF"}`,
      `Chat nhóm: ${groupChatEnabled ? "🟢 ON" : "🔴 OFF"}`,
      `ADCHAT: ${adminChatOnly.get(String(chatId)) ? "🔒 ON" : "🔓 OFF"}`,
      `Memory: ${memories.size}`
    ].join("\n"));
  }
});

// ============================================================
// ADMIN CHECK
// ============================================================

registerCommand("ad", {
  handler: async ({ chatId, userId, isAdmin: admin }) => {
    await sendMessage(chatId, [
      "👑 ADMIN CHECK",
      "",
      `ID: ${userId || "N/A"}`,
      `Admin: ${admin ? "✅ CÓ" : "❌ KHÔNG"}`,
      `Số Admin: ${ADMIN_IDS.size}`
    ].join("\n"));
  }
});

// ============================================================
// ON / OFF
// ============================================================

registerCommand("on", {
  adminOnly: true,

  handler: async ({ chatId, userId }) => {
    botEnabled = true;
    offByAdmin = null;

    await sendMessage(chatId, `🟢 Đã bật bot.\nAdmin: ${userId}`);
  }
});

registerCommand("off", {
  adminOnly: true,

  handler: async ({ chatId, userId }) => {
    botEnabled = false;
    offByAdmin = String(userId);

    await sendMessage(chatId, [
      "🔴 Đã tắt bot.",
      `Admin: ${userId}`,
      "Chỉ Admin dùng /on mới bật lại."
    ].join("\n"));
  }
});

// ============================================================
// BẬT / TẮT CHAT NHÓM
// ============================================================

registerCommand("tatnhom", {
  adminOnly: true,

  handler: async ({ chatId }) => {
    groupChatEnabled = false;
    await sendMessage(chatId, "🔴 Đã tắt chat nhóm.");
  }
});

registerCommand("batnhom", {
  adminOnly: true,

  handler: async ({ chatId }) => {
    groupChatEnabled = true;
    await sendMessage(chatId, "🟢 Đã bật chat nhóm.");
  }
});

// ============================================================
// ADCHAT - CHỈ ADMIN CHAT TRONG NHÓM
// ============================================================

registerCommand("adchat", {
  adminOnly: true,

  handler: async ({ chatId, isGroup }) => {
    if (!isGroup) {
      await sendMessage(
        chatId,
        "⚠️ Lệnh /adchat chỉ dùng trong nhóm."
      );
      return;
    }

    const id = String(chatId);
    const enabled = !adminChatOnly.get(id);

    adminChatOnly.set(id, enabled);

    await sendMessage(chatId, enabled
      ? [
          "🔒 ĐÃ BẬT ADCHAT",
          "",
          "Chỉ Admin được chat với bot trong nhóm này.",
          "Người không phải Admin sẽ bị bỏ qua.",
          "",
          "Gõ /adchat lần nữa để tắt."
        ].join("\n")
      : [
          "🔓 ĐÃ TẮT ADCHAT",
          "",
          "Mọi người có thể chat với bot trong nhóm này."
        ].join("\n")
    );
  }
});

// ============================================================
// SPECIAL MODE
// ============================================================

registerCommand("batquytac", {
  adminOnly: true,

  handler: async ({ chatId }) => {
    ruleBreakEnabled = true;
    await sendMessage(chatId, "🔥 Đã bật chế độ đặc biệt.");
  }
});

registerCommand("tatbatquytac", {
  adminOnly: true,

  handler: async ({ chatId }) => {
    ruleBreakEnabled = false;
    await sendMessage(chatId, "🟢 Đã tắt chế độ đặc biệt.");
  }
});

// ============================================================
// GHINHO
// ============================================================

registerCommand("ghinho", {
  adminOnly: true,

  handler: async ({ chatId, text }) => {
    if (!text.trim()) {
      await sendMessage(chatId, [
        "🧠 CÁCH DÙNG:",
        "",
        "/ghinho câu hỏi - câu trả lời",
        "",
        "Hoặc nhiều dòng:",
        "/ghinho thông tin về Hoàng Vũ",
        "Dòng trả lời 1",
        "Dòng trả lời 2"
      ].join("\n"));
      return;
    }

    const raw = text.replace(/\r\n?/g, "\n").trim();

    let question = "";
    let answer = "";

    const dashMatch = raw.match(
      /^([\s\S]*?)\s+-\s+([\s\S]+)$/
    );

    if (dashMatch) {
      question = dashMatch[1].trim();
      answer = dashMatch[2].trim();
    } else {
      const lines = raw.split("\n").map(x => x.trim());

      if (lines.length < 2) {
        await sendMessage(chatId, [
          "❌ Thiếu câu trả lời.",
          "Dùng /ghinho câu hỏi - câu trả lời",
          "Hoặc nhập câu hỏi ở dòng đầu và câu trả lời ở dòng sau."
        ].join("\n"));
        return;
      }

      question = lines[0];
      answer = lines.slice(1).join("\n").trim();
    }

    if (!question || !answer) {
      await sendMessage(chatId, "❌ Câu hỏi hoặc câu trả lời bị trống.");
      return;
    }

    if (question.length > 500 || answer.length > 10000) {
      await sendMessage(chatId, "❌ Nội dung quá dài.");
      return;
    }

    const key = normalizeText(question);

    memories.set(key, {
      question,
      reply: answer
    });

    log("MEMORY SAVED:", question);

    await sendMessage(chatId, [
      "✅ ĐÃ GHI NHỚ!",
      "",
      `🧠 ${question}`,
      "",
      "🤖 Nội dung:",
      answer
    ].join("\n"));
  }
});

// ============================================================
// WEBHOOK NORMALIZATION
// ============================================================

function normalizeWebhook(body) {
  if (!body || typeof body !== "object") return null;

  const data =
    body.result && typeof body.result === "object"
      ? body.result
      : body;

  const message = data.message || data;

  const chatId = message?.chat?.id;
  const userId = message?.from?.id;

  if (chatId == null) return null;

  return {
    eventName: data.event_name || "",
    message,
    chatId: String(chatId),
    chatType: message?.chat?.chat_type || "",
    userId: userId == null ? "" : String(userId),
    userName:
      message?.from?.display_name ||
      message?.from?.name ||
      "",
    text: typeof message?.text === "string"
      ? message.text.trim()
      : "",
    messageId: message?.message_id == null
      ? ""
      : String(message.message_id)
  };
}

// ============================================================
// BOT MENTION
// ============================================================

function isBotMention(text) {
  const value = String(text || "").trim();

  if (!value.startsWith("@")) return false;

  const normalized = normalizeText(value);

  const botName = normalizeText(
    botInfo?.display_name ||
    botInfo?.account_name ||
    ""
  );

  const aliases = ["bot mat dat mau xanh"];

  if (botName && normalized.startsWith("@" + botName)) {
    return true;
  }

  if (aliases.some(alias => normalized.startsWith("@" + alias))) {
    return true;
  }

  return /^@\s*bot\b/i.test(value);
}

function removeBotMention(text) {
  let value = String(text || "").trim();

  if (!value) return "";

  const botName = normalizeText(
    botInfo?.display_name ||
    botInfo?.account_name ||
    ""
  );

  const normalized = normalizeText(value);

  if (botName && normalized.startsWith("@" + botName)) {
    const nameRegex = /^@\s*[\wÀ-ỹ]+(?:\s+[\wÀ-ỹ]+)*/u;
    const match = value.match(nameRegex);

    if (match) {
      return value.slice(match[0].length).trim();
    }
  }

  const fixedRegex =
    /^@\s*bot\s+mat\s+dat\s+mau\s+xanh\b/i;

  if (fixedRegex.test(value)) {
    return value.replace(fixedRegex, "").trim();
  }

  if (/^@\s*bot\b/i.test(value)) {
    return value.replace(/^@\s*bot\b/i, "").trim();
  }

  return value;
}

// ============================================================
// HANDLE COMMAND
// ============================================================

async function handleCommand(update, parsed) {
  const command = COMMANDS.get(parsed.command);

  if (!command) {
    await sendMessage(
      update.chatId,
      `❓ Không có lệnh /${parsed.command}\nDùng /help để xem lệnh.`
    );
    return;
  }

  const admin = isAdmin(update.userId, update.chatId);

  if (command.adminOnly && !admin) {
    await sendMessage(
      update.chatId,
      "⛔ Lệnh này chỉ dành cho Admin."
    );
    return;
  }

  await command.handler({
    ...update,
    ...parsed,
    isAdmin: admin
  });
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
    chatType,
    messageId
  } = update;

  if (!chatId || !text) return;

  const type = String(chatType || "").toUpperCase();

  const isGroup =
    type === "GROUP" ||
    type === "GROUP_CHAT" ||
    type.includes("GROUP");

  const dedupeKey = messageId
    ? `${chatId}:${messageId}`
    : "";

  if (dedupeKey && processedMessages.has(dedupeKey)) {
    return;
  }

  if (dedupeKey) {
    processedMessages.add(dedupeKey);

    if (processedMessages.size > 5000) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }
  }

  log("MESSAGE:", {
    userName,
    userId,
    chatId,
    chatType: type,
    text
  });

  let messageText = text;

  // Commands được xử lý trực tiếp trong nhóm,
  // vì vậy Admin có thể gõ /adchat mà không cần @Bot.
  const directCommand = parseCommand(text);

  if (isGroup && directCommand) {
    await handleCommand(
      { ...update, isGroup },
      directCommand
    );
    return;
  }

  // Chặn chat AI khi bot tắt.
  // Lệnh /on vẫn được xử lý ở phía trên.
  if (!botEnabled) {
    log("BOT OFF -> IGNORE");
    return;
  }

  if (isGroup) {
    if (!groupChatEnabled) {
      log("GROUP CHAT OFF -> IGNORE");
      return;
    }

    // Chế độ ADCHAT: chỉ Admin mới được chat.
    if (
      adminChatOnly.get(String(chatId)) &&
      !isAdmin(userId, "")
    ) {
      log("ADCHAT ON -> NON-ADMIN IGNORED");
      return;
    }

    // Bình thường, nhóm phải nhắc bot.
    if (!isBotMention(text)) {
      return;
    }

    messageText = removeBotMention(text);
  }

  if (!messageText.trim()) {
    await sendMessage(chatId, "👋 Có mình đây! Anh/chị muốn hỏi gì?");
    return;
  }

  // Xử lý lệnh sau khi bỏ @Bot.
  const parsed = parseCommand(messageText);

  if (parsed) {
    await handleCommand(
      { ...update, isGroup },
      parsed
    );
    return;
  }

  const remembered = getRememberedAnswer(messageText);

  if (remembered) {
    await sendMessage(chatId, remembered);
    return;
  }

  await sendTyping(chatId);

  try {
    const answer = await askGemini(messageText, userName);
    await sendMessage(chatId, answer);
  } catch (error) {
    log("GEMINI ERROR:", error.message);

    try {
      await sendMessage(
        chatId,
        "⚠️ Bot đang gặp lỗi khi trả lời AI. Anh/chị thử lại sau nhé."
      );
    } catch (sendError) {
      log("SEND ERROR:", sendError.message);
    }
  }
}

// ============================================================
// WEBHOOK
// ============================================================

app.get("/", (req, res) => {
  res.status(200).send("Bot Mặt Đất Màu Xanh đang chạy.");
});

app.post("/webhook", (req, res) => {
  // Trả ACK nhanh, xử lý tin nhắn ở nền.
  res.status(200).json({ ok: true });

  const update = normalizeWebhook(req.body);

  if (!update) {
    log("Webhook không có message hợp lệ.");
    return;
  }

  handleMessage(update).catch(error => {
    log("HANDLE MESSAGE ERROR:", error.message);
  });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, async () => {
  log("==========================================");
  log("BOT MẶT ĐẤT MÀU XANH");
  log("PORT:", PORT);
  log("ZALO TOKEN:", mask(ZALO_BOT_TOKEN));
  log("GEMINI KEY:", mask(GEMINI_API_KEY));
  log("ADMIN COUNT:", ADMIN_IDS.size);
  log("==========================================");

  if (!ZALO_BOT_TOKEN) {
    log("⚠️ Chưa cấu hình ZALO_BOT_TOKEN.");
    return;
  }

  try {
    await getMe();
  } catch (error) {
    log("getMe lỗi:", error.message);
  }

  if (PUBLIC_URL) {
    log("PUBLIC_URL:", PUBLIC_URL);
    log("Đảm bảo webhook Zalo đã được cấu hình tới:");
    log(`${PUBLIC_URL}/webhook`);
  } else {
    log("⚠️ Chưa cấu hình PUBLIC_URL.");
  }
});

ể
