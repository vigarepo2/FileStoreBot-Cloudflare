// Parse the incoming Telegram update.
let update;
try {
  update = await request.json();
} catch (err) {
  return new Response("Invalid Request Body", { status: 400 });
}

// Helper function: Sends requests to Telegram API.
async function callTelegramApi(method, params) {
  const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`;
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  };
  return await fetch(url, options);
}

// Helper function: Send a text message.
async function sendText(chatId, text) {
  return await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  });
}

// Welcome message with emojis for the /start command.
function startMessage() {
  return `*🚀 Welcome to FileStore Bot!*\n\n` +
         `Use \`/help\` to see available commands.\n\n` +
         `*How It Works:*\n` +
         `-  *Admin 👑*: Send a file to the bot and then reply to that file with \`/save\` to store it.\n` +
         `-  *User 🤖*: Retrieve a stored file by clicking a link like:\n` +
         `  \`https://t.me/${CONFIG.BOT_USERNAME}?start=post=<post_id>\`\n\n` +
         `Enjoy the service!`;
}

// Help message with emojis for the /help command.
function helpMessage() {
  return `*🔍 Help Menu:*\n\n` +
         `*General Commands:*\n` +
         `-  \`/start\` - Show welcome message & instructions\n` +
         `-  \`/help\` - Display this help text\n\n` +
         `*Admin Command:*\n` +
         `-  \`/save\` - Save a file by replying to a message containing a file (Admin only)\n\n` +
         `*Note:*\n` +
         `Only the admin (ID: ${CONFIG.ADMIN_ID}) is allowed to store files.`;
}

// Process incoming updates that contain a message.
if (update.message) {
  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || "";

  // -------------------------------
  // Handle the /start Command
  // -------------------------------
  if (text.startsWith("/start")) {
    // Check for a retrieval parameter like: /start post=123456789
    const match = text.match(/post=(\S+)/);
    if (match && match) {
      const postId = match;
      // Retrieve stored file metadata from KV (key format: "post:<postId>")
      const fileData = await env.FILE_STORE.get(`post:${postId}`);
      if (fileData) {
        try {
          const meta = JSON.parse(fileData);
          // Use different Telegram API methods based on file type.
          if (meta.file_type === "document") {
            return await callTelegramApi("sendDocument", {
              chat_id: chatId,
              document: meta.file_id,
              caption: meta.caption || "",
            });
          } else if (meta.file_type === "photo") {
            return await callTelegramApi("sendPhoto", {
              chat_id: chatId,
              photo: meta.file_id,
              caption: meta.caption || "",
            });
          } else if (meta.file_type === "video") {
            return await callTelegramApi("sendVideo", {
              chat_id: chatId,
              video: meta.file_id,
              caption: meta.caption || "",
            });
          } else {
            return await sendText(chatId, "⚠️ Unsupported file type.");
          }
        } catch (e) {
          return await sendText(chatId, "❌ Error processing saved file data.");
        }
      } else {
        return await sendText(chatId, `❌ No file found for post ID: ${postId}`);
      }
    }
    // No retrieval parameter—send welcome message with instructions.
    return await sendText(chatId, startMessage());
  }

  // -------------------------------
  // Handle the /help Command
  // -------------------------------
  if (text.startsWith("/help")) {
    return await sendText(chatId, helpMessage());
  }

  // -------------------------------
  // Handle the /save Command (Admin only)
  // -------------------------------
  if (text.startsWith("/save")) {
    // Check if the sender is the designated admin.
    if (String(message.from.id) !== CONFIG.ADMIN_ID) {
      return await sendText(chatId, "❌ Unauthorized. Only the admin can save files.");
    }
    // /save must be a reply to a message that contains a file.
    if (!message.reply_to_message) {
      return await sendText(chatId, "ℹ️ Please reply to a file message with `/save` to store it.");
    }
    const fileMsg = message.reply_to_message;
    let fileId = null;
    let fileType = null;

    // Check which type of file is present.
    if (fileMsg.document) {
      fileId = fileMsg.document.file_id;
      fileType = "document";
    } else if (fileMsg.photo && fileMsg.photo.length > 0) {
      // Choose the highest resolution image.
      fileId = fileMsg.photo[fileMsg.photo.length - 1].file_id;
      fileType = "photo";
    } else if (fileMsg.video) {
      fileId = fileMsg.video.file_id;
      fileType = "video";
    } else {
      return await sendText(chatId, "⚠️ Unsupported file type for saving.");
    }

    // Generate a unique post ID (using the current timestamp).
    const postId = Date.now().toString();
    const meta = {
      file_id: fileId,
      file_type: fileType,
      caption: fileMsg.caption || "",
    };

    // Store the file metadata in KV under a key like "post:<postId>"
    await env.FILE_STORE.put(`post:${postId}`, JSON.stringify(meta));

    // Construct the retrieval link for users.
    const link = `https://t.me/${CONFIG.BOT_USERNAME}?start=post=${postId}`;
    return await sendText(chatId, `✅ *File Saved Successfully!*\n\n📁 Access it using the link:\n\`${link}\``);
  }

  // -------------------------------
  // Unrecognized Command
  // -------------------------------
  return await sendText(chatId, "😕 Command not recognized. Use `/help` for available commands.");
}

// For updates that are not messages, simply respond with "OK".
return new Response("OK");
