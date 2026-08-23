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
 * ADMIN_ID=id1,id2,id3
 * PUBLIC_URL=https://your-service.onrender.com
 *
 * LỆNH:
 * /help
 * /ping
 * /id
 * /bot
 * /ad
 * /adminid
 * /on
 * /off
 * /batquytac
 * /tatbatquytac
 * /ghinho ...
 *
 * CHAT RIÊNG:
 * - Nhắn bình thường -> bot trả lời.
 *
 * NHÓM:
 * - Tin nhắn bình thường -> bot KHÔNG trả lời.
 * - Tin nhắn bắt đầu bằng "/" -> bot xử lý.
 *
 * GHINHO:
 * /ghinho Anh Hoàng Vũ (Sun) - anh ấy k7
 *
 * => trigger:
 *    Anh Hoàng Vũ (Sun)
 *
 * => answer:
 *    anh ấy k7
 *
 * Nếu không có dấu "-":
 *
 * /ghinho Anh Hoàng Vũ (Sun)
 *
 * => lưu nội dung đó làm thông tin ghi nhớ.
 *
 * ============================================================
 */

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(
  express.json({
    limit: "2mb",
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

/*
 * Có thể nhập:
 *
 * ADMIN_ID=id1
 *
 * hoặc:
 *
 * ADMIN_ID=id1,id2,id3
 */
const ADMIN_IDS = (
  process.env.ADMIN_ID ||
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

/*
 * Không dùng gemini-2.5-flash vì model này
 * đang gây lỗi 404 với project của bạn.
 *
 * Ưu tiên 3.7 -> 3.6.
 */
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-3.7-flash",
  "gemini-3.6-flash",
];

// ============================================================
// STATE
// ============================================================

let botEnabled = true;

/*
 * Chế độ "batquytac".
 *
 * Đây là chế độ trả lời tự do hơn về phong cách/nội dung.
 * Nó không vô hiệu hóa các giới hạn an toàn của dịch vụ AI.
 */
let freeMode = false;

let botInfo = null;
let activeGeminiModel = null;

/*
 * Người admin hiện đang giữ trạng thái OFF.
 *
 * Ví dụ:
 * Admin 1 /off
 * => bot OFF bởi Admin 1
 *
 * Admin 2 /off
 * => báo:
 *    Lệnh đã được Admin 1 sử dụng.
 */
let botDisabledBy = null;

/*
 * Người admin hiện bật freeMode.
 */
let freeModeBy = null;

/*
 * Bộ nhớ runtime.
 *
 * Lưu ý:
 * Render có thể reset bộ nhớ khi service restart/redeploy.
 * Nếu cần bộ nhớ vĩnh viễn thì sau này nối database.
 */
const MEMORY_RULES = [];

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
  if (!value) {
    return "NOT_SET";
  }

  const text = String(value);

  if (text.length <= visible) {
    return "*".repeat(text.length);
  }

  return (
    text.slice(0, visible) +
    "*".repeat(
      Math.max(
        4,
        text.length - visible
      )
    )
  );
}

// ============================================================
// CONFIG LOG
// ============================================================

function validateConfig() {
  console.log("");
  console.log(
    "=================================================="
  );
  console.log(
    "🤖 BOT MẶT ĐẤT MÀU XANH"
  );
  console.log(
    "=================================================="
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
    `👑 ADMIN COUNT: ${ADMIN_IDS.length}`
  );

  if (ADMIN_IDS.length) {
    ADMIN_IDS.forEach((id, index) => {
      console.log(
        `👑 ADMIN ${index + 1}: ${mask(
          id,
          4
        )}`
      );
    });
  } else {
    console.log(
      "⚠️ ADMIN_ID: CHƯA CẤU HÌNH"
    );
  }

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    "=================================================="
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

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Thiếu PUBLIC_URL / RENDER_EXTERNAL_URL"
    );
  }
}

