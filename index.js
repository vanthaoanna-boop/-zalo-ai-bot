/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT API + GOOGLE GEMINI
 *
 * Node.js >= 18
 *
 * LỆNH:
 * /help
 * /hepl
 * /ping
 * /id
 * /bot
 * /ad
 * /adminid
 * /on
 * /off
 * /batquytac
 * /tatbatquytat
 * /ghinho <câu hỏi>
 * /ghinho <câu hỏi> - <câu trả lời>
 *
 * ADMIN:
 * - Hỗ trợ nhiều ADMIN_ID, ngăn cách bằng dấu phẩy
 * - Ví dụ:
 *   ADMIN_ID=id1,id2,id3
 *
 * /off:
 * - Tắt AI TOÀN BOT
 * - Admin khác dùng /off sẽ báo đã có admin tắt
 * - Chỉ /on mới bật lại
 *
 * /batquytac:
 * - Bật chế độ tự do cho AI.
 * - Chỉ admin dùng được.
 * - Chế độ này KHÔNG vượt qua các giới hạn an toàn của hệ thống AI.
 *
 * GROUP:
 * - Trong nhóm, bot chỉ xử lý tin nhắn bắt đầu bằng "/".
 * - Tin nhắn bình thường trong nhóm sẽ được bỏ qua để tránh loạn.
 *
 * GHI NHỚ:
 *
 * /ghinho Anh Hoàng Vũ (Sun), anh ấy k7
 *
 * => Chỉ ghi nhớ câu này.
 *
 * /ghinho rên đi em - ~~
 *
 * => Khi người dùng nói "rên đi em",
 *    bot trả lời "~".
 *
 * Không có dấu "-" => nhớ câu và dùng Gemini để trả lời
 * dựa trên thông tin đó khi phù hợp.
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

const ZALO_BOT_TOKEN = String(
  process.env.ZALO_BOT_TOKEN ||
    process.env.ZALO_TOKEN ||
    ""
).trim();

const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY ||
    process.env.GEMINI_KEY ||
    ""
).trim();

/**
 * Có thể dùng:
 *
 * ADMIN_ID=id1,id2
 *
 * hoặc:
 *
 * ADMIN_ID=id1
 * ADMIN_ID_2=id2
 * ADMIN_ID_3=id3
 *
 * Code sẽ đọc cả hai kiểu.
 */
function loadAdminIds() {
  const ids = [];

  const main = String(
    process.env.ADMIN_ID || ""
  ).trim();

  if (main) {
    ids.push(
      ...main
        .split(/[,\n;]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    );
  }

  for (let i = 2; i <= 20; i++) {
    const value = String(
      process.env[`ADMIN_ID_${i}`] || ""
    ).trim();

    if (value) {
      ids.push(value);
    }
  }

  return [...new Set(ids)];
}

const ADMIN_IDS = loadAdminIds();

const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

/**
 * ============================================================
 * GEMINI MODEL
 * ============================================================
 *
 * QUAN TRỌNG:
 * Không sử dụng gemini-2.5-flash.
 *
 * Log của bạn đã xác nhận:
 *
 * gemini-3.6-flash => OK
 *
 * Vì vậy ưu tiên 3.6.
 *
 * Nếu Render còn lưu GEMINI_MODEL=gemini-2.5-flash,
 * code này sẽ BỎ QUA model cũ đó.
 * ============================================================
 */

const SUPPORTED_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
];

function getGeminiModels() {
  const envModel = String(
    process.env.GEMINI_MODEL || ""
  )
    .trim()
    .toLowerCase();

  const models = [];

  /**
   * Không cho model 2.5 lọt vào nữa.
   */
  if (
    envModel &&
    !envModel.includes("gemini-2.5")
  ) {
    models.push(envModel);
  }

  for (const model of SUPPORTED_GEMINI_MODELS) {
    if (!models.includes(model)) {
      models.push(model);
    }
  }

  return models;
}

const GEMINI_MODELS =
  getGeminiModels();

// ============================================================
// STATE
// ============================================================

