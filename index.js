const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==================================================
// CẤU HÌNH
// ==================================================

const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

// Bot mặc định bật
let botEnabled = true;

// Model AI
const AI_MODEL = "gpt-5.6-luna";

// ==================================================
// KIỂM TRA CẤU HÌNH
// ==================================================

console.log("================================");
console.log("🤖 ZALO AI BOT");
console.log("================================");

console.log(
  "ZALO_BOT_TOKEN:",
  ZALO_BOT_TOKEN ? "OK" : "❌ THIẾU"
);

console.log(
  "OPENAI_API_KEY:",
  OPENAI_API_KEY ? "OK" : "❌ THIẾU"
);

console.log(
  "ADMIN_ID:",
  ADMIN_ID ? "OK" : "⚠️ Chưa có"
);

// ==================================================
// GỌI OPENAI
// ==================================================

async function askAI(text) {
  if (!OPENAI_API_KEY) {
    return "⚠️ Bot chưa có OPENAI_API_KEY.";
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: AI_MODEL,

          instructions:
            "Bạn là một trợ lý AI nói tiếng Việt. " +
            "Trả lời tự nhiên, thân thiện, dễ hiểu. " +
            "Không cần nói mình là AI nếu người dùng không hỏi.",

          input: text
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ OpenAI:", data);

      return "❌ AI đang lỗi hoặc API key không hợp lệ.";
    }

    return (
      data.output_text ||
      "Xin lỗi, mình chưa tạo được câu trả lời."
    );

  } catch (error) {
    console.error("❌ AI ERROR:", error);

    return "❌ Không kết nối được AI.";
  }
}

// ==================================================
// GỬI TIN NHẮN ZALO
// ==================================================

async function sendZaloMessage(chatId, text) {
  if (!ZALO_BOT_TOKEN) {
    console.error("❌ Thiếu ZALO_BOT_TOKEN");
    return;
  }

  try {
    // Zalo giới hạn độ dài tin nhắn,
    // nên chia tin dài thành nhiều phần.
    const chunks = [];

    for (let i = 0; i < text.length; i += 1900) {
      chunks.push(text.substring(i, i + 1900));
    }

    for (const chunk of chunks) {
      const response = await fetch(
        `https://bot-api.zaloplatforms.com/bot${ZALO_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            chat_id: String(chatId),
            text: chunk
          })
        }
      );

      const data = await response.json();

      console.log("📨 Zalo:", data);

      if (!response.ok || data.ok === false) {
        console.error("❌ Gửi Zalo thất bại:", data);
      }
    }

  } catch (error) {
    console.error("❌ ZALO SEND ERROR:", error);
  }
}

// ==================================================
// TRANG CHỦ
// ==================================================

app.get("/", (req, res) => {
  res.send("🤖 Zalo AI Bot is running!");
});

// ==================================================
// TEST WEBHOOK
// ==================================================

app.get("/webhook", (req, res) => {
  res.send("Webhook OK");
});

// ==================================================
// NHẬN TIN NHẮN ZALO
// ==================================================

app.post("/webhook", async (req, res) => {

  try {

    console.log("");
    console.log("================================");
    console.log("📩 ZALO EVENT");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("================================");

    // Trả 200 ngay
    res.sendStatus(200);

    const event = req.body;

    // ==================================================
    // FORMAT ZALO BOT
    // ==================================================

    const message = event?.message;

    if (!message) {
      console.log("⚠️ Không phải message event.");
      return;
    }

    const chatId = message?.chat?.id;
    const userId = message?.from?.id;
    const text = message?.text;

    if (!chatId) {
      console.log("⚠️ Không tìm thấy chat_id.");
      return;
    }

    if (!text) {
      console.log("⚠️ Tin nhắn không có text.");
      return;
    }

    console.log("👤 User:", userId);
    console.log("💬 Tin nhắn:", text);

    // ==================================================
    // LỆNH ADMIN
    // ==================================================

    if (ADMIN_ID && String(userId) === String(ADMIN_ID)) {

      if (text.trim() === "/off") {

        botEnabled = false;

        await sendZaloMessage(
          chatId,
          "🔴 Bot đã tắt."
        );

        return;
      }

      if (text.trim() === "/on") {

        botEnabled = true;

        await sendZaloMessage(
          chatId,
          "🟢 Bot đã bật."
        );

        return;
      }

      if (text.trim() === "/status") {

        await sendZaloMessage(
          chatId,
          botEnabled
            ? "🟢 Bot đang bật."
            : "🔴 Bot đang tắt."
        );

        return;
      }
    }

    // ==================================================
    // BOT OFF
    // ==================================================

    if (!botEnabled) {
      console.log("🔴 Bot đang OFF.");
      return;
    }

    // ==================================================
    // GỌI AI
    // ==================================================

    console.log("🤖 Đang hỏi AI...");

    const answer = await askAI(text);

    console.log("🤖 AI trả lời:", answer);

    // ==================================================
    // TRẢ LỜI
    // ==================================================

    await sendZaloMessage(
      chatId,
      answer
    );

  } catch (error) {

    console.error(
      "❌ WEBHOOK ERROR:",
      error
    );

  }

});

// ==================================================
// SERVER
// ==================================================

app.listen(PORT, () => {

  console.log("");
  console.log("================================");
  console.log(`🚀 Bot server running on port ${PORT}`);
  console.log(`🟢 Bot status: ${botEnabled ? "ON" : "OFF"}`);
  console.log("================================");

});
ể
