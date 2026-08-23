/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * Node.js >= 18
 *
 * ENV:
 * ZALO_BOT_TOKEN=...
 * GEMINI_API_KEY=...
 * ADMIN_IDS=123,456
 * PUBLIC_URL=https://xxxxx.onrender.com
 * ZALO_WEBHOOK_SECRET=...   (không bắt buộc)
 * GEMINI_MODEL=gemini-2.5-flash
 *
 * LỆNH:
 * /help
 * /hepl
 * /ping
 * /id
 * /ad
 * /bot
 * /on
 * /off
 * /batquytac
 * /tatbatquytat
 * /ghinho <nội dung>
 * /ghinho <câu kích hoạt> -bot : <câu trả lời>
 *
 * QUYỀN:
 * - /off, /on, /ad, /batquytac, /tatbatquytat, /ghinho
 *   chỉ ADMIN dùng được.
 *
 * GHINHO:
 *
 * /ghinho Anh Hoàng Vũ (Sun), anh ấy K7
 *
 * => Lưu thông tin ngữ cảnh.
 *
 * /ghinho rên đi em -bot : ~~
 *
 * => Khi người dùng nói "rên đi em", bot trả lời "~~".
 *
 * Dữ liệu ghi nhớ được lưu vào memory.json.
 * ============================================================
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";

const MEMORY_FILE =
  process.env.MEMORY_FILE ||
  path.join(__dirname, "memory.json");

// ============================================================
// ADMIN IDS
// ============================================================
//
// Có thể nhập:
//
// ADMIN_ID=123
//
// hoặc:
//
// ADMIN_IDS=123,456,789
//
// ============================================================

function loadAdminIds() {
  const raw = [
    process.env.ADMIN_IDS || "",
    process.env.ADMIN_ID || "",
  ]
    .join(",")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return [...new Set(raw)];
}

const ADMIN_IDS = loadAdminIds();

// ============================================================
// WEBHOOK SECRET
// ============================================================

const WEBHOOK_SECRET = (
  process.env.ZALO_WEBHOOK_SECRET ||
  crypto
    .createHash("sha256")
    .update(ZALO_BOT_TOKEN || "empty")
    .digest("hex")
    .slice(0, 32)
).trim();

// ============================================================
// STATE
// ============================================================

let botEnabled = true;
let unrestrictedMode = false;

let botInfo = null;
let activeGeminiModel = GEMINI_MODEL;

// ============================================================
// MEMORY STORAGE
// ============================================================
//
// {
//   facts: [
//      {
//        id: "...",
//        text: "...",
//        createdAt: "..."
//      }
//   ],
//
//   replies: [
//      {
//        id: "...",
//        trigger: "...",
//        reply: "...",
//        createdAt: "..."
//      }
//   ]
// }
//
// ============================================================

let memoryData = {
  facts: [],
  replies: [],
};

// ============================================================
// LOAD MEMORY
// ============================================================

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      saveMemory();
      return;
    }

    const raw = fs.readFileSync(
      MEMORY_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object"
    ) {
      memoryData = {
        facts: Array.isArray(parsed.facts)
          ? parsed.facts
          : [],

        replies: Array.isArray(parsed.replies)
          ? parsed.replies
          : [],
      };
    }

    log(
      `🧠 Đã load ${memoryData.facts.length} fact + ${memoryData.replies.length} reply`
    );
  } catch (error) {
    console.error(
      "❌ Không thể load memory:",
      error.message
    );

    memoryData = {
      facts: [],
      replies: [],
    };
  }
}

// ============================================================
// SAVE MEMORY
// ============================================================