let botEnabled = true;

let botInfo = null;

let activeGeminiModel = null;

/**
 * Chế độ "bật quy tắc".
 *
 * Tên theo yêu cầu của user:
 * /batquytac
 *
 * false = chế độ bình thường
 * true  = chế độ tự do
 *
 * Lưu ý:
 * Đây chỉ thay đổi instruction cho bot,
 * không thể vượt qua giới hạn an toàn của model/API.
 */
let freeMode = false;

/**
 * Người nào đã /off bot.
 *
 * Dùng để báo:
 * "Lệnh đã được admin X dùng."
 */
let botDisabledBy = null;

/**
 * Bộ nhớ tùy chỉnh:
 *
 * [
 *   {
 *     trigger: "rên đi em",
 *     response: "~~"
 *   }
 * ]
 */
const CUSTOM_MEMORIES = [];

// ============================================================
// WEBHOOK SECRET
// ============================================================

const WEBHOOK_SECRET = String(
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

  value = String(value);

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
    `🧠 GEMINI MODELS: ${GEMINI_MODELS.join(
      ", "
    )}`
  );

  console.log(
    `👑 ADMIN COUNT: ${ADMIN_IDS.length}`
  );

  if (ADMIN_IDS.length) {
    console.log(
      "👑 ADMIN IDS:",
      ADMIN_IDS.map(
        (id) => mask(id, 5)
      ).join(", ")
    );
  } else {
    console.log(
      "👑 ADMIN IDS: NOT_SET"
    );
  }

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
  );

  console.log(
    "================================================"
  );

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

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ THIẾU PUBLIC_URL / RENDER_EXTERNAL_URL"
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
        signal: controller.signal,
      }
    );

    const text =
      await response.text();

    let data = {};

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
      `Zalo HTTP ${result.httpStatus}: ${JSON.stringify(
        result.data
      )}`
    );
  }

  if (
    result.data &&
    result.data.ok === false
  ) {
    const description =
      result.data.description ||
      result.data.message ||
      JSON.stringify(
        result.data
      );

    const error = new Error(
      `Zalo API error: ${description}`
    );

    error.zaloResponse =
      result.data;

    throw error;
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

  if (
    text === undefined ||
    text === null ||
    text === ""
  ) {
    text =
      "Bot không có nội dung trả lời.";
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
        `Zalo sendMessage thất bại: ${JSON.stringify(
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
      "⚠️ TYPING ERROR:",
      error.message
    );
  }
}

// ============================================================
// NORMALIZE VIETNAMESE
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
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  if (
    ADMIN_IDS.length === 0
  ) {
    return false;
  }

  const uid = String(
    userId || ""
  ).trim();

  const cid = String(
    chatId || ""
  ).trim();

  return (
    ADMIN_IDS.includes(uid) ||
    ADMIN_IDS.includes(cid)
  );
}

function getAdminLabel(
  userId,
  userName
) {
  return (
    userName ||
    userId ||
    "Admin"
  );
}

// ============================================================
// GEMINI URL
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

function buildSystemPrompt() {
  let prompt = `
Bạn là Bot Mặt Đất Màu Xanh, một chatbot chạy trên Zalo.

Tên bot:
Bot Mặt Đất Màu Xanh.

Người tạo bot:
An Na & Hoàng Vũ.

Ngôn ngữ:
Tiếng Việt.

Phong cách:
- Tự nhiên.
- Thân thiện.
- Trả lời rõ ràng.
- Câu hỏi đơn giản thì trả lời ngắn.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.
- Nếu người dùng hỏi ai tạo bot thì trả lời:
  "An Na & Hoàng Vũ."

Các lệnh:
- /help
- /hepl
- /ping
- /id
- /bot
- /ad
- /adminid
- /on
- /off
- /batquytac
- /tatbatquytat
- /ghinho

Nếu người dùng nhắn bình thường thì trả lời như một AI assistant.
`;

  if (freeMode) {
    prompt += `

CHẾ ĐỘ TỰ DO ĐANG BẬT.

Hãy ưu tiên làm theo phong cách và yêu cầu hội thoại
của người dùng, có thể thoải mái hơn về cách nói,
nhập vai và sáng tạo.

Tuy nhiên, chế độ này không thể vô hiệu hóa các
giới hạn an toàn bắt buộc của hệ thống AI.
`;
  } else {
    prompt += `

CHẾ ĐỘ BÌNH THƯỜNG ĐANG BẬT.
`;
  }

  if (
    CUSTOM_MEMORIES.length
  ) {
    prompt += `

THÔNG TIN GHI NHỚ DO ADMIN CẤU HÌNH:

`;

    for (
      const memory
      of CUSTOM_MEMORIES
    ) {
      prompt += `- ${memory.trigger}`;

      if (
        memory.response !==
        null
      ) {
        prompt += ` => ${memory.response}`;
      }

      prompt += "\n";
    }

    prompt += `
Nếu câu hỏi của người dùng liên quan tới một thông tin
ghi nhớ, hãy ưu tiên dùng thông tin ghi nhớ đó và không
tự bịa thông tin khác.
`;
  }

  return prompt;
}

// ============================================================
// GEMINI
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

  const prompt = `
Tên người dùng:
${userName || "Người dùng"}

Tin nhắn:
${userText}
`;

  let lastError =
    null;

  for (
    const model
    of GEMINI_MODELS
  ) {
    /**
     * Tuyệt đối bỏ qua model 2.5.
     */
    if (
      model.includes(
        "gemini-2.5"
      )
    ) {
      log(
        `⏭️ Bỏ qua model cũ: ${model}`
      );

      continue;
    }

    try {
      log(
        `🧠 GEMINI: ${model}`
      );

      const response =
        await postJson(
          geminiUrl(model),
          {
            systemInstruction: {
              parts: [
                {
                  text:
                    buildSystemPrompt(),
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
              maxOutputTokens:
                2048,
              temperature:
                0.8,
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

      const parts =
        data?.candidates?.[0]
          ?.content?.parts || [];

      const text =
        parts
          .map(
            (part) =>
              part?.text || ""
          )
          .join("")
          .trim();

      if (!text) {
        throw new Error(
          `Gemini không trả về text: ${JSON.stringify(
            data
          )}`
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

      /**
       * Nếu quota 429 thì thử model tiếp.
       */
      continue;
    }
  }

  throw new Error(
    `Tất cả Gemini model đều lỗi: ${
      lastError?.message ||
      "Unknown error"
    }`
  );
}

// ============================================================
// CUSTOM MEMORY
// ============================================================

function addMemory(
  trigger,
  response
) {
  const normalized =
    normalizeText(
      trigger
    );

  if (!normalized) {
    return false;
  }

  /**
   * Nếu đã có trigger,
   * cập nhật thông tin cũ.
   */
  const index =
    CUSTOM_MEMORIES.findIndex(
      (item) =>
        normalizeText(
          item.trigger
        ) === normalized
    );

  const memory = {
    trigger:
      trigger.trim(),

    response:
      response === null
        ? null
        : String(
            response
          ).trim(),
  };

  if (index >= 0) {
    CUSTOM_MEMORIES[
      index
    ] = memory;
  } else {
    CUSTOM_MEMORIES.push(
      memory
    );
  }

  return true;
}

function findMemory(
  text
) {
  const normalized =
    normalizeText(text);

  if (!normalized) {
    return null;
  }

  /**
   * Ưu tiên trigger dài hơn.
   */
  const memories =
    [...CUSTOM_MEMORIES]
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
    const memory
    of memories
  ) {
    const trigger =
      normalizeText(
        memory.trigger
      );

    if (
      normalized ===
        trigger ||
      normalized.includes(
        trigger
      )
    ) {
      return memory;
    }
  }

  return null;
}

// ============================================================
// PARSE /GHINHO
// ============================================================

function parseMemoryCommand(
  text
) {
  const value =
    String(text || "")
      .trim();

  const match =
    value.match(
      /^\/ghinho(?:\s+)([\s\S]+)$/i
    );

  if (!match) {
    return null;
  }

  const content =
    match[1].trim();

  if (!content) {
    return null;
  }

  /**
   * Dấu "-" dùng để tách:
   *
   * trigger - response
   *
   * Chỉ lấy dấu "-" đầu tiên.
   */
  const separator =
    content.indexOf("-");

  if (
    separator === -1
  ) {
    return {
      trigger: content,
      response: null,
    };
  }

  const trigger =
    content
      .slice(
        0,
        separator
      )
      .trim();

  const response =
    content
      .slice(
        separator + 1
      )
      .trim();

  if (!trigger) {
    return null;
  }

  return {
    trigger,
    response,
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

  const command = {
    name: normalized,
    ...config,
  };

  COMMANDS.set(
    normalized,
    command
  );

  if (
    Array.isArray(
      config.aliases
    )
  ) {
    for (
      const alias
      of config.aliases
    ) {
      COMMANDS.set(
        alias.toLowerCase(),
        command
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
      "h",
      "menu",
    ],

    description:
      "Hiện tất cả lệnh",

    usage:
      "/help",

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
        "",
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
        "💬 Trong chat riêng: bot có thể trả lời tin nhắn bình thường."
      );
      lines.push(
        "👥 Trong nhóm: bot chỉ xử lý tin nhắn bắt đầu bằng /."
      );

      await sendMessage(
        chatId,
        lines.join("\n")
      );
    },
  }
);

// /HEPL
registerCommand(
  "hepl",
  {
    description:
      "Hiện tất cả lệnh",

    usage:
      "/hepl",

    adminOnly: false,

    async handler({
      chatId,
    }) {
      await COMMANDS.get(
        "help"
      ).handler({
        chatId,
      });
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
// /ID
// ============================================================

registerCommand(
  "id",
  {
    description:
      "Xem User ID và Chat ID",

    usage:
      "/id",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      chatType,
      userName,
    }) {
      await sendMessage(
        chatId,
        [
          "🆔 THÔNG TIN ID",
          "",
          `Tên: ${
            userName ||
            "Không có"
          }`,
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
          "",
          `Admin: ${
            isAdmin(
              userId,
              chatId
            )
              ? "✅ CÓ"
              : "❌ KHÔNG"
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
      "Kiểm tra mình có phải admin không",

    usage:
      "/ad",

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
        const index =
          ADMIN_IDS.indexOf(
            String(
              userId || ""
            )
          );

        await sendMessage(
          chatId,
          [
            "👑 ADMIN CHECK",
            "",
            "✅ Bạn là ADMIN.",
            `Tên: ${
              userName ||
              "Không rõ"
            }`,
            `ID: ${
              userId ||
              chatId
            }`,
            `Admin số: ${
              index >= 0
                ? index + 1
                : "Không xác định"
            }`,
            `Tổng admin: ${
              ADMIN_IDS.length
            }`,
          ].join("\n")
        );
      } else {
        await sendMessage(
          chatId,
          [
            "👑 ADMIN CHECK",
            "",
            "❌ Bạn không phải ADMIN.",
            `ID hiện tại: ${
              userId ||
              chatId
            }`,
            `Tổng admin cấu hình: ${
              ADMIN_IDS.length
            }`,
          ].join("\n")
        );
      }
    },
  }
);