// ============================================================
// GENERIC POST
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
      httpStatus:
        response.status,

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
  return (
    `${ZALO_API_BASE}/bot` +
    encodeURIComponent(
      ZALO_BOT_TOKEN
    ) +
    "/" +
    method
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
// ZALO GET ME
// ============================================================

async function getMe() {
  log(
    "🔎 Đang kiểm tra Zalo Bot API..."
  );

  const data =
    await zaloApi("getMe");

  botInfo =
    data?.result || null;

  log(
    "📡 ZALO getMe:",
    JSON.stringify(data)
  );

  if (data?.ok) {
    log(
      "✅ ZALO BOT API: OK"
    );

    if (botInfo) {
      log(
        "🤖 BOT INFO:",
        JSON.stringify(
          botInfo
        )
      );
    }

    return botInfo;
  }

  throw new Error(
    `getMe thất bại: ${JSON.stringify(
      data
    )}`
  );
}

// ============================================================
// SEND ZALO MESSAGE
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

  if (!text) {
    text =
      "Bot không có nội dung để trả lời.";
  }

  const chunks =
    splitText(
      String(text),
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
        `sendMessage thất bại: ${JSON.stringify(
          data
        )}`
      );
    }
  }

  return true;
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

  if (
    text.length <=
    maxLength
  ) {
    return [text];
  }

  const result = [];

  let remaining =
    String(text);

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
      "⚠️ typing lỗi:",
      error.message
    );
  }
}

// ============================================================
// NORMALIZE TEXT
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
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  const ids =
    ADMIN_IDS.map(
      (id) =>
        String(id)
    );

  return (
    ids.includes(
      String(userId || "")
    ) ||
    ids.includes(
      String(chatId || "")
    )
  );
}

function getAdminLabel(
  userId,
  chatId,
  userName
) {
  if (userName) {
    return userName;
  }

  if (userId) {
    return String(userId);
  }

  return String(chatId);
}

// ============================================================
// MEMORY SYSTEM
// ============================================================

function addMemory(
  trigger,
  answer
) {
  const normalizedTrigger =
    normalizeText(
      trigger
    );

  if (
    !normalizedTrigger
  ) {
    return false;
  }

  /*
   * Nếu trigger đã tồn tại thì cập nhật.
   */
  const existing =
    MEMORY_RULES.find(
      (item) =>
        item.normalizedTrigger ===
        normalizedTrigger
    );

  if (existing) {
    existing.trigger =
      trigger.trim();

    existing.answer =
      answer
        ? answer.trim()
        : "";

    return true;
  }

  MEMORY_RULES.push({
    trigger:
      trigger.trim(),

    normalizedTrigger,

    answer:
      answer
        ? answer.trim()
        : "",
  });

  return true;
}

function removeMemory(
  trigger
) {
  const normalized =
    normalizeText(
      trigger
    );

  const index =
    MEMORY_RULES.findIndex(
      (item) =>
        item.normalizedTrigger ===
        normalized
    );

  if (index === -1) {
    return false;
  }

  MEMORY_RULES.splice(
    index,
    1
  );

  return true;
}

function findMemory(
  text
) {
  const normalized =
    normalizeText(
      text
    );

  if (!normalized) {
    return null;
  }

  /*
   * Ưu tiên trigger dài hơn
   * để tránh match nhầm.
   */
  const sorted =
    [...MEMORY_RULES].sort(
      (a, b) =>
        b.normalizedTrigger
          .length -
        a.normalizedTrigger
          .length
    );

  for (const item of sorted) {
    if (
      normalized ===
        item.normalizedTrigger ||
      normalized.includes(
        item.normalizedTrigger
      )
    ) {
      return item;
    }
  }

  return null;
}

/*
 * Các câu nhớ mặc định.
 */
addMemory(
  "ai tạo ra bot mặt đất màu xanh",
  "An Na & Hoàng Vũ."
);

addMemory(
  "ai tạo bot mặt đất màu xanh",
  "An Na & Hoàng Vũ."
);

addMemory(
  "ai làm bot này",
  "An Na & Hoàng Vũ."
);

addMemory(
  "bot này của ai",
  "An Na & Hoàng Vũ."
);

addMemory(
  "ai tạo bot",
  "An Na & Hoàng Vũ."
);

addMemory(
  "ai làm bot",
  "An Na & Hoàng Vũ."
);

