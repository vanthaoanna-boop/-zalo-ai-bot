function normalizeWebhook(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const data =
    body.result &&
    typeof body.result === "object"
      ? body.result
      : body;

  const message = data.message || {};
  const chat = message.chat || {};

  const chatType = String(
    chat.chat_type ||
    chat.type ||
    data.chat_type ||
    data.chatType ||
    ""
  ).toUpperCase();

  const isGroup =
    chatType === "GROUP" ||
    chatType === "GROUP_CHAT" ||
    chatType === "GMF" ||
    chatType.includes("GROUP");

  return {
    eventName: data.event_name || "",

    message,

    chat: chat,

    chatId: chat?.id
      ? String(chat.id)
      : "",

    chatType,

    isGroup,

    userId:
      message?.from?.id
        ? String(message.from.id)
        : "",

    userName:
      message?.from?.display_name ||
      message?.from?.name ||
      "",

    text:
      typeof message?.text === "string"
        ? message.text.trim()
        : "",

    messageId:
      message?.message_id
        ? String(message.message_id)
        : "",
  };
}