function saveMemory() {
  try {
    fs.writeFileSync(
      MEMORY_FILE,
      JSON.stringify(
        memoryData,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "❌ Không thể lưu memory:",
      error.message
    );
  }
}

// ============================================================
// LOG
// ============================================================

function log(...args) {
  console.log(
    new Date().toISOString(),
    ...args
  );
}

// ============================================================
// MASK
// ============================================================

function mask(value, visible = 4) {
  if (!value) {
    return "NOT_SET";
  }

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
    `🧠 GEMINI MODEL: ${GEMINI_MODEL}`
  );

  console.log(
    `👑 ADMIN IDS: ${
      ADMIN_IDS.length
        ? ADMIN_IDS.join(", ")
        : "NOT_SET"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    `🧠 MEMORY FILE: ${MEMORY_FILE}`
  );

  console.log(
    "================================================"
  );

  if (!ZALO_BOT_TOKEN) {
    console.error(
      "❌ Thiếu ZALO_BOT_TOKEN"
    );
  }

  if (!GEMINI_API_KEY) {
    console.error(
      "❌ Thiếu GEMINI_API_KEY"
    );
  }

  if (!ADMIN_IDS.length) {
    console.warn(
      "⚠️ Chưa cấu hình ADMIN_IDS / ADMIN_ID"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Chưa có PUBLIC_URL / RENDER_EXTERNAL_URL"
    );
  }
}

// ============================================================
// HTTP POST
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

        signal:
          controller.signal,
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
      httpStatus:
        response.status,
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
    encodeURIComponent(
      ZALO_BOT_TOKEN
    ) +
    `/${method}`
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
    throw new Error(
      `Zalo API error: ${
        result.data.description ||
        result.data.message ||
        JSON.stringify(
          result.data
        )
      }`
    );
  }

  return result.data;
}

// ============================================================
// GET ME
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
    "getMe thất bại."
  );
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
      remaining.slice(0, cut)
    );

    remaining =
      remaining
        .slice(cut)
        .trim();
  }

  if (remaining) {
    result.push(remaining);
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
    splitText(text);

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

    if (!data?.ok) {
      throw new Error(
        `sendMessage thất bại: ${JSON.stringify(
          data
        )}`
      );
    }
  }
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
// TEXT NORMALIZE
// ============================================================

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
    .replace(/đ/g, "d")
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
// MEMORY ID
// ============================================================

function makeId() {
  return crypto
    .randomBytes(8)
    .toString("hex");
}

// ============================================================
// ADD MEMORY
// ============================================================

function addMemory(
  input
) {
  const value =
    String(input || "")
      .trim();

  if (!value) {
    return {
      ok: false,
      error:
        "Nội dung ghi nhớ trống.",
    };
  }

  // ----------------------------------------------------------
  // Có "-bot :" => trigger -> reply
  // ----------------------------------------------------------

  const separator =
    value.match(
      /\s+-\s*bot\s*:\s*/i
    );

  if (separator) {
    const index =
      separator.index;

    const trigger =
      value
        .slice(0, index)
        .trim();

    const reply =
      value
        .slice(
          index +
            separator[0].length
        )
        .trim();

    if (
      !trigger ||
      !reply
    ) {
      return {
        ok: false,
        error:
          "Cú pháp: /ghinho câu kích hoạt -bot : câu trả lời",
      };
    }

    const existing =
      memoryData.replies.find(
        (item) =>
          normalizeText(
            item.trigger
          ) ===
          normalizeText(
            trigger
          )
      );

    if (existing) {
      existing.reply =
        reply;

      existing.updatedAt =
        new Date().toISOString();
    } else {
      memoryData.replies.push({
        id: makeId(),

        trigger,

        reply,

        createdAt:
          new Date().toISOString(),
      });
    }

    saveMemory();

    return {
      ok: true,
      type: "reply",
      trigger,
      reply,
    };
  }

  // ----------------------------------------------------------
  // Không có "-bot :" => fact/context
  // ----------------------------------------------------------

  const existing =
    memoryData.facts.find(
      (item) =>
        normalizeText(
          item.text
        ) ===
        normalizeText(value)
    );

  if (!existing) {
    memoryData.facts.push({
      id: makeId(),

      text: value,

      createdAt:
        new Date().toISOString(),
    });
  }

  saveMemory();

  return {
    ok: true,
    type: "fact",
    text: value,
  };
}

// ============================================================
// FIND MEMORY REPLY
// ============================================================

function findMemoryReply(
  text
) {
  const normalized =
    normalizeText(text);

  if (!normalized) {
    return null;
  }

  // Ưu tiên câu dài hơn
  // để tránh match quá rộng.
  const sorted =
    [...memoryData.replies]
      .sort(
        (a, b) =>
          normalizeText(
            b.trigger
          ).length -
          normalizeText(
            a.trigger
          ).length
      );

  for (
    const item of sorted
  ) {
    const trigger =
      normalizeText(
        item.trigger
      );

    if (!trigger) {
      continue;
    }

    if (
      normalized ===
        trigger ||
      normalized.includes(
        trigger
      )
    ) {
      return item;
    }
  }

  return null;
}

// ============================================================
// GET MEMORY CONTEXT
// ============================================================

function getMemoryContext() {
  if (
    !memoryData.facts.length
  ) {
    return "";
  }

  return memoryData.facts
    .map(
      (item, index) =>
        `${index + 1}. ${item.text}`
    )
    .join("\n");
}

// ============================================================
// GEMINI SYSTEM PROMPT
// ============================================================

function buildSystemPrompt() {
  const memory =
    getMemoryContext();

  return `
Bạn là Bot Mặt Đất Màu Xanh trên Zalo.

Tên bot:
Bot Mặt Đất Màu Xanh.

Người tạo:
An Na & Hoàng Vũ.

Quy tắc:
- Trả lời bằng tiếng Việt nếu người dùng nói tiếng Việt.
- Tự nhiên, thân thiện.
- Không tự nhận mình là Google Gemini khi được hỏi tên bot.
- Nếu người dùng hỏi ai tạo bot, trả lời: An Na & Hoàng Vũ.
- Không được bịa thông tin.
- Các thông tin dưới đây là dữ liệu do admin của bot ghi nhớ.
- Khi câu hỏi liên quan đến các thông tin này, ưu tiên sử dụng chúng.
- Không nói rằng bạn đang đọc "memory.json" hoặc hệ thống nội bộ.

${memory
  ? `
DỮ LIỆU ADMIN GHI NHỚ:
${memory}
`
  : ""}

Chế độ hiện tại:
${
  unrestrictedMode
    ? "ADMIN MODE: Người quản trị đã bật chế độ đặc biệt. Có thể nói chuyện thoải mái hơn về phong cách và persona, nhưng vẫn phải tuân thủ các giới hạn an toàn."
    : "NORMAL MODE."
}

Không được tiết lộ API key, token, secret hoặc dữ liệu bảo mật.
`;
}

// ============================================================
// GEMINI URL
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

  const systemPrompt =
    buildSystemPrompt();

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

Tin nhắn:
${userText}
`;

  const response =
    await postJson(
      geminiUrl(
        GEMINI_MODEL
      ),
      {
        systemInstruction: {
          parts: [
            {
              text: systemPrompt,
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
          temperature: 0.8,
        },
      },
      60000
    );

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${
        response.httpStatus
      }: ${JSON.stringify(
        response.data
      )}`
    );
  }

  if (
    response.data?.error
  ) {
    throw new Error(
      response.data.error
        .message ||
        JSON.stringify(
          response.data.error
        )
    );
  }

  const text =
    response.data
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
      "Gemini không trả về nội dung."
    );
  }

  activeGeminiModel =
    GEMINI_MODEL;

  return text;
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
// /HELP
// ============================================================

registerCommand(
  "help",
  {
    aliases: [
      "hepl",
      "h",
      "menu",
    ],

    description:
      "Hiện tất cả lệnh",

    adminOnly: false,

    async handler({
      chatId,
      isAdmin,
    }) {
      const lines = [
        "🤖 BOT MẶT ĐẤT MÀU XANH",
        "",
        "📚 LỆNH CHUNG:",
        "/help - Hiện tất cả lệnh",
        "/hepl - Hiện tất cả lệnh",
        "/ping - Kiểm tra bot",
        "/id - Xem ID",
        "/bot - Thông tin bot",
        "",
        "👑 LỆNH ADMIN:",
        "/ad - Kiểm tra quyền admin",
        "/on - Bật bot",
        "/off - Tắt bot",
        "/batquytac - Bật chế độ đặc biệt",
        "/tatbatquytat - Tắt chế độ đặc biệt",
        "/ghinho <nội dung> - Ghi nhớ",
        "/ghinho A -bot : B - Ghi nhớ A → B",
      ];

      if (isAdmin) {
        lines.push(
          "",
          "✅ Bạn đang là ADMIN."
        );
      }

      lines.push(
        "",
        "💬 Trong nhóm: muốn bot trả lời AI, bắt đầu tin nhắn bằng dấu /.",
        "Ví dụ: /hôm nay mày thế nào?"
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
// /ID
// ============================================================

registerCommand(
  "id",
  {
    description:
      "Xem ID Zalo",

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
          `Chat ID: ${
            chatId || "Không có"
          }`,
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
// /AD
// ============================================================

registerCommand(
  "ad",
  {
    description:
      "Kiểm tra quyền admin",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      isAdmin,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 KIỂM TRA ADMIN",
          "",
          `User ID: ${
            userId || "Không có"
          }`,
          `Quyền: ${
            isAdmin
              ? "✅ ADMIN"
              : "❌ KHÔNG PHẢI ADMIN"
          }`,
          "",
          `Số admin đã cấu hình: ${
            ADMIN_IDS.length
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
      "Thông tin bot",

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
          `Trạng thái: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ đặc biệt: ${
            unrestrictedMode
              ? "🟡 ON"
              : "⚪ OFF"
          }`,
          `Ghi nhớ: ${
            memoryData.facts.length +
            memoryData.replies.length
          }`,
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
      "Bật bot AI",

    adminOnly: true,

    async handler({
      chatId,
      userId,
    }) {
      if (botEnabled) {
        await sendMessage(
          chatId,
          "🟢 Bot đang ON rồi."
        );

        return;
      }

      botEnabled = true;

      await sendMessage(
        chatId,
        `🟢 Bot đã được BẬT bởi admin ${userId}.`
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
      "Tắt bot AI",

    adminOnly: true,

    async handler({
      chatId,
      userId,
    }) {
      if (!botEnabled) {
        await sendMessage(
          chatId,
          "🔴 Bot đã OFF rồi."
        );

        return;
      }

      botEnabled = false;

      await sendMessage(
        chatId,
        `🔴 Bot đã được TẮT bởi admin ${userId}.\n\nChỉ khi một admin dùng /on thì bot mới hoạt động lại.`
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
      "Bật chế độ đặc biệt",

    adminOnly: true,

    async handler({
      chatId,
      userId,
    }) {
      unrestrictedMode = true;

      await sendMessage(
        chatId,
        [
          "🟡 ĐÃ BẬT CHẾ ĐỘ ĐẶC BIỆT.",
          "",
          `Admin: ${userId}`,
          "",
          "Bot sẽ dùng persona thoải mái hơn trong hội thoại, nhưng không bỏ qua các giới hạn an toàn.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /TATBATQUYTAT
// ============================================================

registerCommand(
  "tatbatquytat",
  {
    description:
      "Tắt chế độ đặc biệt",

    aliases: [
      "tatquytac",
    ],

    adminOnly: true,

    async handler({
      chatId,
      userId,
    }) {
      unrestrictedMode =
        false;

      await sendMessage(
        chatId,
        [
          "⚪ ĐÃ TẮT CHẾ ĐỘ ĐẶC BIỆT.",
          "",
          `Admin: ${userId}`,
          "",
          "Bot đã trở về chế độ bình thường.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /GHINHO
// ============================================================

registerCommand(
  "ghinho",
  {
    description:
      "Ghi nhớ thông tin hoặc câu trả lời",

    adminOnly: true,

    async handler({
      chatId,
      text,
    }) {
      if (!text) {
        await sendMessage(
          chatId,
          [
            "❌ Thiếu nội dung.",
            "",
            "Cú pháp:",
            "/ghinho Nội dung cần nhớ",
            "",
            "Hoặc:",
            "/ghinho Câu kích hoạt -bot : Câu trả lời",
            "",
            "Ví dụ:",
            "/ghinho rên đi em -bot : ~~",
          ].join("\n")
        );

        return;
      }

      const result =
        addMemory(text);

      if (!result.ok) {
        await sendMessage(
          chatId,
          `❌ ${result.error}`
        );

        return;
      }

      if (
        result.type ===
        "reply"
      ) {
        await sendMessage(
          chatId,
          [
            "🧠 ĐÃ GHI NHỚ.",
            "",
            `🎯 Câu kích hoạt: ${result.trigger}`,
            `🤖 Bot trả lời: ${result.reply}`,
          ].join("\n")
        );

        return;
      }

      await sendMessage(
        chatId,
        [
          "🧠 ĐÃ GHI NHỚ.",
          "",
          result.text,
          "",
          "Nội dung này được dùng làm thông tin ngữ cảnh cho AI.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// MEMORY DEFAULT
// ============================================================

function ensureDefaultMemory() {
  const defaultTrigger =
    "ai tạo ra bot mặt đất màu xanh";

  const exists =
    memoryData.replies.some(
      (item) =>
        normalizeText(
          item.trigger
        ) ===
        normalizeText(
          defaultTrigger
        )
    );

  if (!exists) {
    memoryData.replies.push({
      id: makeId(),

      trigger:
        defaultTrigger,

      reply:
        "An Na & Hoàng Vũ.",

      createdAt:
        new Date().toISOString(),
    });

    saveMemory();
  }
}

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
// GROUP DETECTION
// ============================================================

function isGroupChat(
  chatType
) {
  const value =
    String(
      chatType || ""
    ).toLowerCase();

  return (
    value.includes("group") ||
    value.includes("room") ||
    value === "group"
  );
}

// ============================================================
// COMMAND HANDLER
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
    chatType,
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  const group =
    isGroupChat(
      chatType
    );

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
    `👥 GROUP: ${group}`
  );

  log(
    `💬 TEXT: ${text}`
  );

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(text);

  if (parsed) {
    const exists =
      COMMANDS.has(
        parsed.command
      );

    if (exists) {
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

    // --------------------------------------------------------
    // Trong nhóm:
    // /hello em
    // /mày đang làm gì
    //
    // => đây là AI message.
    // --------------------------------------------------------

    if (group) {
      const aiText =
        text
          .slice(1)
          .trim();

      if (!aiText) {
        return;
      }

      await processAIMessage(
        update,
        aiText
      );

      return;
    }

    // --------------------------------------------------------
    // Ngoài nhóm:
    // /abc không tồn tại
    // --------------------------------------------------------

    await sendMessage(
      chatId,
      [
        `❓ Không có lệnh /${parsed.command}.`,
        "",
        "Dùng /help để xem tất cả lệnh.",
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // GROUP
  // ==========================================================
  //
  // Trong nhóm:
  // Không có "/" => bot im.
  //
  // ==========================================================

  if (group) {
    return;
  }

  // ==========================================================
  // MEMORY REPLY
  // ==========================================================

  const remembered =
    findMemoryReply(text);

  if (remembered) {
    log(
      "🧠 MEMORY REPLY HIT:",
      remembered.trigger
    );

    try {
      await sendMessage(
        chatId,
        remembered.reply
      );
    } catch (error) {
      log(
        "❌ MEMORY SEND:",
        error.message
      );
    }

    return;
  }

  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (!botEnabled) {
    log(
      "🔴 BOT OFF - bỏ qua."
    );

    return;
  }

  // ==========================================================
  // GEMINI
  // ==========================================================

  await processAIMessage(
    update,
    text
  );
}

// ============================================================
// PROCESS AI
// ============================================================

async function processAIMessage(
  update,
  aiText
) {
  const {
    chatId,
    userName,
  } = update;

  if (!botEnabled) {
    return;
  }

  // Kiểm tra memory reply lần nữa
  // để group "/câu..." cũng dùng được.
  const remembered =
    findMemoryReply(
      aiText
    );

  if (remembered) {
    await sendMessage(
      chatId,
      remembered.reply
    );

    return;
  }

  await sendTyping(
    chatId
  );

  try {
    const answer =
      await askGemini(
        aiText,
        userName
      );

    await sendMessage(
      chatId,
      answer
    );

    log(
      "✅ GEMINI → ZALO"
    );
  } catch (error) {
    log(
      "❌ GEMINI ERROR:",
      error.message
    );

    try {
      await sendMessage(
        chatId,
        "😵 Bot đang lỗi AI, thử lại sau vài giây."
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
      message?.chat
        ?.type ||
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

    log(
      "📩 WEBHOOK:",
      JSON.stringify(
        req.body
      )
    );

    // Trả lời Zalo ngay
    res.json({
      ok: true,
    });

    if (!update) {
      return;
    }

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
        (error) => {
          log(
            "❌ HANDLE ERROR:",
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
          "🖼️ Bot đã nhận ảnh."
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
          (error) =>
            log(
              "❌ STICKER:",
              error.message
            )
        );
      }

      return;
    }

    // ========================================================
    // VOICE
    // ========================================================

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại."
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
// ROOT
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
        activeGeminiModel,

      botEnabled,

      unrestrictedMode,

      admins:
        ADMIN_IDS.length,

      memory: {
        facts:
          memoryData.facts
            .length,

        replies:
          memoryData.replies
            .length,
      },

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
    "📡 setWebhook:",
    JSON.stringify(
      data
    )
  );

  if (!data?.ok) {
    throw new Error(
      "setWebhook thất bại."
    );
  }

  log(
    "✅ WEBHOOK ĐÃ SET"
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
      JSON.stringify(
        data
      )
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
  if (
    !GEMINI_API_KEY
  ) {
    return false;
  }

  try {
    const answer =
      await askGemini(
        "Trả lời đúng một chữ: OK",
        "SYSTEM"
      );

    log(
      "✅ GEMINI TEST:",
      answer
    );

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
  loadMemory();

  ensureDefaultMemory();

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
        "✅ ZALO API OK"
      );
    } catch (error) {
      log(
        "❌ ZALO ERROR:",
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
    `👑 ADMIN: ${
      ADMIN_IDS.length
        ? ADMIN_IDS.join(", ")
        : "NONE"
    }`
  );

  console.log(
    `🧠 MEMORY FACTS: ${
      memoryData.facts.length
    }`
  );

  console.log(
    `🧠 MEMORY REPLIES: ${
      memoryData.replies.length
    }`
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
