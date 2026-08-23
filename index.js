const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==================================================
// CẤU HÌNH
// ==================================================

const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

// Bot mặc định bật
let botEnabled = true;

// Model Groq
const AI_MODEL = "llama-3.3-70b-versatile";

// ==================================================
// KIỂM TRA CẤU HÌNH
// ==================================================

console.log("================================");
console.log("🤖 ZALO GROQ AI BOT");
console.log("================================");

console.log(
  "ZALO_BOT_TOKEN:",
  ZALO_BOT_TOKEN ? "OK" : "❌ THIẾU"
);

console.log(
  "GROQ_API_KEY:",
  GROQ_API_KEY ? "OK" : "❌ THIẾU"
);

console.log(
  "ADMIN_ID:",
  ADMIN_ID ? "OK" : "⚠️ Chưa có"
);

console.log(
  "AI MODEL:",
  AI_MODEL
);

// ==================================================
// GỌI GROQ AI
// ==================================================

async function askAI(text) {
  if (!GROQ_API_KEY) {
    return "⚠️ Bot chưa có GROQ_API_KEY.";
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },

        body: JSON.stringify({
          model: AI_MODEL,

          messages: [
            {
              role: "system",
              content:
                "Bạn là một trợ lý AI nói tiếng Việt. " +
                "Trả lời tự nhiên, thân thiện, dễ hiểu. " +
                "Không cần nói mình là AI nếu người dùng không hỏi."
            },
            {
              role: "user",
              content: text
            }
          ],

          temperature: 0.7,
          max_completion_tokens: 1024
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Groq API:", data);

      return "❌ AI đang lỗi hoặc GROQ_API_KEY không hợp lệ.";
    }

    const answer =
      data?.choices?.[0]?.message?.content;

    if (!answer) {
      console.error("❌ Groq không trả về nội dung:", data);

      return "❌ AI không trả về câu trả lời.";
    }

    return answer;

  } catch (error) {
    console.error("❌ GROQ ERROR:", error);

    return "❌ Không kết nối được Groq AI.";
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

  if (!chatId) {
    console.error("❌ Không có chat_id");
    return;
  }

  try {
    // Chia tin nhắn dài thành nhiều phần
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
        console.error(
          "❌ Gửi Zalo thất bại:",
          data
        );
      }
    }

  } catch (error) {
    console.error(
      "❌ ZALO SEND ERROR:",
      error
    );
  }
}

// ==================================================
// TRANG CHỦ
// ==================================================

app.get("/", (req, res) => {
  res.send("🤖 Zalo Groq AI Bot is running!");
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

    // Trả 200 ngay cho Zalo
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

    const chatId =
  message?.chat?.id ||
  event?.chat_id ||
  event?.conversation_id;

const userId =
  message?.from?.id ||
  event?.sender?.id ||
  event?.user_id ||
  event?.author_id;

const text =
  message?.text ||
  event?.text ||
  event?.message?.text;

console.log("🆔 CHAT ID:", chatId);
console.log("🆔 USER ID:", userId);
console.log("💬 TEXT:", text);
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

    if (
      ADMIN_ID &&
      String(userId) === String(ADMIN_ID)
    ) {

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
    // GỌI GROQ
    // ==================================================

    console.log("🤖 Đang hỏi Groq AI...");

    const answer = await askAI(text);

    console.log(
      "🤖 Groq trả lời:",
      answer
    );

    // ==================================================
    // TRẢ LỜI ZALO
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
  console.log(
    `🚀 Bot server running on port ${PORT}`
  );
  console.log(
    `🟢 Bot status: ${botEnabled ? "ON" : "OFF"}`
  );
  console.log(
    `🤖 AI: ${AI_MODEL}`
  );
  console.log("================================");
});
