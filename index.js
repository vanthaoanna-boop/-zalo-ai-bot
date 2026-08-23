/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * Zalo Bot Platform + Google Gemini
 *
 * ENV cần có:
 * ZALO_BOT_TOKEN
 * GEMINI_API_KEY
 * ADMIN_ID=ID1,ID2
 *
 * Có thể thêm:
 * PUBLIC_URL
 * GEMINI_MODEL
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
  GEMINI_KEY ||
  ""
).trim();
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");
const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";
const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-2.0-flash";
// ============================================================
// ADMIN
// ============================================================
//
// Render:
// ADMIN_ID=123456,987654
//
// Có thể thêm 1 hoặc 2 admin.
// ============================================================
const ADMIN_IDS = (
  process.env.ADMIN_ID ||
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
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
// GLOBAL BOT STATE
// ============================================================
//
// Đây là trạng thái dùng CHUNG cho toàn bot.
//
// /off từ admin 1
// -> toàn bot OFF.
//
// Admin 2 /off tiếp
// -> báo admin 1 đã dùng.
//
// /on
// -> bật lại toàn bot.
//
// ============================================================
let botEnabled = true;
let lastOffBy = null;
let lastOnBy = null;
let noRulesMode = false;
let noRulesBy = null;
let rulesRestoredBy = null;
let botInfo = null;
let activeGeminiModel = GEMINI_MODEL;
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
      Math.max(
        4,
        value.length - visible
      )
    )
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
  console.log(`PORT: ${PORT}`);
  console.log(
    `PUBLIC URL: ${
      PUBLIC_URL || "NOT_SET"
    }`
  );
  console.log(
    `ZALO TOKEN: ${mask(
      ZALO_BOT_TOKEN
    )}`
  );
  console.log(
    `GEMINI KEY: ${mask(
      GEMINI_API_KEY
    )}`
  );
  console.log(
    `GEMINI MODEL: ${GEMINI_MODEL}`
  );
  console.log(
    `ADMIN COUNT: ${ADMIN_IDS.length}`
  );
  console.log(
    `ADMIN IDS: ${
      ADMIN_IDS.length
        ? ADMIN_IDS.join(", ")
        : "CHƯA CẤU HÌNH"
    }`
  );
  console.log(
    `WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );
  console.log("==============================================");
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
      "⚠️ CHƯA CÓ ADMIN_ID"
    );
  }
}
// ============================================================
// GENERIC POST JSON
// ============================================================
async function postJson(
  url,
  body,
  timeoutMs = 30000
) {
  const controller =
    new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );
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
      ok: response.ok,
      status: response.status,
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
      "ZALO_BOT_TOKEN chưa cấu hình."
    );
  }
  const result =
    await postJson(
      zaloUrl(method),
      body
    );
  if (!result.ok) {
    throw new Error(
      `Zalo HTTP ${result.status}: ` +
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
  log(
    "📡 ZALO getMe:",
    JSON.stringify(data)
  );
  if (data?.ok) {
    botInfo =
      data.result || null;
    return botInfo;
  }
  throw new Error(
    "Không lấy được thông tin bot."
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
      "Thiếu chat_id."
    );
  }
  const chunks =
    splitText(
      String(text || ""),
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
        "sendMessage thất bại: " +
        JSON.stringify(data)
      );
    }
  }
}
// ============================================================
// SPLIT MESSAGE
// ============================================================
function splitText(
  text,
  maxLength = 1900
) {
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
      "⚠️ typing:",
      error.message
    );
  }
}
// ============================================================
// GEMINI
// ============================================================
function geminiUrl() {
  return (
    "https://generativelanguage.googleapis.com/" +
    "v1beta/models/" +
    encodeURIComponent(
      activeGeminiModel
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
function getSystemPrompt() {
  let prompt = `
Bạn là Bot Mặt Đất Màu Xanh.
Bạn đang hoạt động trên Zalo.
Trả lời bằng tiếng Việt.
Nói chuyện tự nhiên, thân thiện.
Không tự nhận mình là Google Gemini.
Tên bot:
Bot Mặt Đất Màu Xanh.
Người tạo bot:
An Na & Hoàng Vũ.
Nếu người dùng hỏi:
- Ai tạo bot?
- Ai làm bot?
- Bot này của ai?
- Ai tạo ra Bot Mặt Đất Màu Xanh?
- Ai đứng sau bot?
thì trả lời:
An Na & Hoàng Vũ.
Không được tự bịa người tạo khác.
`;
  if (noRulesMode) {
    prompt += `
BOT ĐANG Ở CHẾ ĐỘ /batquytac.
Trong chế độ này:
- Không áp dụng các quy tắc hội thoại riêng do bot tự đặt ra.
- Trả lời trực tiếp theo yêu cầu người dùng trong phạm vi chính sách an toàn của hệ thống.
- Không được tuyên bố rằng chế độ này có thể vượt qua giới hạn an toàn của AI.
`;
  } else {
    prompt += `
Bot hoạt động ở chế độ bình thường.
`;
  }
  return prompt;
}
// ============================================================
// ASK GEMINI
// ============================================================
async function askGemini(
  userText,
  userName = ""
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY chưa cấu hình."
    );
  }
  const result =
    await postJson(
      geminiUrl(),
      {
        systemInstruction: {
          parts: [
            {
              text:
                getSystemPrompt(),
            },
          ],
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
                  `Tin nhắn:\n${userText}`,
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
  if (!result.ok) {
    throw new Error(
      `Gemini HTTP ${result.status}: ` +
      JSON.stringify(
        result.data
      )
    );
  }
  const data =
    result.data;
  if (data?.error) {
    throw new Error(
      data.error.message ||
      JSON.stringify(
        data.error
      )
    );
  }
  const answer =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(
        (part) =>
          part.text || ""
      )
      .join("")
      .trim();
  if (!answer) {
    throw new Error(
      "Gemini không trả về nội dung."
    );
  }
  return answer;
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
      data.eventName ||
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
  };
}
// ============================================================
// ADMIN CHECK
// ============================================================
function isAdmin(
  userId,
  chatId
) {
  const uid =
    String(userId || "");
  const cid =
    String(chatId || "");
  return (
    ADMIN_IDS.includes(uid) ||
    ADMIN_IDS.includes(cid)
  );
}
// ============================================================
// GET ADMIN NAME
// ============================================================
function adminLabel(
  userId
) {
  const index =
    ADMIN_IDS.indexOf(
      String(userId)
    );
  if (index === 0) {
    return "Admin 1";
  }
  if (index === 1) {
    return "Admin 2";
  }
  return "Admin";
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
  for (
    const alias of
      config.aliases || []
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
// ============================================================
// /help + /hepl
// ============================================================
registerCommand(
  "help",
  {
    aliases: ["hepl", "h"],
    description:
      "Xem tất cả lệnh",
    adminOnly: false,
    async handler({
      chatId,
    }) {
      const unique =
        new Map();
      for (
        const command
          of COMMANDS.values()
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
        const command
          of unique.values()
      ) {
        lines.push(
          `/${command.name} — ${
            command.description ||
            ""
          }`
        );
      }
      lines.push("");
      lines.push(
        "💬 Nhắn tin bình thường để bot trả lời AI."
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
      "Xem User ID và Chat ID",
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
// /ad
// ============================================================
registerCommand(
  "ad",
  {
    description:
      "Kiểm tra admin",
    adminOnly: false,
    async handler({
      chatId,
      userId,
    }) {
      const admin =
        isAdmin(
          userId,
          chatId
        );
      if (!admin) {
        await sendMessage(
          chatId,
          [
            "⛔ BẠN KHÔNG PHẢI ADMIN.",
            "",
            `User ID: ${userId}`,
          ].join("\n")
        );
        return;
      }
      const index =
        ADMIN_IDS.indexOf(
          String(userId)
        );
      await sendMessage(
        chatId,
        [
          "👑 ADMIN CHECK",
          "",
          "✅ Bạn là admin.",
          `Vai trò: ${
            index >= 0
              ? `Admin ${
                  index + 1
                }`
              : "Admin"
          }`,
          `ID: ${userId}`,
          "",
          `Số admin: ${
            ADMIN_IDS.length
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
    adminOnly: false,
    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "🤖 BOT INFO",
          "",
          "Tên: Bot Mặt Đất Màu Xanh",
          "AI: Google Gemini",
          `Model: ${activeGeminiModel}`,
          "Tác giả: An Na & Hoàng Vũ",
          `Bot: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ: ${
            noRulesMode
              ? "⚡ /batquytac"
              : "🟢 Bình thường"
          }`,
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
      "Bật bot cho toàn bộ mọi nơi",
    adminOnly: true,
    async handler({
      chatId,
      userId,
    }) {
      if (botEnabled) {
        await sendMessage(
          chatId,
          [
            "🟢 BOT ĐANG BẬT.",
            "",
            lastOnBy
              ? `Bot đã được bật bởi ${lastOnBy}.`
              : "Bot đang ở trạng thái ON.",
          ].join("\n")
        );
        return;
      }
      botEnabled = true;
      lastOnBy =
        adminLabel(
          userId
        );
      lastOffBy = null;
      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT BOT.",
          "",
          `Thực hiện bởi: ${lastOnBy}`,
          "Bot đã hoạt động trở lại cho toàn bộ chat.",
        ].join("\n")
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
      "Tắt bot cho toàn bộ mọi nơi",
    adminOnly: true,
    async handler({
      chatId,
      userId,
    }) {
      if (!botEnabled) {
        await sendMessage(
          chatId,
          [
            "🔴 BOT ĐÃ TẮT.",
            "",
            lastOffBy
              ? `Lệnh /off đã được ${lastOffBy} sử dụng.`
              : "Bot đang OFF.",
            "",
            "Chờ một admin dùng /on để bật lại.",
          ].join("\n")
        );
        return;
      }
      botEnabled = false;
      lastOffBy =
        adminLabel(
          userId
        );
      lastOnBy = null;
      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT BOT.",
          "",
          `Thực hiện bởi: ${lastOffBy}`,
          "Bot sẽ không trả lời tin nhắn AI ở tất cả chat.",
          "",
          "Dùng /on để bật lại.",
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
      "Bật chế độ bỏ qua quy tắc riêng của bot",
    adminOnly: true,
    async handler({
      chatId,
      userId,
    }) {
      if (noRulesMode) {
        await sendMessage(
          chatId,
          [
            "⚡ CHẾ ĐỘ ĐÃ BẬT.",
            "",
            `Được bật bởi: ${
              noRulesBy ||
              "Admin"
            }`,
            "",
            "Chế độ này không thể vượt qua giới hạn an toàn của hệ thống.",
          ].join("\n")
        );
        return;
      }
      noRulesMode = true;
      noRulesBy =
        adminLabel(
          userId
        );
      rulesRestoredBy =
        null;
      await sendMessage(
        chatId,
        [
          "⚡ ĐÃ BẬT /batquytac.",
          "",
          `Thực hiện bởi: ${noRulesBy}`,
          "",
          "Bot sẽ bỏ qua các quy tắc hội thoại riêng do bot tự đặt ra.",
          "Giới hạn an toàn của hệ thống vẫn được áp dụng.",
        ].join("\n")
      );
    },
  }
);
// ============================================================
// /tatbatquytat
// ============================================================
registerCommand(
  "tatbatquytat",
  {
    description:
      "Tắt chế độ /batquytac",
    adminOnly: true,
    async handler({
      chatId,
      userId,
    }) {
      if (!noRulesMode) {
        await sendMessage(
          chatId,
          "🟢 /batquytac hiện đang TẮT."
        );
        return;
      }
      noRulesMode =
        false;
      rulesRestoredBy =
        adminLabel(
          userId
        );
      noRulesBy = null;
      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ TẮT /batquytac.",
          "",
          `Thực hiện bởi: ${rulesRestoredBy}`,
          "Bot trở lại chế độ bình thường.",
        ].join("\n")
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
      "Xem danh sách ID admin",
    adminOnly: true,
    async handler({
      chatId,
    }) {
      const lines = [
        "👑 DANH SÁCH ADMIN",
        "",
      ];
      if (!ADMIN_IDS.length) {
        lines.push(
          "❌ Chưa cấu hình ADMIN_ID."
        );
      } else {
        ADMIN_IDS.forEach(
          (id, index) => {
            lines.push(
              `Admin ${
                index + 1
              }: ${id}`
            );
          }
        );
      }
      await sendMessage(
        chatId,
        lines.join("\n")
      );
    },
  }
);
// ============================================================
// MEMORY
// ============================================================
const MEMORY_PATTERNS = [
  "ai tao bot mat dat mau xanh",
  "ai tao ra bot mat dat mau xanh",
  "ai lam bot mat dat mau xanh",
  "ai tao bot nay",
  "ai lam bot nay",
  "bot nay cua ai",
  "bot cua ai",
  "ai tao bot",
  "ai lam bot",
  "cha de bot",
  "ai dung sau bot",
  "tac gia bot",
];
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
function rememberedAnswer(
  text
) {
  const normalized =
    normalizeText(text);
  for (
    const pattern
      of MEMORY_PATTERNS
  ) {
    if (
      normalized ===
        pattern ||
      normalized.includes(
        pattern
      )
    ) {
      return (
        "An Na & Hoàng Vũ."
      );
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
  if (!command) {
    return null;
  }
  return {
    command,
    args:
      parts.slice(1),
    text:
      parts
        .slice(1)
        .join(" "),
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
        `ID của bạn: ${
          update.userId ||
          update.chatId
        }`,
        "",
        "Dùng /ad để kiểm tra quyền admin.",
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
    `👤 ${userName || "Unknown"}`
  );
  log(
    `🆔 USER: ${
      userId || "Unknown"
    }`
  );
  log(
    `💬 CHAT: ${chatId}`
  );
  log(
    `📝 ${text}`
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
      } catch (error) {
        log(
          "❌ COMMAND ERROR:",
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
        "Dùng /help hoặc /hepl để xem tất cả lệnh.",
      ].join("\n")
    );
    return;
  }
  // ----------------------------------------------------------
  // BOT OFF
  // ----------------------------------------------------------
  if (!botEnabled) {
    log(
      "🔴 BOT OFF -> bỏ qua."
    );
    return;
  }
  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------
  const memory =
    rememberedAnswer(
      text
    );
  if (memory) {
    await sendMessage(
      chatId,
      memory
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
    await sendMessage(
      chatId,
      answer
    );
    log(
      "✅ ĐÃ TRẢ LỜI"
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
          "😵 AI đang lỗi.",
          "",
          "Kiểm tra GEMINI_API_KEY hoặc thử lại sau.",
        ].join("\n")
      );
    } catch {}
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
    res.json({
      ok: true,
    });
    if (!update) {
      return;
    }
    log(
      "📩 WEBHOOK:",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );
    if (
      update.eventName ===
      "message.text.received"
    ) {
      handleMessage(
        update
      ).catch(
        (error) => {
          log(
            "❌ HANDLE ERROR:",
            error.message
          );
        }
      );
      return;
    }
    // Một số payload có thể thiếu event_name.
    // Nếu có text + chat_id thì vẫn xử lý.
    if (
      !update.eventName &&
      update.text &&
      update.chatId
    ) {
      handleMessage(
        update
      ).catch(
        (error) => {
          log(
            "❌ HANDLE ERROR:",
            error.message
          );
        }
      );
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
      status:
        botEnabled
          ? "ON"
          : "OFF",
      noRulesMode,
      zalo:
        Boolean(
          ZALO_BOT_TOKEN
        ),
      gemini:
        Boolean(
          GEMINI_API_KEY
        ),
      model:
        activeGeminiModel,
      admins:
        ADMIN_IDS.length,
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
      server:
        "online",
      botEnabled,
      noRulesMode,
      admins:
        ADMIN_IDS.length,
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
        url:
          webhookUrl,
        secret_token:
          WEBHOOK_SECRET,
      }
    );
  log(
    "📡 SET WEBHOOK RESPONSE:",
    JSON.stringify(
      data
    )
  );
  if (!data?.ok) {
    throw new Error(
      "Set webhook thất bại."
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
  } catch (error) {
    log(
      "⚠️ WEBHOOK INFO:",
      error.message
    );
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
      log(
        "✅ ZALO BOT OK"
      );
    } catch (error) {
      log(
        "❌ ZALO ERROR:",
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
    } catch (error) {
      log(
        "❌ WEBHOOK ERROR:",
        error.message
      );
    }
  }
  // ----------------------------------------------------------
  // FINAL
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
    `Bot: ${
      botEnabled
        ? "🟢 ON"
        : "🔴 OFF"
    }`
  );
  console.log(
    `Gemini: ${
      GEMINI_API_KEY
        ? "🟢 OK"
        : "🔴 THIẾU KEY"
    }`
  );
  console.log(
    `Zalo: ${
      ZALO_BOT_TOKEN
        ? "🟢 OK"
        : "🔴 THIẾU TOKEN"
    }`
  );
  console.log(
    `Admin: ${
      ADMIN_IDS.length
    }`
  );
  console.log(
    `Chế độ: ${
      noRulesMode
        ? "⚡ BATQUYTAC"
        : "🟢 Bình thường"
    }`
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
