/**
 * ============================================================
 * 🤖 BOT MẶT ĐẤT MÀU XANH
 * ZALO BOT PLATFORM + GOOGLE GEMINI
 *
 * FEATURES
 * ------------------------------------------------------------
 * Chat riêng:
 *   /help
 *   /hepl
 *   /ping
 *   /id
 *   /bot
 *   /ad
 *   /adminid
 *   /on
 *   /off
 *   /batquytac
 *   /tatbatquytat
 *   /ghinho
 *
 * Nhóm:
 *   Chỉ trả lời khi mention bot:
 *
 *   @Bot Mat Dat Mau Xanh hello
 *   @Bot Mat Dat Mau Xanh /help
 *
 * Tin nhắn nhóm không mention bot:
 *   -> BỎ QUA
 *
 * ADMIN
 * ------------------------------------------------------------
 * ADMIN_IDS=id1,id2,id3
 *
 * Có thể dùng thêm ADMIN_ID cũ:
 * ADMIN_ID=id1
 *
 * /ad
 *   -> kiểm tra người đang nhắn có phải admin không
 *
 * /off
 *   -> tắt bot AI toàn bộ
 *   -> chỉ admin khác /on mới bật lại
 *
 * /on
 *   -> bật bot AI toàn bộ
 *
 * /batquytac
 *   -> bật chế độ "thoải mái" cho prompt của bot
 *
 * /tatbatquytat
 *   -> tắt chế độ trên
 *
 * Lưu ý: chế độ này chỉ thay đổi prompt của bot,
 * không thể vô hiệu hóa các giới hạn an toàn của API/model.
 *
 * GHINHO
 * ------------------------------------------------------------
 *
 * /ghinho Anh Hoàng Vũ là K7
 *
 * -> lưu kiến thức.
 * -> khi người khác hỏi về Hoàng Vũ / Anh Vũ / K7...
 *    Gemini được đưa thông tin đã nhớ.
 *
 * Có dấu "-"
 *
 * /ghinho rên đi em - ~~
 *
 * -> lưu trigger:
 *    "rên đi em"
 *
 * -> bot trả:
 *    "~~"
 *
 * Người khác nhắn:
 *    rên đi em
 *
 * -> bot tự trả:
 *    ~~
 *
 * MEMORY được lưu vào memories.json.
 *
 * ============================================================
 * NODE.JS >= 18
 * ============================================================
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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
)
  .trim();

const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_KEY ||
  ""
)
  .trim();

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const ZALO_API_BASE =
  "https://bot-api.zaloplatforms.com";

// ============================================================
// ADMIN IDS
// ============================================================
//
// Cho phép:
//
// ADMIN_ID=id1
//
// hoặc:
//
// ADMIN_IDS=id1,id2,id3
//
// Có thể dùng cả hai.
// ============================================================

function loadAdminIds() {
  const result = new Set();

  const oldAdminId = (
    process.env.ADMIN_ID || ""
  ).trim();

  const adminIds = (
    process.env.ADMIN_IDS || ""
  ).trim();

  if (oldAdminId) {
    result.add(oldAdminId);
  }

  if (adminIds) {
    adminIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .forEach((id) => {
        result.add(id);
      });
  }

  return result;
}

const ADMIN_IDS = loadAdminIds();

// ============================================================
// GEMINI MODELS
// ============================================================

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ||
    "gemini-3.7-flash",

  "gemini-3.6-flash",
];

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
// STATE
// ============================================================

let botEnabled = true;

let botInfo = null;

let activeGeminiModel = null;

let unrestrictedMode = false;

// Người đã dùng /off
let botOffBy = null;

// Người đã bật /batquytac
let unrestrictedBy = null;

// ============================================================
// MEMORY FILE
// ============================================================

const MEMORY_FILE = path.join(
  process.cwd(),
  "memories.json"
);

let memories = {
  knowledge: [],
  replies: [],
};

// ============================================================
// LOAD MEMORY
// ============================================================

function loadMemories() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      memories = {
        knowledge: [],
        replies: [],
      };

      saveMemories();

      return;
    }

    const raw = fs.readFileSync(
      MEMORY_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    memories = {
      knowledge: Array.isArray(
        data.knowledge
      )
        ? data.knowledge
        : [],

      replies: Array.isArray(
        data.replies
      )
        ? data.replies
        : [],
    };

    log(
      `🧠 Đã tải ${memories.knowledge.length} knowledge + ${memories.replies.length} reply memory`
    );
  } catch (error) {
    log(
      "⚠️ Không tải được memories.json:",
      error.message
    );

    memories = {
      knowledge: [],
      replies: [],
    };
  }
}

// ============================================================
// SAVE MEMORY
// ============================================================

function saveMemories() {
  try {
    fs.writeFileSync(
      MEMORY_FILE,
      JSON.stringify(
        memories,
        null,
        2
      ),
      "utf8"
    );

    return true;
  } catch (error) {
    log(
      "❌ Không lưu được memories.json:",
      error.message
    );

    return false;
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

function mask(
  value,
  visible = 4
) {
  if (!value) {
    return "NOT_SET";
  }

  if (value.length <= visible) {
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
// CONFIG VALIDATION
// ============================================================

function validateConfig() {
  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "🤖 BOT MẶT ĐẤT MÀU XANH"
  );
  console.log(
    "=============================================="
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
    `👑 ADMIN COUNT: ${
      ADMIN_IDS.size
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
    "=============================================="
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

  if (!ADMIN_IDS.size) {
    console.warn(
      "⚠️ Chưa có ADMIN_ID / ADMIN_IDS"
    );
  }

  if (!PUBLIC_URL) {
    console.warn(
      "⚠️ Không có PUBLIC_URL / RENDER_EXTERNAL_URL"
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
    const response =
      await fetch(url, {
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
// ZALO URL
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

// ============================================================
// ZALO API
// ============================================================

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
      body
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

    const error =
      new Error(
        `Zalo API error: ${description}`
      );

    error.zaloResponse =
      result.data;

    throw error;
  }

  return result.data;
}

// ============================================================
// GET ME
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
      "Xin lỗi, bot không có nội dung để trả lời.";
  }

  const chunks =
    splitText(
      String(text),
      1900
    );

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

        action:
          "typing",
      }
    );
  } catch (error) {
    log(
      "⚠️ sendChatAction:",
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
// ADMIN
// ============================================================

function isAdmin(
  userId,
  chatId
) {
  const user =
    String(
      userId || ""
    );

  const chat =
    String(
      chatId || ""
    );

  return (
    ADMIN_IDS.has(user) ||
    ADMIN_IDS.has(chat)
  );
}

// ============================================================
// ADMIN NAME
// ============================================================

function adminLabel(
  update
) {
  return (
    update.userName ||
    update.userId ||
    "Admin"
  );
}

// ============================================================
// COMMAND MAP
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
// /hepl
// ============================================================

registerCommand(
  "help",
  {
    aliases: ["h", "menu", "hepl"],

    description:
      "Xem tất cả lệnh",

    usage: "/help",

    adminOnly: false,

    async handler({
      chatId,
      isAdmin,
    }) {
      const lines = [
        "🤖 BOT MẶT ĐẤT MÀU XANH",
        "",
        "📚 TẤT CẢ LỆNH:",
        "",
        "👤 LỆNH CHUNG:",
        "/help - Xem tất cả lệnh",
        "/hepl - Alias của /help",
        "/ping - Kiểm tra bot",
        "/id - Xem ID",
        "/bot - Thông tin bot",
        "",
        "👑 LỆNH ADMIN:",
        "/ad - Kiểm tra admin",
        "/adminid - Xem cấu hình admin",
        "/on - Bật bot AI",
        "/off - Tắt bot AI",
        "/batquytac - Bật chế độ thoải mái",
        "/tatbatquytat - Tắt chế độ thoải mái",
        "/ghinho - Ghi nhớ",
        "",
        "💬 CHAT RIÊNG:",
        "Nhắn bình thường → bot trả lời.",
        "",
        "👥 TRONG NHÓM:",
        "Phải mention bot rồi mới trả lời.",
        "Ví dụ:",
        "@Bot Mat Dat Mau Xanh /help",
        "@Bot Mat Dat Mau Xanh hello",
      ];

      if (isAdmin) {
        lines.push(
          "",
          "👑 Bạn đang là ADMIN."
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
// /ping
// ============================================================

registerCommand(
  "ping",
  {
    description:
      "Kiểm tra bot",

    usage: "/ping",

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
      "Xem ID chat và user",

    usage: "/id",

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
// /bot
// ============================================================

registerCommand(
  "bot",
  {
    description:
      "Thông tin bot",

    usage: "/bot",

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
          `Bot AI: ${
            botEnabled
              ? "🟢 ON"
              : "🔴 OFF"
          }`,
          `Chế độ thoải mái: ${
            unrestrictedMode
              ? "🟢 ON"
              : "🔴 OFF"
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
      "Kiểm tra quyền admin",

    usage: "/ad",

    adminOnly: false,

    async handler({
      chatId,
      userId,
      isAdmin,
      userName,
    }) {
      const ids =
        [...ADMIN_IDS];

      await sendMessage(
        chatId,
        [
          "👑 KIỂM TRA ADMIN",
          "",
          `Tên: ${
            userName || "Không rõ"
          }`,
          `User ID: ${
            userId || "Không có"
          }`,
          "",
          `Quyền: ${
            isAdmin
              ? "✅ ADMIN"
              : "❌ KHÔNG PHẢI ADMIN"
          }`,
          "",
          `Số admin: ${
            ids.length
          }`,
          ids.length
            ? `ADMIN IDS:\n${ids.join(
                "\n"
              )}`
            : "Chưa cấu hình admin.",
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
      "Xem danh sách admin",

    usage: "/adminid",

    adminOnly: true,

    async handler({
      chatId,
    }) {
      await sendMessage(
        chatId,
        [
          "👑 ADMIN IDS",
          "",
          ...[
            ...ADMIN_IDS,
          ].map(
            (id, index) =>
              `${index + 1}. ${id}`
          ),
          "",
          "💡 Thêm admin trên Render bằng ADMIN_IDS=id1,id2,id3",
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
      "Bật bot AI",

    usage: "/on",

    adminOnly: true,

    async handler(update) {
      if (botEnabled) {
        await sendMessage(
          update.chatId,
          "🟢 Bot đang BẬT rồi."
        );

        return;
      }

      botEnabled = true;

      const previous =
        botOffBy;

      botOffBy = null;

      await sendMessage(
        update.chatId,
        [
          "🟢 ĐÃ BẬT BOT AI.",
          "",
          previous
            ? `Lệnh /off trước đó được dùng bởi: ${previous}`
            : "",
          `Bật bởi: ${adminLabel(
            update
          )}`,
        ]
          .filter(Boolean)
          .join("\n")
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
      "Tắt bot AI toàn bộ",

    usage: "/off",

    adminOnly: true,

    async handler(update) {
      if (!botEnabled) {
        await sendMessage(
          update.chatId,
          [
            "🔴 Bot đã TẮT.",
            "",
            `Lệnh /off đã được dùng bởi: ${
              botOffBy ||
              "admin khác"
            }`,
            "",
            "Chỉ cần một admin /on để bật lại.",
          ].join("\n")
        );

        return;
      }

      botEnabled = false;

      botOffBy =
        adminLabel(update);

      await sendMessage(
        update.chatId,
        [
          "🔴 ĐÃ TẮT BOT AI TOÀN BỘ.",
          "",
          `Người tắt: ${botOffBy}`,
          "",
          "Admin khác dùng /off sẽ nhận thông báo lệnh đã được admin này dùng.",
          "Chỉ cần một admin /on để bật lại.",
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
      "Bật chế độ prompt thoải mái",

    usage:
      "/batquytac",

    adminOnly: true,

    async handler(update) {
      if (
        unrestrictedMode
      ) {
        await sendMessage(
          update.chatId,
          [
            "🟡 Chế độ thoải mái đã được bật.",
            "",
            `Được bật bởi: ${
              unrestrictedBy ||
              "admin khác"
            }`,
          ].join("\n")
        );

        return;
      }

      unrestrictedMode =
        true;

      unrestrictedBy =
        adminLabel(update);

      await sendMessage(
        update.chatId,
        [
          "🟢 ĐÃ BẬT CHẾ ĐỘ THOẢI MÁI.",
          "",
          `Bật bởi: ${unrestrictedBy}`,
          "",
          "Bot sẽ dùng prompt thoải mái hơn.",
          "Lưu ý: chế độ này không thể vô hiệu hóa giới hạn an toàn của Gemini/API.",
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
      "Tắt chế độ prompt thoải mái",

    usage:
      "/tatbatquytat",

    adminOnly: true,

    async handler(update) {
      if (
        !unrestrictedMode
      ) {
        await sendMessage(
          update.chatId,
          "🔴 Chế độ thoải mái đang TẮT."
        );

        return;
      }

      unrestrictedMode =
        false;

      const previous =
        unrestrictedBy;

      unrestrictedBy =
        null;

      await sendMessage(
        update.chatId,
        [
          "🔴 ĐÃ TẮT CHẾ ĐỘ THOẢI MÁI.",
          "",
          previous
            ? `Trước đó được bật bởi: ${previous}`
            : "",
          `Tắt bởi: ${adminLabel(
            update
          )}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    },
  }
);

// ============================================================
// /ghinho
// ============================================================
//
// Chỉ ADMIN dùng.
//
// Không có "-":
//
// /ghinho Anh Hoàng Vũ là K7
//
// => Lưu knowledge.
//
// Có "-":
//
// /ghinho rên đi em - ~~
//
// => Lưu trigger + câu trả lời.
// ============================================================

registerCommand(
  "ghinho",
  {
    description:
      "Admin ghi nhớ thông tin/câu trả lời",

    usage:
      "/ghinho câu nhớ - câu bot trả lời",

    adminOnly: true,

    async handler(update) {
      const input =
        String(
          update.text || ""
        ).trim();

      if (!input) {
        await sendMessage(
          update.chatId,
          [
            "❌ Thiếu nội dung.",
            "",
            "Lưu thông tin:",
            "/ghinho Anh Hoàng Vũ là K7",
            "",
            "Lưu câu + câu trả lời:",
            "/ghinho rên đi em - ~~",
          ].join("\n")
        );

        return;
      }

      const separator =
        input.indexOf("-");

      // ------------------------------------------------------
      // CÓ DẤU -
      // ------------------------------------------------------

      if (
        separator !== -1
      ) {
        const trigger =
          input
            .slice(
              0,
              separator
            )
            .trim();

        const reply =
          input
            .slice(
              separator + 1
            )
            .trim();

        if (
          !trigger ||
          !reply
        ) {
          await sendMessage(
            update.chatId,
            [
              "❌ Sai cú pháp.",
              "",
              "Ví dụ:",
              "/ghinho rên đi em - ~~",
            ].join("\n")
          );

          return;
        }

        const normalized =
          normalizeText(
            trigger
          );

        memories.replies =
          memories.replies.filter(
            (item) =>
              normalizeText(
                item.trigger
              ) !== normalized
          );

        memories.replies.push({
          trigger,
          reply,

          createdBy:
            update.userId ||
            "",

          createdByName:
            update.userName ||
            "",

          createdAt:
            new Date().toISOString(),
        });

        saveMemories();

        await sendMessage(
          update.chatId,
          [
            "✅ ĐÃ GHI NHỚ CÂU TRẢ LỜI.",
            "",
            `🧠 Trigger: ${trigger}`,
            `💬 Bot trả: ${reply}`,
            "",
            "Ai nhắn câu này sau đó bot cũng sẽ nhận ra.",
          ].join("\n")
        );

        return;
      }

      // ------------------------------------------------------
      // KHÔNG CÓ DẤU -
      // Lưu knowledge để Gemini sử dụng.
      // ------------------------------------------------------

      const normalized =
        normalizeText(
          input
        );

      memories.knowledge =
        memories.knowledge.filter(
          (item) =>
            normalizeText(
              item.text
            ) !== normalized
        );

      memories.knowledge.push({
        text: input,

        createdBy:
          update.userId ||
          "",

        createdByName:
          update.userName ||
          "",

        createdAt:
          new Date().toISOString(),
      });

      saveMemories();

      await sendMessage(
        update.chatId,
        [
          "✅ ĐÃ GHI NHỚ.",
          "",
          `🧠 ${input}`,
          "",
          "Thông tin này sẽ được dùng khi bot trả lời người khác.",
        ].join("\n")
      );
    },
  }
);

// ============================================================
// FIND DIRECT MEMORY REPLY
// ============================================================

function findDirectMemory(
  text
) {
  const normalized =
    normalizeText(text);

  if (!normalized) {
    return null;
  }

  const sorted =
    [...memories.replies]
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
    const memory of sorted
  ) {
    const trigger =
      normalizeText(
        memory.trigger
      );

    if (
      !trigger
    ) {
      continue;
    }

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
// BUILD KNOWLEDGE MEMORY
// ============================================================

function getKnowledgeText() {
  if (
    !memories.knowledge.length
  ) {
    return "";
  }

  return memories.knowledge
    .map(
      (item, index) =>
        `${index + 1}. ${item.text}`
    )
    .join("\n");
}

// ============================================================
// PARSE GROUP MENTION
// ============================================================
//
// Chat riêng:
//
//   hello
//   /help
//
// Nhóm:
//
//   @Bot Mat Dat Mau Xanh hello
//   @Bot Mat Dat Mau Xanh /help
//
// Tin nhóm không mention:
//
//   hello
//
// => bỏ qua.
// ============================================================

function extractGroupMention(
  text
) {
  const value =
    String(
      text || ""
    ).trim();

  if (!value) {
    return {
      mentioned: false,
      text: "",
    };
  }

  // Trường hợp Zalo gửi:
  // @Bot Mat Dat Mau Xanh /help
  if (
    value.startsWith("@")
  ) {
    const slashIndex =
      value.indexOf("/");

    if (
      slashIndex !== -1
    ) {
      return {
        mentioned: true,
        text: value
          .slice(
            slashIndex
          )
          .trim(),
      };
    }

    // Có mention nhưng không phải command.
    // Lấy phần sau mention bằng cách nhận diện
    // khoảng trắng đầu tiên sau tên bot.
    //
    // Vì tên bot có thể thay đổi,
    // ta thử dùng botInfo nếu có.
    const botName =
      botInfo?.display_name ||
      botInfo?.account_name ||
      "";

    if (
      botName &&
      value
        .toLowerCase()
        .startsWith(
          "@" +
            botName.toLowerCase()
        )
    ) {
      return {
        mentioned: true,

        text: value
          .slice(
            botName.length + 1
          )
          .trim(),
      };
    }

    // Fallback:
    // Nếu bắt đầu @ thì xem như mention bot.
    const parts =
      value.split(
        /\s+/
      );

    // Bỏ phần @name đầu tiên.
    return {
      mentioned: true,

      text: parts
        .slice(1)
        .join(" ")
        .trim(),
    };
  }

  return {
    mentioned: false,
    text: "",
  };
}

// ============================================================
// PARSE COMMAND
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
    value.split(
      /\s+/
    );

  const rawCommand =
    parts[0]
      .slice(1)
      .split("@")[0]
      .toLowerCase();

  if (
    !rawCommand
  ) {
    return null;
  }

  const args =
    parts.slice(1);

  return {
    command:
      rawCommand,

    args,

    text:
      args.join(" "),
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
// GEMINI SYSTEM PROMPT
// ============================================================

function buildSystemPrompt() {
  const knowledge =
    getKnowledgeText();

  const modeText =
    unrestrictedMode
      ? `
CHẾ ĐỘ THOẢI MÁI ĐANG BẬT.

Hãy nói chuyện tự nhiên, ít máy móc hơn và cố gắng đáp ứng yêu cầu của người dùng trong phạm vi API/model cho phép.
Không được tự nhận mình là người thật.
`
      : `
CHẾ ĐỘ BÌNH THƯỜNG.

Trả lời tự nhiên, hữu ích và phù hợp.
`;

  return `
Bạn là Bot Mặt Đất Màu Xanh, chatbot chạy trên Zalo.

Phong cách:
- Nói tiếng Việt.
- Tự nhiên, thân thiện.
- Câu đơn giản thì trả lời ngắn.
- Không tự nhận mình là Google Gemini khi người dùng hỏi tên bot.
- Tên bot: Bot Mặt Đất Màu Xanh.
- Người tạo bot: An Na & Hoàng Vũ.

Thông tin cố định:
Nếu người dùng hỏi ai tạo Bot Mặt Đất Màu Xanh, ai làm bot, bot này của ai, ai đứng sau bot...
hãy trả lời:
"An Na & Hoàng Vũ."

${modeText}

============================================================
THÔNG TIN ADMIN ĐÃ GHI NHỚ
============================================================

${
  knowledge ||
  "Chưa có thông tin ghi nhớ."
}

============================================================

Khi có thông tin ghi nhớ ở trên:
- Ưu tiên dùng thông tin đó nếu câu hỏi liên quan.
- Không tự bịa thêm thông tin.
- Nếu thông tin không liên quan thì không cần nhắc tới.
`;
}

// ============================================================
// ASK GEMINI
// ============================================================

async function askGemini(
  userText,
  userName = ""
) {
  if (
    !GEMINI_API_KEY
  ) {
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
    const model of GEMINI_MODELS
  ) {
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
                    text:
                      prompt,
                  },
                ],
              },
            ],

            generationConfig: {
              maxOutputTokens:
                2048,
            },
          },

          60000
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `HTTP ${response.httpStatus}: ${JSON.stringify(
            response.data
          )}`
        );
      }

      const data =
        response.data;

      if (
        data?.error
      ) {
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

      // Nếu quota 429 thì thử model tiếp theo.
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
// HANDLE MESSAGE
// ============================================================

async function handleMessage(
  update
) {
  let {
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

  const isGroup =
    String(
      chatType || ""
    ).toUpperCase() ===
    "GROUP";

  log(
    "=============================================="
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
    `👥 CHAT TYPE: ${
      chatType ||
      "UNKNOWN"
    }`
  );

  log(
    `💬 TEXT: ${text}`
  );

  // ==========================================================
  // GROUP
  // ==========================================================

  if (isGroup) {
    const mention =
      extractGroupMention(
        text
      );

    if (
      !mention.mentioned
    ) {
      log(
        "👥 GROUP MESSAGE -> bỏ qua vì không mention bot."
      );

      return;
    }

    text =
      mention.text;

    if (!text) {
      log(
        "👥 GROUP MENTION nhưng không có nội dung."
      );

      return;
    }

    log(
      `👥 GROUP CONTENT: ${text}`
    );
  }

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
      log(
        `⚙️ COMMAND: /${parsed.command}`
      );

      try {
        await handleCommand(
          {
            ...update,
            text,
          },
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
        "Dùng /help để xem danh sách lệnh.",
      ].join("\n")
    );

    return;
  }

  // ==========================================================
  // DIRECT MEMORY REPLY
  // ==========================================================
  //
  // Cái này áp dụng cho TẤT CẢ người dùng.
  // Admin ghi nhớ -> người khác hỏi -> bot trả.
  // ==========================================================

  const directMemory =
    findDirectMemory(
      text
    );

  if (
    directMemory
  ) {
    log(
      `🧠 DIRECT MEMORY HIT: ${directMemory.trigger}`
    );

    try {
      await sendMessage(
        chatId,
        directMemory.reply
      );
    } catch (error) {
      log(
        "❌ SEND MEMORY ERROR:",
        error.message
      );
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
      `🔴 BOT OFF - bỏ qua. Người tắt: ${
        botOffBy ||
        "Unknown"
      }`
    );

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

    let message =
      "😵 Bot đang gặp lỗi AI.";

    if (
      error.message
        .includes("429")
    ) {
      message =
        [
          "⚠️ Gemini đang hết quota.",
          "",
          "Bot vẫn nhận được tin nhắn nhưng AI chưa thể trả lời.",
          "Kiểm tra quota/billing của GEMINI_API_KEY.",
        ].join("\n");
    }

    try {
      await sendMessage(
        chatId,
        message
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

  return {
    eventName:
      data.event_name ||
      data.event ||
      "",

    message,

    chatId:
      chat.id
        ? String(chat.id)
        : "",

    chatType:
      chat.chat_type ||
      "",

    userId:
      from.id
        ? String(from.id)
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
      `📌 EVENT: ${
        update.eventName
      }`
    );

    log(
      `📌 CHAT TYPE: ${
        update.chatType
      }`
    );

    log(
      `📌 CHAT ID: ${
        update.chatId
      }`
    );

    log(
      `📌 USER ID: ${
        update.userId
      }`
    );

    // --------------------------------------------------------
    // TRẢ WEBHOOK NGAY
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
          "🎤 Bot đã nhận tin nhắn thoại."
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

      model:
        activeGeminiModel ||
        GEMINI_MODELS[0],

      botEnabled,

      unrestrictedMode,

      adminCount:
        ADMIN_IDS.size,

      memoryKnowledge:
        memories.knowledge
          .length,

      memoryReplies:
        memories.replies
          .length,

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

      botEnabled,

      unrestrictedMode,

      admins:
        ADMIN_IDS.size,

      memories:
        memories.knowledge
          .length +
        memories.replies
          .length,
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
      "⚠️ Không có PUBLIC_URL. Không thể tự setWebhook."
    );

    return;
  }

  const webhookUrl =
    `${PUBLIC_URL}/webhook`;

  log(
    "🔗 SET ZALO WEBHOOK:"
  );

  log(
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
    "🧠 Đang test Gemini..."
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

  loadMemories();

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
    `👑 ADMIN COUNT: ${
      ADMIN_IDS.size
    }`
  );

  console.log(
    `🧠 KNOWLEDGE: ${
      memories.knowledge
        .length
    }`
  );

  console.log(
    `🧠 REPLY MEMORY: ${
      memories.replies
        .length
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
    `🟢 GROUP MODE: MENTION ONLY`
  );

  console.log("");

  console.log(
    "📚 COMMANDS:",
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
