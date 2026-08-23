# ==============================
# KIỂM TRA TIN NHẮN NHÓM
# ==============================

text = (message.get("text") or "").strip()

chat = message.get("chat", {})
chat_type = chat.get("chat_type", "").upper()

# Có thể lấy thêm kiểu cũ nếu API trả về field khác
is_group = chat_type == "GROUP"

print("CHAT TYPE:", chat_type)
print("IS GROUP:", is_group)
print("TEXT:", text)

# ==============================
# NHÓM:
# CHỈ TRẢ LỜI KHI BẮT ĐẦU BẰNG /
# KHÔNG CẦN @ BOT
# ==============================

if is_group:
    if not text.startswith("/"):
        print("GROUP MESSAGE -> BỎ QUA")
        return {
            "status": "ignored",
            "reason": "group_message_without_slash"
        }

    print("GROUP COMMAND -> XỬ LÝ:", text)

# ==============================
# CHAT RIÊNG:
# NHẮN GÌ CŨNG XỬ LÝ
# ==============================

else:
    print("PRIVATE MESSAGE -> XỬ LÝ:", text)


# ==============================
# TỪ ĐÂY TRỞ XUỐNG XỬ LÝ LỆNH
# ==============================

if text.startswith("/"):
    command_text = text[1:].strip()
else:
    command_text = text


# Ví dụ:
# /help       -> command_text = "help"
# /ghinho abc -> command_text = "ghinho abc"
# /ad         -> command_text = "ad"

parts = command_text.split(maxsplit=1)

command = parts[0].lower() if parts else ""
argument = parts[1].strip() if len(parts) > 1 else ""


# ==============================
# KHÔNG CÒN CHECK @BOT Ở ĐÂY
# ==============================

if command == "help":
    # xử lý /help
    pass

elif command == "ad":
    # xử lý /ad
    pass

elif command == "ghinho":
    # xử lý /ghinho
    pass

else:
    # Nếu là tin nhắn nhóm thì chỉ những tin bắt đầu /
    # mới chạy tới đây.
    # Chat riêng thì tin nhắn bình thường cũng chạy AI.
    pass