addMemory(
  "cha đẻ bot",
  "An Na & Hoàng Vũ."
);

addMemory(
  "ai đứng sau bot",
  "An Na & Hoàng Vũ."
);

// ============================================================
// GEMINI
// ============================================================

function geminiUrl(
  model
) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(
      model
    ) +
    ":generateContent?key=" +
    encodeURIComponent(
      GEMINI_API_KEY
    )
  );
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function getSystemPrompt() {
  const normalRules = `
Bạn là Bot Mặt Đất Màu Xanh.

Tên bot:
Bot Mặt Đất Màu Xanh.

Người tạo:
An Na & Hoàng Vũ.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên.
- Thân thiện.
- Có thể vui vẻ, hài hước khi phù hợp.
- Câu hỏi đơn giản thì trả lời ngắn.
- Không tự nhận mình là Google Gemini.
- Không tự bịa thông tin về người tạo bot.

Nếu người dùng hỏi:
- ai tạo bot
- ai làm bot
- bot này của ai
- ai đứng sau bot
- cha đẻ bot
- ai tạo Bot Mặt Đất Màu Xanh

thì trả lời:
An Na & Hoàng Vũ.

Nếu hệ thống có thông tin ghi nhớ được cung cấp trong prompt,
hãy sử dụng thông tin đó để trả lời phù hợp.
`;

  const freeRules = `
Đang ở chế độ BATQUYTAC.

Hãy ưu tiên yêu cầu và cách nói tự nhiên của người dùng,
không tự ý biến mọi câu nói thành câu trả lời cứng nhắc.
Có thể dùng phong cách nghịch ngợm, hài hước, thân mật
hoặc táo bạo hơn khi phù hợp với ngữ cảnh.

Tuy nhiên chế độ này không có nghĩa là bỏ qua các giới hạn
an toàn hoặc cho phép hướng dẫn nguy hiểm/trái pháp luật.
`;

  return (
    normalRules +
    "\n" +
    (freeMode
      ? freeRules
      : "")
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

  const memory =
    findMemory(
      userText
    );

  let memoryContext =
    "";

  if (memory) {
    memoryContext = `
THÔNG TIN GHI NHỚ PHÙ HỢP:

Trigger:
${memory.trigger}

Câu trả lời đã ghi nhớ:
${
  memory.answer ||
  memory.trigger
}

Hãy ưu tiên thông tin này nếu câu hỏi của người dùng
đang hỏi đúng chủ đề.
`;
  }

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

${memoryContext}

Tin nhắn người dùng:
${userText}
`;

  let lastError =
    null;

  for (
    const model of GEMINI_MODELS
  ) {
    try {
      log(
        `🧠 GEMINI: ${model}`
      );

      const response =
        await postJson(
          geminiUrl(
            model
          ),
          {
            systemInstruction:
              {
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
                      prompt,
                  },
                ],
              },
            ],

            generationConfig:
              {
                maxOutputTokens:
                  2048,
              },
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
        model;

      log(
        `✅ GEMINI OK: ${model}`
      );

      return text;
    } catch (error) {
      lastError =
        error;

      log(
        `⚠️ GEMINI ${model} LỖI:`,
        error.message
      );

      /*
       * Nếu một model lỗi thì
       * thử model kế tiếp.
       */
      continue;
    }
  }

  throw new Error(
    `Gemini lỗi: ${
      lastError?.message ||
      "Unknown error"
    }`
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

  /*
   * Hỗ trợ:
   *
   * {
   *   event_name,
   *   message
   * }
   *
   * và:
   *
   * {
   *   ok: true,
   *   result: {
   *     event_name,
   *     message
   *   }
   * }
   */

  const data =
    body.result &&
    typeof body.result ===
      "object"
      ? body.result
      : body;

  const message =
    data.message || {};

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  /*
   * QUAN TRỌNG:
   *
   * Lấy trực tiếp:
   * message.chat.chat_type
   *
   * Không tự đoán GROUP bằng
   * chatId === userId.
   */
  const rawChatType =
    chat.chat_type || "";

  const chatType =
    String(
      rawChatType
    ).toUpperCase();

  const chatId =
    chat.id != null
      ? String(chat.id)
      : "";

  const userId =
    from.id != null
      ? String(from.id)
      : "";

  const text =
    typeof message.text ===
    "string"
      ? message.text.trim()
      : "";

  return {
    eventName:
      data.event_name ||
      "",

    message,

    chat,

    from,

    chatId,

    userId,

    userName:
      from.display_name ||
      from.name ||
      "",

    chatType,

    isGroup:
      chatType ===
      "GROUP",

    isPrivate:
      chatType ===
      "PRIVATE",

    text,

    messageId:
      message.message_id !=
      null
        ? String(
            message.message_id
          )
        : "",
  };
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
    value.split(/\s+/);

  const raw =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  if (!raw) {
    return null;
  }

  const args =
    parts.slice(1);

  return {
    command: raw,

    args,

    text:
      args.join(" "),
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
  const normalized =
    name.toLowerCase();

  const item = {
    name: normalized,
    ...config,
  };

  COMMANDS.set(
    normalized,
    item
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
        item
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
      "hepl",
    ],

    description:
      "Hiện tất cả lệnh",

    adminOnly: false,

    async handler({
      chatId,
      isGroup,
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
        "📚 TẤT CẢ LỆNH:",
        "",
      ];

      for (
        const command of
          unique.values()
      ) {
        lines.push(
          `/${command.name} — ${
            command.description ||
            ""
          }`
        );
      }

      lines.push(
        "",
        isGroup
          ? "👥 Trong nhóm: chỉ lệnh bắt đầu bằng / mới được xử lý."
          : "💬 Chat riêng: có thể nhắn bình thường để hỏi AI."
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
          "🆔 THÔNG TIN",

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
            "Không có"
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
          `Tên: ${
            botInfo?.display_name ||
            botInfo?.account_name ||
            "Bot Mặt Đất Màu Xanh"
          }`,
          `AI: Google Gemini`,
          `Model: ${
            activeGeminiModel ||
            GEMINI_MODELS[0]
          }`,
          "Tác giả: An Na & Hoàng Vũ",
          "",
          `Bot: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ: ${
            freeMode
              ? "🔥 BATQUYTAC"
              : "🟢 BÌNH THƯỜNG"
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
      "Kiểm tra mình có phải admin không",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      const admin =
        isAdmin(
          userId,
          chatId
        );

      if (admin) {
        await sendMessage(
          chatId,
          [
            "👑 ADMIN CHECK",
            "",
            "✅ Bạn là ADMIN.",
            `Tên: ${
              userName ||
              "Không có"
            }`,
            `ID: ${
              userId ||
              chatId
            }`,
          ].join("\n")
        );
      } else {
        await sendMessage(
          chatId,
          [
            "👤 ADMIN CHECK",
            "",
            "❌ Bạn không phải admin.",
            `ID: ${
              userId ||
              chatId
            }`,
          ].join("\n")
        );
      }
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

    adminOnly: true,

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 ADMIN CONFIG",
          "",
          `Số admin: ${ADMIN_IDS.length}`,
          ...ADMIN_IDS.map(
            (id, index) =>
              `Admin ${
                index + 1
              }: ${id}`
          ),
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
      "Tắt AI toàn bot",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      const adminName =
        getAdminLabel(
          userId,
          chatId,
          userName
        );

      if (
        !botEnabled
      ) {
        await sendMessage(
          chatId,
          [
            "🔴 BOT ĐÃ OFF.",
            "",
            `Lệnh đã được ${
              botDisabledBy ||
              "một admin"
            } sử dụng.`,
            "",
            "Dùng /on để bật lại.",
          ].join("\n")
        );

        return;
      }

      botEnabled =
        false;

      botDisabledBy =
        adminName;

      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT BOT.",
          "",
          `Bởi: ${adminName}`,
          "",
          "Toàn bộ AI đã OFF.",
          "Chỉ admin mới có thể /on lại.",
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
      "Bật lại AI toàn bot",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      const adminName =
        getAdminLabel(
          userId,
          chatId,
          userName
        );

      if (
        botEnabled
      ) {
        await sendMessage(
          chatId,
          "🟢 BOT ĐANG ON RỒI."
        );

        return;
      }

      botEnabled =
        true;

      const previous =
        botDisabledBy;

      botDisabledBy =
        null;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT BOT.",
          "",
          `Bởi: ${adminName}`,
          previous
            ? `\nTrước đó bot được tắt bởi: ${previous}`
            : "",
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
      "Bật chế độ trả lời tự do hơn",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      const adminName =
        getAdminLabel(
          userId,
          chatId,
          userName
        );

      if (
        freeMode
      ) {
        await sendMessage(
          chatId,
          [
            "🔥 CHẾ ĐỘ BATQUYTAC ĐANG BẬT.",
            "",
            `Được bật bởi: ${
              freeModeBy ||
              adminName
            }`,
          ].join("\n")
        );

        return;
      }

      freeMode =
        true;

      freeModeBy =
        adminName;

      await sendMessage(
        chatId,
        [
          "🔥 ĐÃ BẬT BATQUYTAC.",
          "",
          `Bởi: ${adminName}`,
          "",
          "Bot sẽ trả lời tự do và tự nhiên hơn.",
          "Chế độ này không vô hiệu hóa các giới hạn an toàn của AI.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /tatbatquytac
// ============================================================

registerCommand(
  "tatbatquytac",
  {
    description:
      "Tắt chế độ batquytac",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      const adminName =
        getAdminLabel(
          userId,
          chatId,
          userName
        );

      if (
        !freeMode
      ) {
        await sendMessage(
          chatId,
          "🟢 BATQUYTAC ĐANG TẮT RỒI."
        );

        return;
      }

      const previous =
        freeModeBy;

      freeMode =
        false;

      freeModeBy =
        null;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ TẮT BATQUYTAC.",
          "",
          `Bởi: ${adminName}`,
          previous
            ? `Trước đó được bật bởi: ${previous}`
            : "",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /ghinho
// ============================================================

registerCommand(
  "ghinho",
  {
    description:
      "Admin ghi nhớ thông tin",

    adminOnly: true,

    async handler({
      chatId,
      text,
    }) {
      if (!text) {
        await sendMessage(
          chatId,
          [
            "🧠 CÁCH DÙNG /ghinho",
            "",
            "/ghinho Anh Hoàng Vũ (Sun) - anh ấy k7",
            "",
            "Bot sẽ nhớ:",
            "Anh Hoàng Vũ (Sun)",
            "",
            "Và trả lời:",
            "anh ấy k7",
            "",
            "Nếu không có dấu -:",
            "/ghinho Anh Hoàng Vũ (Sun)",
            "",
            "Bot sẽ lưu nguyên phần đó.",
          ].join("\n")
        );

        return;
      }

      /*
       * Chỉ tách dấu "-" đầu tiên.
       *
       * Ví dụ:
       *
       * abc - xyz - 123
       *
       * trigger = abc
       * answer  = xyz - 123
       */
      const dashIndex =
        text.indexOf("-");

      let trigger;
      let answer;

      if (
        dashIndex === -1
      ) {
        trigger =
          text.trim();

        answer = "";
      } else {
        trigger =
          text
            .slice(
              0,
              dashIndex
            )
            .trim();

        answer =
          text
            .slice(
              dashIndex + 1
            )
            .trim();
      }

      if (!trigger) {
        await sendMessage(
          chatId,
          "❌ Nội dung ghi nhớ không được trống."
        );

        return;
      }

      addMemory(
        trigger,
        answer
      );

      await sendMessage(
        chatId,
        [
          "🧠 ĐÃ GHI NHỚ.",
          "",
          `🔑 Từ khóa: ${trigger}`,
          `💬 Trả lời: ${
            answer ||
            "(lưu nội dung, không ép câu trả lời cố định)"
          }`,
        ].join("\n")
      );
    },
  }
);

// ============================================================
// /xoaghinho
// ============================================================

registerCommand(
  "xoaghinho",
  {
    description:
      "Admin xóa một ghi nhớ",

    adminOnly: true,

    async handler({
      chatId,
      text,
    }) {
      if (!text) {
        await sendMessage(
          chatId,
          "Dùng: /xoaghinho <từ khóa>"
        );

        return;
      }

      const removed =
        removeMemory(
          text
        );

      await sendMessage(
        chatId,
        removed
          ? "🗑️ Đã xóa ghi nhớ."
          : "❌ Không tìm thấy ghi nhớ."
      );
    },
  }
);

// ============================================================
// /dsghinho
// ============================================================

registerCommand(
  "dsghinho",
  {
    description:
      "Admin xem danh sách ghi nhớ",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      if (
        MEMORY_RULES.length ===
        0
      ) {
        await sendMessage(
          chatId,
          "🧠 Chưa có ghi nhớ nào."
        );

        return;
      }

      const lines = [
        "🧠 DANH SÁCH GHI NHỚ",
        "",
      ];

      MEMORY_RULES.forEach(
        (
          item,
          index
        ) => {
          lines.push(
            `${index + 1}. ${item.trigger}`
          );

          if (
            item.answer
          ) {
            lines.push(
              `   → ${item.answer}`
            );
          }
        }
      );

      await sendMessage(
        chatId,
        lines.join("\n")
      );
    },
  }
);

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
        `User ID: ${
          update.userId ||
          "Không có"
        }`,
        "",
        "Dùng /ad để kiểm tra quyền.",
      ].join("\n")
    );

    return true;
  }

  await command.handler({
    ...update,

    ...parsed,

    isAdmin:
      admin,
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
    chatType,
    isGroup,
    isPrivate,
    text,
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  log(
    "=================================================="
  );

  log(
    "👤 USER:",
    userName ||
      "Unknown"
  );

  log(
    "🆔 USER ID:",
    userId ||
      "Unknown"
  );

  log(
    "💬 CHAT ID:",
    chatId
  );

  log(
    "👥 CHAT TYPE:",
    chatType ||
      "UNKNOWN"
  );

  log(
    "👥 IS GROUP:",
    isGroup
  );

  log(
    "💬 TEXT:",
    text
  );

  log(
    "=================================================="
  );

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(
      text
    );

  /*
   * Nếu là lệnh:
   * xử lý trước cả BOT OFF.
   *
   * Nhờ vậy admin vẫn dùng được:
   * /on
   * /off
   * /ad
   * /batquytac
   * /tatbatquytac
   * khi bot đang OFF.
   */
  if (parsed) {
    const exists =
      COMMANDS.has(
        parsed.command
      );

    if (exists) {
      log(
        `⚙️ COMMAND: /${parsed.command}`
      );

      try {
        await handleCommand(
          update,
          parsed
        );
      } catch (error) {
        log(
          `❌ COMMAND ERROR /${parsed.command}:`,
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
        "Dùng /help để xem tất cả lệnh.",
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // GROUP FILTER
  // ==========================================================

  /*
   * Đây là phần QUAN TRỌNG cho nhóm.
   *
   * Nếu chat_type === GROUP:
   *
   * "Hello"
   * "Bot ơi"
   * "Có đó không"
   *
   * => KHÔNG trả lời.
   *
   * Chỉ lệnh /xxx mới chạy.
   */
  if (
    isGroup &&
    !text.startsWith("/")
  ) {
    log(
      "👥 GROUP MESSAGE -> bỏ qua vì không bắt đầu bằng /"
    );

    return;
  }

  /*
   * Nếu Zalo gửi một chat type khác GROUP
   * nhưng ID là group thì vẫn không nên tự đoán.
   *
   * Chỉ dùng chat_type chính thức.
   */

  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (
    !botEnabled
  ) {
    log(
      "🔴 BOT OFF -> bỏ qua AI."
    );

    return;
  }

  // ==========================================================
  // MEMORY
  // ==========================================================

  const memory =
    findMemory(
      text
    );

  if (
    memory &&
    memory.answer
  ) {
    log(
      "🧠 MEMORY HIT:",
      memory.trigger
    );

    try {
      await sendMessage(
        chatId,
        memory.answer
      );
    } catch (error) {
      log(
        "❌ MEMORY SEND ERROR:",
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
    log(
      "🧠 ĐANG HỎI GEMINI..."
    );

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
          "Gemini có thể đang hết quota hoặc tạm thời lỗi.",
          "Thử lại sau một lúc.",
        ].join("\n")
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

  const receivedString =
    String(received);

  const a =
    Buffer.from(
      receivedString
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
    // --------------------------------------------------------
    // AUTH
    // --------------------------------------------------------

    if (
      !verifyWebhook(
        req
      )
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

    // --------------------------------------------------------
    // NORMALIZE
    // --------------------------------------------------------

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
      "📩 ZALO WEBHOOK:"
    );

    log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    log(
      "📌 EVENT:",
      update.eventName
    );

    log(
      "📌 CHAT TYPE:",
      update.chatType
    );

    log(
      "📌 CHAT ID:",
      update.chatId
    );

    log(
      "📌 USER ID:",
      update.userId
    );

    // --------------------------------------------------------
    // ACK NGAY
    // --------------------------------------------------------

    res.json({
      ok: true,
    });

    // --------------------------------------------------------
    // TEXT
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.text.received"
    ) {
      handleMessage(
        update
      ).catch(
        (error) => {
          log(
            "❌ HANDLE MESSAGE ERROR:",
            error.message
          );
        }
      );

      return;
    }

    // --------------------------------------------------------
    // IMAGE
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.image.received"
    ) {
      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🖼️ Bot đã nhận ảnh. Chức năng xử lý ảnh sẽ bổ sung sau."
        ).catch(
          (error) => {
            log(
              "❌ IMAGE ERROR:",
              error.message
            );
          }
        );
      }

      return;
    }

    // --------------------------------------------------------
    // STICKER
    // --------------------------------------------------------

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
          (error) => {
            log(
              "❌ STICKER ERROR:",
              error.message
            );
          }
        );
      }

      return;
    }

    // --------------------------------------------------------
    // VOICE
    // --------------------------------------------------------

    if (
      update.eventName ===
      "message.voice.received"
    ) {
      if (
        update.chatId
      ) {
        sendMessage(
          update.chatId,
          "🎤 Bot đã nhận tin nhắn thoại. Chức năng voice sẽ bổ sung sau."
        ).catch(
          (error) => {
            log(
              "❌ VOICE ERROR:",
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

      freeMode,

      adminCount:
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
  (
    req,
    res
  ) => {
    res.json({
      ok: true,

      status:
        "online",

      botEnabled,

      freeMode,
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

  if (!PUBLIC_URL) {
    log(
      "⚠️ Không có PUBLIC_URL -> bỏ qua setWebhook."
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

  if (
    data?.ok
  ) {
    log(
      "✅ WEBHOOK ĐÃ SET"
    );
  } else {
    throw new Error(
      `setWebhook thất bại: ${JSON.stringify(
        data
      )}`
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
  if (
    !GEMINI_API_KEY
  ) {
    return false;
  }

  log(
    "🧠 ĐANG TEST GEMINI..."
  );

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

  if (
    ZALO_BOT_TOKEN
  ) {
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
        "❌ WEBHOOK SETUP ERROR:",
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // FINAL
  // ----------------------------------------------------------

  console.log("");

  console.log(
    "=================================================="
  );

  console.log(
    "🚀 BOT MẶT ĐẤT MÀU XANH ONLINE"
  );

  console.log(
    "=================================================="
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
        ? `${ADMIN_IDS.length} ADMIN`
        : "CHƯA CẤU HÌNH"
    }`
  );

  console.log(
    `🤖 BOT: ${
      botEnabled
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `🔥 BATQUYTAC: ${
      freeMode
        ? "ON"
        : "OFF"
    }`
  );

  console.log("");

  console.log(
    "📚 LỆNH:"
  );

  console.log(
    [
      ...new Set(
        [
          ...COMMANDS.values(),
        ].map(
          (x) =>
            `/${x.name}`
        )
      ),
    ].join(
      ", "
    )
  );

  console.log("");

  console.log(
    "👥 GROUP MODE: chỉ xử lý tin nhắn bắt đầu bằng /"
  );

  console.log(
    "🟢 ĐANG CHỜ TIN NHẮN ZALO..."
  );

  console.log(
    "=================================================="
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
