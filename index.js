const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =========================
// CẤU HÌNH
// =========================
const ADMIN_ID = process.env.ADMIN_ID;

// Bot mặc định đang OFF
let botEnabled = false;

// =========================
// WEBHOOK
// =========================
app.get("/", (req, res) => {
  res.send("Zalo AI Bot is running!");
});

app.get("/webhook", (req, res) => {
  res.send("Webhook OK");
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("Zalo event:", JSON.stringify(req.body));

    // Trả HTTP 200 ngay cho Zalo
    res.sendStatus(200);

    // TODO:
    // Phần đọc sự kiện Zalo và gửi tin nhắn
    // sẽ nối vào đây sau khi xác định đúng
    // format webhook của Bot Manager.
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

// =========================
// CHẠY SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});