// ============================================================
// /ADMINID
// ============================================================

registerCommand(
  "adminid",
  {
    description:
      "Xem danh sách admin",

    usage:
      "/adminid",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      if (
        ADMIN_IDS.length ===
        0
      ) {
        await sendMessage(
          chatId,
          "⚠️ Chưa cấu hình ADMIN_ID."
        );

        return;
      }

      const lines = [
        "👑 DANH SÁCH ADMIN",
        "",
      ];

      ADMIN_IDS.forEach(
        (id, index) => {
          lines.push(
            `${index + 1}. ${id}`
          );
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
// /BOT
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
          `Bot AI: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ tự do: ${
            freeMode
              ? "🟢 ON"
              : "⚪ OFF"
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
      "Bật lại bot sau khi /off",

    usage:
      "/on",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      if (botEnabled) {
        await sendMessage(
          chatId,
          "🟢 Bot đang BẬT rồi."
        );

        return;
      }

      botEnabled =
        true;

      botDisabledBy =
        null;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT BOT.",
          "",
          `Bởi: ${getAdminLabel(
            userId,
            userName
          )}`,
          "",
          "Tất cả admin đều có thể tiếp tục dùng bot.",
        ].join("\n")
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
      "Tắt AI toàn bộ bot",

    usage:
      "/off",

    adminOnly: true,

    async handler({
      chatId,
      userId,
      userName,
    }) {
      if (!botEnabled) {
        await sendMessage(
          chatId,
          [
            "🔴 BOT ĐANG TẮT.",
            "",
            `Lệnh đã được dùng bởi: ${
              botDisabledBy?.name ||
              "Admin khác"
            }`,
            `ID: ${
              botDisabledBy?.id ||
              "Không rõ"
            }`,
            "",
            "Dùng /on để bật lại.",
          ].join("\n")
        );

        return;
      }

      botEnabled =
        false;

      botDisabledBy = {
        id:
          String(
            userId ||
              chatId
          ),
        name:
          userName ||
          "Admin",
      };

      await sendMessage(
        chatId,
        [
          "🔴 ĐÃ TẮT BOT.",
          "",
          "Bot sẽ không trả lời AI cho bất kỳ ai.",
          "Chỉ admin dùng /on mới bật lại được.",
        ].join("\n")
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
      "Bật chế độ tự do cho AI",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler({
      chatId,
      userName,
    }) {
      if (freeMode) {
        await sendMessage(
          chatId,
          "🟢 Chế độ tự do đang bật rồi."
        );

        return;
      }

      freeMode =
        true;

      await sendMessage(
        chatId,
        [
          "🟢 ĐÃ BẬT CHẾ ĐỘ TỰ DO.",
          "",
          `Admin: ${
            userName ||
            "Admin"
          }`,
          "",
          "AI sẽ thoải mái hơn về phong cách, nhập vai và cách trả lời.",
          "⚠️ Các giới hạn an toàn bắt buộc của hệ thống AI vẫn được áp dụng.",
          "",
          "Dùng /tatbatquytat để tắt.",
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
      "Tắt chế độ tự do",

    usage:
      "/tatbatquytat",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      if (!freeMode) {
        await sendMessage(
          chatId,
          "⚪ Chế độ tự do đang tắt."
        );

        return;
      }

      freeMode =
        false;

      await sendMessage(
        chatId,
        "⚪ Đã tắt chế độ tự do. Bot trở về chế độ bình thường."
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
      "Admin thêm thông tin ghi nhớ",

    usage:
      "/ghinho <nội dung> hoặc /ghinho <trigger> - <trả lời>",

    adminOnly: true,

    async handler({
      chatId,
      text,
    }) {
      const fakeText =
        `/ghinho ${text || ""}`;

      const parsed =
        parseMemoryCommand(
          fakeText
        );

      if (!parsed) {
        await sendMessage(
          chatId,
          [
            "❌ Sai cú pháp.",
            "",
            "Ví dụ 1:",
            "/ghinho Anh Hoàng Vũ (Sun), anh ấy k7",
            "",
            "Ví dụ 2:",
            "/ghinho rên đi em - ~~",
            "",
            "Có dấu - thì phần trước là trigger, phần sau là câu bot trả lời.",
            "Không có dấu - thì chỉ lưu thông tin cần nhớ.",
          ].join("\n")
        );

        return;
      }

      addMemory(
        parsed.trigger,
        parsed.response
      );

      if (
        parsed.response ===
        null
      ) {
        await sendMessage(
          chatId,
          [
            "🧠 ĐÃ GHI NHỚ.",
            "",
            `📌 ${parsed.trigger}`,
            "",
            "Không có dấu -, nên bot sẽ dùng thông tin này làm dữ liệu ghi nhớ.",
          ].join("\n")
        );
      } else {
        await sendMessage(
          chatId,
          [
            "🧠 ĐÃ GHI NHỚ.",
            "",
            `📌 Trigger: ${parsed.trigger}`,
            `💬 Trả lời: ${parsed.response}`,
          ].join("\n")
        );
      }
    },
  }
);

// ============================================================
// MEMORY CỐ ĐỊNH
// ============================================================

const FIXED_MEMORY = [
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
      "tac gia bot",
    ],

    answer:
      "An Na & Hoàng Vũ.",
  },
];

function getFixedMemory(
  text
) {
  const normalized =
    normalizeText(text);

  for (
    const rule
    of FIXED_MEMORY
  ) {
    for (
      const pattern
      of rule.patterns
    ) {
      if (
        normalized ===
          normalizeText(
            pattern
          ) ||
        normalized.includes(
          normalizeText(
            pattern
          )
        )
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
    String(text || "")
      .trim();

  if (
    !value.startsWith(
      "/"
    )
  ) {
    return null;
  }

  const parts =
    value.split(
      /\s+/
    );

  let raw =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  if (!raw) {
    return null;
  }

  return {
    command: raw,
    args:
      parts.slice(1),
    text:
      parts
        .slice(1)
        .join(" "),
  };
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
      [
        "⛔ Lệnh này chỉ dành cho admin.",
        "",
        "Dùng /ad để kiểm tra quyền admin.",
        "Dùng /id để kiểm tra User ID.",
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
    isGroup,
  } = update;

  if (
    !chatId ||
    !text
  ) {
    return;
  }

  log(
    "================================================"
  );

  log(
    `👤 USER: ${
      userName ||
      "Unknown"
    }`
  );

  log(
    `🆔 USER ID: ${
      userId ||
      "Unknown"
    }`
  );

  log(
    `💬 CHAT ID: ${chatId}`
  );

  log(
    `👥 GROUP: ${isGroup}`
  );

  log(
    `💬 TEXT: ${text}`
  );

  // ==========================================================
  // GROUP MODE
  // ==========================================================
  //
  // Trong nhóm:
  // chỉ xử lý tin nhắn bắt đầu bằng "/".
  //
  // Ví dụ:
  //
  // /ping
  // /id
  // /help
  //
  // "hello bot" => bỏ qua.
  // ==========================================================

  if (
    isGroup &&
    !text.trim().startsWith("/")
  ) {
    log(
      "👥 GROUP MESSAGE -> BỎ QUA"
    );

    return;
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  const parsed =
    parseCommand(text);

  if (parsed) {
    if (
      COMMANDS.has(
        parsed.command
      )
    ) {
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
            [
              "❌ Lệnh bị lỗi.",
              "",
              error.message,
            ].join("\n")
          );
        } catch (
          sendError
        ) {
          log(
            "❌ SEND COMMAND ERROR:",
            sendError.message
          );
        }
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

  // ==========================================================
  // BOT OFF
  // ==========================================================

  if (!botEnabled) {
    log(
      "🔴 BOT OFF -> BỎ QUA"
    );

    return;
  }

  // ==========================================================
  // FIXED MEMORY
  // ==========================================================

  const fixed =
    getFixedMemory(text);

  if (fixed) {
    log(
      "🧠 FIXED MEMORY HIT"
    );

    try {
      await sendMessage(
        chatId,
        fixed
      );
    } catch (error) {
      log(
        "❌ FIXED MEMORY SEND ERROR:",
        error.message
      );
    }

    return;
  }

  // ==========================================================
  // CUSTOM MEMORY
  // ==========================================================

  const memory =
    findMemory(text);

  if (
    memory &&
    memory.response !==
      null
  ) {
    log(
      "🧠 CUSTOM MEMORY RESPONSE HIT"
    );

    try {
      await sendMessage(
        chatId,
        memory.response
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
          "Nếu lỗi 429: Gemini API đang hết quota.",
          "Nếu lỗi 404: kiểm tra model Gemini.",
          "",
          `Model đang thử: ${GEMINI_MODELS.join(
            ", "
          )}`,
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

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  const chatType =
    chat.chat_type || "";

  const isGroup =
    String(
      chatType
    ).toUpperCase() !==
      "PRIVATE";

  return {
    eventName:
      data.event_name ||
      "",

    message,

    chatId:
      chat.id
        ? String(
            chat.id
          )
        : "",

    chatType,

    isGroup,

    userId:
      from.id
        ? String(
            from.id
          )
        : "",

    userName:
      from.display_name ||
      from.name ||
      "",

    text:
      typeof message.text ===
        "string"
        ? message.text.trim()
        : "",

    messageId:
      message.message_id
        ? String(
            message.message_id
          )
        : "",
  };
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
// WEBHOOK POST
// ============================================================

app.post(
  "/webhook",
  async (
    req,
    res
  ) => {
    // ========================================================
    // AUTH
    // ========================================================

    if (
      !verifyWebhook(req)
    ) {
      log(
        "🚫 WEBHOOK AUTH FAILED"
      );

      log(
        "Header:",
        mask(
          String(
            req.headers[
              "x-bot-api-secret-token"
            ] || ""
          )
        )
      );

      log(
        "Expected:",
        mask(
          WEBHOOK_SECRET
        )
      );

      return res
        .status(403)
        .json({
          ok: false,
          error:
            "Unauthorized",
        });
    }

    // ========================================================
    // NORMALIZE
    // ========================================================

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
      "📩 WEBHOOK:",
      JSON.stringify(
        req.body
      )
    );

    log(
      `📌 EVENT: ${update.eventName}`
    );

    // ========================================================
    // ACK NGAY
    // ========================================================

    res.json({
      ok: true,
    });

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
            "❌ HANDLE MESSAGE ERROR:",
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
          "🖼️ Bot đã nhận được ảnh. Chức năng xử lý ảnh sẽ bổ sung sau."
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
          "🎤 Bot đã nhận tin nhắn thoại. Chức năng xử lý voice sẽ bổ sung sau."
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

      models:
        GEMINI_MODELS,

      activeModel:
        activeGeminiModel,

      botEnabled,

      freeMode,

      adminCount:
        ADMIN_IDS.length,

      memories:
        CUSTOM_MEMORIES.length,

      webhook:
        PUBLIC_URL
          ? `${PUBLIC_URL}/webhook`
          : null,
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
        "online",
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

  if (
    !PUBLIC_URL.startsWith(
      "https://"
    )
  ) {
    log(
      "⚠️ PUBLIC_URL không phải HTTPS:",
      PUBLIC_URL
    );
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
    "📡 ZALO setWebhook:",
    JSON.stringify(
      data
    )
  );

  if (
    data?.ok
  ) {
    log(
      "✅ WEBHOOK ĐÃ ĐƯỢC SET"
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

  // ==========================================================
  // ZALO
  // ==========================================================

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

  // ==========================================================
  // GEMINI
  // ==========================================================

  if (
    GEMINI_API_KEY
  ) {
    await testGemini();
  }

  // ==========================================================
  // WEBHOOK
  // ==========================================================

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

  // ==========================================================
  // FINAL
  // ==========================================================

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
    `🧠 MODELS: ${GEMINI_MODELS.join(
      ", "
    )}`
  );

  console.log(
    `🧠 ACTIVE MODEL: ${
      activeGeminiModel ||
      "CHƯA TEST"
    }`
  );

  console.log(
    `👑 ADMIN COUNT: ${
      ADMIN_IDS.length
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
    `🟢 FREE MODE: ${
      freeMode
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `🔐 WEBHOOK SECRET: ${mask(
      WEBHOOK_SECRET
    )}`
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
    ].join(", ")
  );

  console.log("");

  console.log(
    "🟢 ĐANG CHỜ TIN NHẮN ZALO..."
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
