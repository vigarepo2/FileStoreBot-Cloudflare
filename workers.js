// workers.js - Complete Code for File-Store Telegram Bot on Cloudflare Workers

// Adjustable variables (replace these with your actual values)
const BOT_TOKEN = "YOUR_BOT_TOKEN_HERE";       // Your Telegram Bot Token
const ADMIN_ID = "YOUR_ADMIN_ID_HERE";         // Admin's Telegram User ID (as a string)
const BOT_USERNAME = "YourBotUsername";        // Your Bot's Username (without the @)

export default {
  async fetch(request, env, ctx) {
    // Only accept POST requests (Telegram webhooks)
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Parse the incoming Telegram update JSON
    let update;
    try {
      update = await request.json();
    } catch (error) {
      return new Response("Invalid Request Body", { status: 400 });
    }

    // Helper function: Call Telegram API endpoints
    async function callTelegramApi(method, params) {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      };
      return await fetch(url, options);
    }

    // Helper function: Send a text message to a specific chat
    async function sendText(chatId, text) {
      return await callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
      });
    }

    // Welcome message for /start command with emojis
    function startMessage() {
      return `*🚀 Welcome to FileStore Bot!*\n\n` +
             `Use \`/help\` to see available commands.\n\n` +
             `*How It Works:*\n` +
             `- *Admin 👑*: Send a file to the bot and then reply to that file with \`/save\` to store it.\n` +
             `- *User 🤖*: Retrieve a stored file using a link like:\n` +
             `  \`https://t.me/${BOT_USERNAME}?start=post=<post_id>\`\n\n` +
             `Enjoy the service!`;
    }

    // Help message with emojis
    function helpMessage() {
      return `*🔍 Help Menu:*\n\n` +
             `*General Commands:*\n` +
             `- \`/start\` - Show welcome message & instructions\n` +
             `- \`/help\` - Display this help text\n\n` +
             `*Admin Command:*\n` +
             `- \`/save\` - Save a file by replying to a file message (Admin only)\n\n` +
             `*Note:*\n` +
             `Only the admin (ID: ${ADMIN_ID}) can save files.`;
    }

    // Process incoming Telegram updates (only handling message updates)
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text || "";

      // ─────────────────────────────
      // Handle /start Command
      // ─────────────────────────────
      if (text.startsWith("/start")) {
        // Check if a retrieval parameter is provided, e.g.: "/start post=123456789"
        const match = text.match(/post=(\S+)/);
        if (match) {
          const postId = match[1];
          // Retrieve stored file metadata from KV (key format: "post:<postId>")
          const fileData = await env.FILE_STORE.get(`post:${postId}`);
          if (fileData) {
            try {
              const meta = JSON.parse(fileData);
              // Send the file based on its type
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
            } catch (error) {
              return await sendText(chatId, "❌ Error processing saved file data.");
            }
          } else {
            return await sendText(chatId, `❌ No file found for post ID: ${postId}`);
          }
        }
        // No retrieval parameter, so send the welcome/instructions message.
        return await sendText(chatId, startMessage());
      }

      // ─────────────────────────────
      // Handle /help Command
      // ─────────────────────────────
      if (text.startsWith("/help")) {
        return await sendText(chatId, helpMessage());
      }

      // ─────────────────────────────
      // Handle /save Command (Admin Only)
      // ─────────────────────────────
      if (text.startsWith("/save")) {
        // Verify if the sender is the designated admin
        if (String(message.from.id) !== ADMIN_ID) {
          return await sendText(chatId, "❌ Unauthorized. Only the admin can save files.");
        }
        // /save must be issued as a reply to a message that contains a file
        if (!message.reply_to_message) {
          return await sendText(chatId, "ℹ️ Please reply to a file message with `/save` to store it.");
        }
        const fileMsg = message.reply_to_message;
        let fileId = null;
        let fileType = null;

        // Identify the file type and extract its file_id accordingly
        if (fileMsg.document) {
          fileId = fileMsg.document.file_id;
          fileType = "document";
        } else if (fileMsg.photo && fileMsg.photo.length > 0) {
          // Use the highest resolution photo available
          fileId = fileMsg.photo[fileMsg.photo.length - 1].file_id;
          fileType = "photo";
        } else if (fileMsg.video) {
          fileId = fileMsg.video.file_id;
          fileType = "video";
        } else {
          return await sendText(chatId, "⚠️ Unsupported file type for saving.");
        }

        // Generate a unique post ID using the current timestamp
        const postId = Date.now().toString();
        const meta = {
          file_id: fileId,
          file_type: fileType,
          caption: fileMsg.caption || "",
        };

        // Store the file metadata in the KV namespace under the key "post:<postId>"
        await env.FILE_STORE.put(`post:${postId}`, JSON.stringify(meta));

        // Construct the shareable retrieval link for the stored file
        const link = `https://t.me/${BOT_USERNAME}?start=post=${postId}`;
        return await sendText(
          chatId,
          `✅ *File Saved Successfully!*\n\n📁 Access it using:\n\`${link}\``
        );
      }

      // ─────────────────────────────
      // Fallback for Unrecognized Commands
      // ─────────────────────────────
      return await sendText(chatId, "😕 Command not recognized. Use `/help` for available commands.");
    }

    // For updates that are not messages, simply return "OK"
    return new Response("OK");
  },
};
