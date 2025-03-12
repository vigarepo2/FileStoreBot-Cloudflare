// enhanced-file-store-bot.js - Advanced File-Store Telegram Bot for Cloudflare Workers

// Configuration and Environment Variables
const CONFIG = {
  BOT_TOKEN: "YOUR_BOT_TOKEN_HERE",
  ADMIN_IDS: ["YOUR_ADMIN_ID_HERE"], // Support for multiple admins
  BOT_USERNAME: "YourBotUsername",
  MAX_FILE_SIZE_MB: 50, // Configurable file size limit
  ANALYTICS_ENABLED: true,
  DEBUG_MODE: false
};

// Utility functions
const Utils = {
  /**
   * Generates a secure, random ID for files
   * @returns {string} A secure unique ID
   */
  generateSecureId: () => {
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  
  /**
   * Logs messages based on debug mode setting
   * @param {string} message - Message to log
   * @param {string} level - Log level
   * @param {Object} data - Additional data to log
   */
  log: (message, level = "info", data = {}) => {
    if (CONFIG.DEBUG_MODE || level === "error") {
      console.log(`[${level.toUpperCase()}] ${message}`, data);
    }
  },
  
  /**
   * Safely parse JSON with error handling
   * @param {string} str - JSON string to parse
   * @param {*} defaultValue - Default value if parsing fails
   * @returns {*} Parsed object or default value
   */
  safeJsonParse: (str, defaultValue = {}) => {
    try {
      return JSON.parse(str);
    } catch (error) {
      Utils.log(`JSON parse error: ${error.message}`, "error");
      return defaultValue;
    }
  }
};

// TelegramAPI class for handling API communication
class TelegramAPI {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}/`;
  }
  
  /**
   * Call any Telegram API method
   * @param {string} method - API method name
   * @param {Object} params - Method parameters
   * @returns {Promise<Object>} API response
   */
  async callMethod(method, params = {}) {
    const url = `${this.baseUrl}${method}`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    };
    
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description}`);
      }
      
      return data.result;
    } catch (error) {
      Utils.log(`API error in ${method}: ${error.message}`, "error", params);
      throw error;
    }
  }
  
  // Specialized methods for common operations
  async sendMessage(chatId, text, options = {}) {
    return this.callMethod("sendMessage", {
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
      ...options
    });
  }
  
  async sendDocument(chatId, fileId, options = {}) {
    return this.callMethod("sendDocument", {
      chat_id: chatId,
      document: fileId,
      ...options
    });
  }
  
  async sendPhoto(chatId, fileId, options = {}) {
    return this.callMethod("sendPhoto", {
      chat_id: chatId,
      photo: fileId,
      ...options
    });
  }
  
  async sendVideo(chatId, fileId, options = {}) {
    return this.callMethod("sendVideo", {
      chat_id: chatId,
      video: fileId,
      ...options
    });
  }
  
  async sendAudio(chatId, fileId, options = {}) {
    return this.callMethod("sendAudio", {
      chat_id: chatId,
      audio: fileId,
      ...options
    });
  }
  
  async sendAnimatedObject(chatId, fileId, type, options = {}) {
    return this.callMethod(`send${type.charAt(0).toUpperCase() + type.slice(1)}`, {
      chat_id: chatId,
      [type.toLowerCase()]: fileId,
      ...options
    });
  }
  
  async editMessageText(chatId, messageId, text, options = {}) {
    return this.callMethod("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "Markdown",
      ...options
    });
  }
  
  async deleteMessage(chatId, messageId) {
    return this.callMethod("deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
  }

  async answerCallbackQuery(callbackQueryId, text, options = {}) {
    return this.callMethod("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text,
      ...options
    });
  }
}

// Database interface for Cloudflare KV storage
class Database {
  constructor(namespace) {
    this.namespace = namespace;
  }
  
  /**
   * Store an object in the database
   * @param {string} key - The storage key
   * @param {Object} value - The value to store
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await this.namespace.put(key, JSON.stringify(value));
  }
  
  /**
   * Retrieve an object from the database
   * @param {string} key - The storage key
   * @returns {Promise<Object|null>} The stored value or null
   */
  async get(key) {
    const data = await this.namespace.get(key);
    return data ? Utils.safeJsonParse(data) : null;
  }
  
  /**
   * Delete an object from the database
   * @param {string} key - The storage key
   * @returns {Promise<void>}
   */
  async delete(key) {
    await this.namespace.delete(key);
  }
  
  /**
   * List keys with a specific prefix
   * @param {string} prefix - Key prefix to search for
   * @returns {Promise<Array<string>>} List of matching keys
   */
  async listKeys(prefix) {
    const { keys } = await this.namespace.list({ prefix });
    return keys.map(k => k.name);
  }
}

// Analytics tracking for bot usage
class Analytics {
  constructor(db) {
    this.db = db;
    this.statsKey = "bot:stats";
  }
  
  /**
   * Track a user action
   * @param {string} userId - User ID
   * @param {string} action - Action performed
   * @param {Object} metadata - Additional action data
   */
  async trackAction(userId, action, metadata = {}) {
    if (!CONFIG.ANALYTICS_ENABLED) return;
    
    try {
      // Get current stats
      const stats = await this.db.get(this.statsKey) || { 
        users: {}, 
        actions: {},
        dailyStats: {}
      };
      
      const today = new Date().toISOString().split('T')[0];
      
      // Update user stats
      if (!stats.users[userId]) {
        stats.users[userId] = {
          firstSeen: Date.now(),
          actions: 0
        };
      }
      
      stats.users[userId].actions++;
      stats.users[userId].lastSeen = Date.now();
      
      // Update action stats
      if (!stats.actions[action]) {
        stats.actions[action] = 0;
      }
      stats.actions[action]++;
      
      // Update daily stats
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = { users: {}, actions: {} };
      }
      
      if (!stats.dailyStats[today].users[userId]) {
        stats.dailyStats[today].users[userId] = 0;
      }
      stats.dailyStats[today].users[userId]++;
      
      if (!stats.dailyStats[today].actions[action]) {
        stats.dailyStats[today].actions[action] = 0;
      }
      stats.dailyStats[today].actions[action]++;
      
      // Save updated stats
      await this.db.set(this.statsKey, stats);
    } catch (error) {
      Utils.log(`Analytics error: ${error.message}`, "error");
    }
  }
  
  /**
   * Get usage statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    return await this.db.get(this.statsKey) || { users: {}, actions: {}, dailyStats: {} };
  }
}

// User session management
class SessionManager {
  constructor(db) {
    this.db = db;
    this.sessionPrefix = "session:";
  }
  
  /**
   * Get or create a user session
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User session data
   */
  async getSession(userId) {
    const sessionKey = `${this.sessionPrefix}${userId}`;
    let session = await this.db.get(sessionKey);
    
    if (!session) {
      session = {
        userId,
        state: "idle",
        data: {},
        createdAt: Date.now(),
        lastActive: Date.now()
      };
      await this.db.set(sessionKey, session);
    }
    
    return session;
  }
  
  /**
   * Update a user session
   * @param {string} userId - User ID
   * @param {Object} updates - Session data updates
   * @returns {Promise<Object>} Updated session
   */
  async updateSession(userId, updates) {
    const sessionKey = `${this.sessionPrefix}${userId}`;
    const session = await this.getSession(userId);
    
    const updatedSession = {
      ...session,
      ...updates,
      lastActive: Date.now()
    };
    
    await this.db.set(sessionKey, updatedSession);
    return updatedSession;
  }
  
  /**
   * Set session state
   * @param {string} userId - User ID
   * @param {string} state - New state
   * @param {Object} data - State-specific data
   * @returns {Promise<Object>} Updated session
   */
  async setState(userId, state, data = {}) {
    return this.updateSession(userId, {
      state,
      data: { ...data }
    });
  }
}

// File manager for handling file operations
class FileManager {
  constructor(db) {
    this.db = db;
    this.filePrefix = "file:";
    this.userFilesPrefix = "user:files:";
    this.categoryPrefix = "category:";
  }
  
  /**
   * Save a file
   * @param {Object} fileData - File metadata
   * @param {string} userId - User who saved the file
   * @param {string} category - File category
   * @returns {Promise<string>} File ID
   */
  async saveFile(fileData, userId, category = "general") {
    const fileId = Utils.generateSecureId();
    const timestamp = Date.now();
    
    const fileObject = {
      id: fileId,
      ...fileData,
      savedBy: userId,
      category,
      createdAt: timestamp,
      accessCount: 0,
      lastAccessed: null
    };
    
    // Save file metadata
    await this.db.set(`${this.filePrefix}${fileId}`, fileObject);
    
    // Update user's files list
    const userFilesKey = `${this.userFilesPrefix}${userId}`;
    const userFiles = await this.db.get(userFilesKey) || [];
    userFiles.push(fileId);
    await this.db.set(userFilesKey, userFiles);
    
    // Update category index
    const categoryKey = `${this.categoryPrefix}${category}`;
    const categoryFiles = await this.db.get(categoryKey) || [];
    categoryFiles.push(fileId);
    await this.db.set(categoryKey, categoryFiles);
    
    return fileId;
  }
  
  /**
   * Get file metadata
   * @param {string} fileId - File ID
   * @returns {Promise<Object|null>} File metadata or null
   */
  async getFile(fileId) {
    return await this.db.get(`${this.filePrefix}${fileId}`);
  }
  
  /**
   * Update file access count
   * @param {string} fileId - File ID
   * @returns {Promise<void>}
   */
  async trackFileAccess(fileId) {
    const file = await this.getFile(fileId);
    if (file) {
      file.accessCount = (file.accessCount || 0) + 1;
      file.lastAccessed = Date.now();
      await this.db.set(`${this.filePrefix}${fileId}`, file);
    }
  }
  
  /**
   * Delete a file
   * @param {string} fileId - File ID
   * @param {string} userId - User requesting deletion
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(fileId, userId) {
    const file = await this.getFile(fileId);
    if (!file) return false;
    
    // Check permissions - only admin or original uploader can delete
    if (!CONFIG.ADMIN_IDS.includes(userId) && file.savedBy !== userId) {
      return false;
    }
    
    // Remove from file storage
    await this.db.delete(`${this.filePrefix}${fileId}`);
    
    // Remove from user's files list
    const userFilesKey = `${this.userFilesPrefix}${file.savedBy}`;
    const userFiles = await this.db.get(userFilesKey) || [];
    const updatedUserFiles = userFiles.filter(id => id !== fileId);
    await this.db.set(userFilesKey, updatedUserFiles);
    
    // Remove from category index
    const categoryKey = `${this.categoryPrefix}${file.category}`;
    const categoryFiles = await this.db.get(categoryKey) || [];
    const updatedCategoryFiles = categoryFiles.filter(id => id !== fileId);
    await this.db.set(categoryKey, updatedCategoryFiles);
    
    return true;
  }
  
  /**
   * Get files by user
   * @param {string} userId - User ID
   * @returns {Promise<Array<Object>>} User's files
   */
  async getUserFiles(userId) {
    const userFilesKey = `${this.userFilesPrefix}${userId}`;
    const fileIds = await this.db.get(userFilesKey) || [];
    
    // Get full file details for each ID
    const filePromises = fileIds.map(id => this.getFile(id));
    const files = await Promise.all(filePromises);
    
    // Filter out any null results (deleted files)
    return files.filter(file => file !== null);
  }
  
  /**
   * Get files by category
   * @param {string} category - Category name
   * @returns {Promise<Array<Object>>} Category files
   */
  async getFilesByCategory(category) {
    const categoryKey = `${this.categoryPrefix}${category}`;
    const fileIds = await this.db.get(categoryKey) || [];
    
    const filePromises = fileIds.map(id => this.getFile(id));
    const files = await Promise.all(filePromises);
    
    return files.filter(file => file !== null);
  }
}

// Command handler for processing bot commands
class CommandHandler {
  constructor(bot, db, telegram, fileManager, sessionManager, analytics) {
    this.bot = bot;
    this.db = db;
    this.telegram = telegram;
    this.fileManager = fileManager;
    this.sessionManager = sessionManager;
    this.analytics = analytics;
    
    // Command definitions
    this.commands = {
      'start': this.handleStart.bind(this),
      'help': this.handleHelp.bind(this),
      'save': this.handleSave.bind(this),
      'files': this.handleFiles.bind(this),
      'delete': this.handleDelete.bind(this),
      'stats': this.handleStats.bind(this),
      'cancel': this.handleCancel.bind(this)
    };
    
    // Callback query handlers
    this.callbackHandlers = {
      'file': this.handleFileCallback.bind(this),
      'page': this.handlePageCallback.bind(this),
      'category': this.handleCategoryCallback.bind(this),
      'delete': this.handleDeleteCallback.bind(this),
      'confirm': this.handleConfirmCallback.bind(this)
    };
  }
  
  /**
   * Extract command from message text
   * @param {string} text - Message text
   * @returns {Object|null} Command details or null
   */
  parseCommand(text) {
    if (!text || typeof text !== 'string') return null;
    
    const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+(.*))?$/);
    if (!match) return null;
    
    return {
      command: match[1].toLowerCase(),
      args: match[2] ? match[2].trim() : ''
    };
  }
  
  /**
   * Check if user is an admin
   * @param {string} userId - User ID to check
   * @returns {boolean} Whether user is admin
   */
  isAdmin(userId) {
    return CONFIG.ADMIN_IDS.includes(String(userId));
  }
  
  /**
   * Process incoming message
   * @param {Object} message - Telegram message object
   * @returns {Promise<Object|null>} Response or null
   */
  async processMessage(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text || '';
    
    // Track user interaction
    await this.analytics.trackAction(userId, 'message');
    
    // Get user session
    const session = await this.sessionManager.getSession(userId);
    
    // Check if user is in a specific state
    if (session.state !== 'idle') {
      // If user wants to cancel current operation
      if (text.toLowerCase() === '/cancel') {
        return this.handleCancel(message);
      }
      
      // Handle state-specific logic
      switch (session.state) {
        case 'awaiting_file_category':
          return this.handleFileCategoryInput(message, session);
        case 'awaiting_delete_confirm':
          return this.handleDeleteConfirmation(message, session);
        // Add more states as needed
      }
    }
    
    // Parse command if present
    const commandData = this.parseCommand(text);
    if (commandData) {
      const { command, args } = commandData;
      
      // Check if command exists
      if (this.commands[command]) {
        return this.commands[command](message, args);
      }
      
      // Command not found
      return this.telegram.sendMessage(chatId, `Unrecognized command: /${command}. Use /help to see available commands.`);
    }
    
    // If no command and a document/media is present, prompt to save
    if (this.hasAttachment(message) && this.isAdmin(userId)) {
      return this.promptToSaveFile(message);
    }
    
    // Basic NLP to understand user intent if no command detected
    return this.processNaturalLanguage(message, session);
  }
  
  /**
   * Process callback query
   * @param {Object} callbackQuery - Telegram callback query
   * @returns {Promise<Object|null>} Response or null
   */
  async processCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const userId = String(callbackQuery.from.id);
    
    // Track callback interaction
    await this.analytics.trackAction(userId, 'callback_query', { data });
    
    try {
      // Parse callback data (format: "action:param1:param2")
      const [action, ...params] = data.split(':');
      
      // Call appropriate handler
      if (this.callbackHandlers[action]) {
        return this.callbackHandlers[action](callbackQuery, params);
      }
      
      // Unhandled callback
      return this.telegram.answerCallbackQuery(
        callbackQuery.id, 
        "Sorry, I couldn't process this action."
      );
    } catch (error) {
      Utils.log(`Callback processing error: ${error.message}`, "error", { callbackQuery });
      return this.telegram.answerCallbackQuery(
        callbackQuery.id,
        "An error occurred while processing your request."
      );
    }
  }
  
  /**
   * Check if message has a file attachment
   * @param {Object} message - Telegram message
   * @returns {boolean} Whether message has attachment
   */
  hasAttachment(message) {
    return message.document || message.photo || message.video || 
           message.audio || message.voice || message.animation;
  }
  
  /**
   * Extract file from message
   * @param {Object} message - Telegram message
   * @returns {Object|null} File data or null
   */
  extractFileData(message) {
    // Check for document
    if (message.document) {
      return {
        file_id: message.document.file_id,
        file_type: "document",
        file_unique_id: message.document.file_unique_id,
        file_size: message.document.file_size,
        caption: message.caption || '',
        mime_type: message.document.mime_type || null
      };
    }
    
    // Check for photo
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      return {
        file_id: photo.file_id,
        file_type: "photo",
        file_unique_id: photo.file_unique_id,
        file_size: photo.file_size,
        width: photo.width,
        height: photo.height,
        caption: message.caption || '',
        mime_type: null
      };
    }
    
    // Check for video
    if (message.video) {
      return {
        file_id: message.video.file_id,
        file_type: "video",
        file_unique_id: message.video.file_unique_id,
        file_size: message.video.file_size,
        width: message.video.width,
        height: message.video.height,
        duration: message.video.duration,
        caption: message.caption || '',
        mime_type: message.video.mime_type || null
      };
    }
    
    // Check for audio
    if (message.audio) {
      return {
        file_id: message.audio.file_id,
        file_type: "audio",
        file_unique_id: message.audio.file_unique_id,
        file_size: message.audio.file_size,
        duration: message.audio.duration,
        performer: message.audio.performer,
        title: message.audio.title,
        caption: message.caption || '',
        mime_type: message.audio.mime_type || null
      };
    }
    
    // Check for voice
    if (message.voice) {
      return {
        file_id: message.voice.file_id,
        file_type: "voice",
        file_unique_id: message.voice.file_unique_id,
        file_size: message.voice.file_size,
        duration: message.voice.duration,
        caption: message.caption || '',
        mime_type: message.voice.mime_type || null
      };
    }
    
    // Check for animation
    if (message.animation) {
      return {
        file_id: message.animation.file_id,
        file_type: "animation",
        file_unique_id: message.animation.file_unique_id,
        file_size: message.animation.file_size,
        width: message.animation.width,
        height: message.animation.height,
        duration: message.animation.duration,
        caption: message.caption || '',
        mime_type: message.animation.mime_type || null
      };
    }
    
    return null;
  }
  
  /**
   * Prompt user to save a file
   * @param {Object} message - Telegram message with file
   * @returns {Promise<Object>} Response
   */
  async promptToSaveFile(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const fileData = this.extractFileData(message);
    
    if (!fileData) {
      return this.telegram.sendMessage(chatId, "No valid file found in the message.");
    }
    
    // Set user session state
    await this.sessionManager.setState(userId, 'awaiting_file_category', {
      messageId: message.message_id,
      fileData
    });
    
    // Create keyboard with common categories
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "📄 Documents", callback_data: "category:documents" },
          { text: "📸 Photos", callback_data: "category:photos" }
        ],
        [
          { text: "🎬 Videos", callback_data: "category:videos" },
          { text: "🎵 Audio", callback_data: "category:audio" }
        ],
        [
          { text: "Cancel", callback_data: "category:cancel" }
        ]
      ]
    };
    
    return this.telegram.sendMessage(
      chatId,
      "I noticed you sent a file. Please select a category or type a custom category name:",
      { reply_markup: inlineKeyboard }
    );
  }
  
  /**
   * Handle file category input
   * @param {Object} message - User's category message
   * @param {Object} session - User session
   * @returns {Promise<Object>} Response
   */
  async handleFileCategoryInput(message, session) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const category = message.text.trim();
    
    // Cancel if requested
    if (category.toLowerCase() === 'cancel') {
      await this.sessionManager.setState(userId, 'idle');
      return this.telegram.sendMessage(chatId, "File saving canceled.");
    }
    
    const { fileData } = session.data;
    
    // Save the file with the provided category
    const fileId = await this.fileManager.saveFile(fileData, userId, category);
    
    // Reset user state
    await this.sessionManager.setState(userId, 'idle');
    
    // Construct the shareable link
    const shareLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=post=${fileId}`;
    
    return this.telegram.sendMessage(
      chatId,
      `✅ *File Saved Successfully!*\n\n` +
      `📂 Category: *${category}*\n` +
      `📁 Access it using:\n` +
      `\`${shareLink}\``,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔗 Copy Link", callback_data: `file:share:${fileId}` }]
          ]
        }
      }
    );
  }
  
  /**
   * Simple NLP to understand user intent
   * @param {Object} message - User message
   * @param {Object} session - User session
   * @returns {Promise<Object|null>} Response or null
   */
  async processNaturalLanguage(message, session) {
    const text = message.text;
    const chatId = message.chat.id;
    
    if (!text) return null;
    
    const lowerText = text.toLowerCase();
    
    // Check for common intentions
    if (lowerText.includes('help') || lowerText.includes('how to')) {
      return this.handleHelp(message);
    }
    
    if (lowerText.includes('my files') || lowerText.includes('show files')) {
      return this.handleFiles(message);
    }
    
    if (lowerText.includes('stats') || lowerText.includes('statistics')) {
      return this.handleStats(message);
    }
    
    if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('hey')) {
      return this.telegram.sendMessage(
        chatId,
        `Hello! I'm a file storage bot. You can use me to save and share files easily. Use /help to see what I can do.`
      );
    }
    
    // Default response for unrecognized text
    return this.telegram.sendMessage(
      chatId,
      `I'm not sure what you're asking. Use /help to see available commands.`
    );
  }
  
  // Command handlers
  
  /**
   * Handle /start command
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<Object>} Response
   */
  async handleStart(message, args) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    // Check if a post ID was provided
    const match = args?.match(/post=(\S+)/);
    if (match) {
      const postId = match[1];
      
      // Get file data
      const fileData = await this.fileManager.getFile(postId);
      if (!fileData) {
        return this.telegram.sendMessage(chatId, "❌ The requested file was not found or has been deleted.");
      }
      
      // Track file access
      await this.fileManager.trackFileAccess(postId);
      
      // Send file based on type
      try {
        const { file_id, file_type, caption } = fileData;
        
        // Common options for all file types
        const options = {
          caption: caption || undefined
        };
        
        // Send different file types using appropriate methods
        switch (file_type) {
          case 'document':
            return this.telegram.sendDocument(chatId, file_id, options);
          case 'photo':
            return this.telegram.sendPhoto(chatId, file_id, options);
          case 'video':
            return this.telegram.sendVideo(chatId, file_id, options);
          case 'audio':
            return this.telegram.sendAudio(chatId, file_id, options);
          case 'voice':
            return this.telegram.callMethod('sendVoice', {
              chat_id: chatId,
              voice: file_id,
              ...options
            });
          case 'animation':
            return this.telegram.callMethod('sendAnimation', {
              chat_id: chatId,
              animation: file_id,
              ...options
            });
          default:
            return this.telegram.sendMessage(chatId, "Unsupported file type.");
        }
      } catch (error) {
        Utils.log(`Error sending file: ${error.message}`, "error");
        return this.telegram.sendMessage(chatId, "Error retrieving the file. Please try again later.");
      }
    }
    
    // Welcome message with useful options
    const welcomeText = "🚀 *Welcome to FileStore Bot* 🚀\n\nStore and share files easily with this secure platform.";
    
    const welcomeKeyboard = {
      inline_keyboard: [
        [
          { text: "📂 My Files", callback_data: "file:list:1" },
          { text: "📊 Statistics", callback_data: "stats:view" }
        ],
        [
          { text: "ℹ️ Help", callback_data: "help:view" }
        ]
      ]
    };
    
    return this.telegram.sendMessage(chatId, welcomeText, {
      reply_markup: welcomeKeyboard
    });
  }
  
  /**
   * Handle /help command
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} Response
   */
  async handleHelp(message) {
    const chatId = message.chat.id;
    
    const helpText = "🔍 *Available Commands:*\n\n" +
                     "/start - Begin your journey\n" +
                     "/help - Display this help message\n" +
                     "/files - Browse your stored files\n" +
                     "/stats - View usage statistics\n" +
                     "/cancel - Cancel current operation\n" +
                     "/save - Save a file (Admin only)\n" +
                     "/delete - Delete a file (Admin only)";
    
    return this.telegram.sendMessage(chatId, helpText);
  }
  
  /**
   * Handle /save command
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} Response
   */
  async handleSave(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    // Verify user is admin
    if (!this.isAdmin(userId)) {
      return this.telegram.sendMessage(chatId, "❌ Unauthorized. Only admins can save files.");
    }
    
    // Check if message is a reply
    if (!message.reply_to_message) {
      return this.telegram.sendMessage(chatId, "Please reply to a file message with /save to store it.");
    }
    
    const fileMsg = message.reply_to_message;
    const fileData = this.extractFileData(fileMsg);
    
    if (!fileData) {
      return this.telegram.sendMessage(chatId, "No valid file found in the replied message.");
    }
    
    // Set session state to await category
    await this.sessionManager.setState(userId, 'awaiting_file_category', {
      messageId: fileMsg.message_id,
      fileData
    });
    
    // Suggest categories
    const categoriesKeyboard = {
      inline_keyboard: [
        [
          { text: "📄 Documents", callback_data: "category:documents" },
          { text: "📸 Photos", callback_data: "category:photos" }
        ],
        [
          { text: "🎬 Videos", callback_data: "category:videos" },
          { text: "🎵 Audio", callback_data: "category:audio" }
        ],
        [
          { text: "Cancel", callback_data: "category:cancel" }
        ]
      ]
    };
    
    return this.telegram.sendMessage(
      chatId,
      "Please select a category for this file or type a custom category name:",
      { reply_markup: categoriesKeyboard }
    );
  }
  
  /**
   * Handle /files command
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} Response
   */
  async handleFiles(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    const files = await this.fileManager.getUserFiles(userId);
    
    if (files.length === 0) {
      return this.telegram.sendMessage(chatId, "You don't have any saved files yet.");
    }
    
    // Create paginated file list
    const pageSize = 5;
    const totalPages = Math.ceil(files.length / pageSize);
    
    return this.sendFileListPage(chatId, files, 1, pageSize, totalPages);
  }
  
  /**
   * Send a page of file list
   * @param {string} chatId - Chat ID
   * @param {Array} files - List of files
   * @param {number} page - Current page
   * @param {number} pageSize - Items per page
   * @param {number} totalPages - Total pages
   * @returns {Promise<Object>} Response
   */
  async sendFileListPage(chatId, files, page, pageSize, totalPages) {
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, files.length);
    const pageFiles = files.slice(startIdx, endIdx);
    
    let messageText = `📂 *Your Files* (${files.length} total)\n\n`;
    
    pageFiles.forEach((file, idx) => {
      const fileEmoji = this.getFileTypeEmoji(file.file_type);
      const fileDate = new Date(file.createdAt).toLocaleDateString();
      
      messageText += `${startIdx + idx + 1}. ${fileEmoji} *${file.file_type}* - ${fileDate}\n`;
      if (file.caption) {
        messageText += `   Caption: ${file.caption.substring(0, 30)}${file.caption.length > 30 ? '...' : ''}\n`;
      }
      messageText += `   Views: ${file.accessCount || 0}\n\n`;
    });
    
    // Navigation buttons
    const keyboard = [];
    
    // File action buttons
    pageFiles.forEach((file, idx) => {
      keyboard.push([
        { text: `📤 Share #${startIdx + idx + 1}`, callback_data: `file:share:${file.id}` },
        { text: `❌ Delete #${startIdx + idx + 1}`, callback_data: `file:delete:${file.id}` }
      ]);
    });
    
    // Pagination buttons
    const paginationRow = [];
    if (page > 1) {
      paginationRow.push({ text: "⬅️ Previous", callback_data: `page:files:${page - 1}` });
    }
    if (page < totalPages) {
      paginationRow.push({ text: "➡️ Next", callback_data: `page:files:${page + 1}` });
    }
    
    if (paginationRow.length > 0) {
      keyboard.push(paginationRow);
    }
    
    return this.telegram.sendMessage(chatId, messageText, {
      reply_markup: { inline_keyboard: keyboard }
    });
  }
  
  /**
   * Get emoji for file type
   * @param {string} fileType - File type
   * @returns {string} Emoji
   */
  getFileTypeEmoji(fileType) {
    const emojiMap = {
      'document': '📄',
      'photo': '📸',
      'video': '🎬',
      'audio': '🎵',
      'voice': '🎤',
      'animation': '📹'
    };
    
    return emojiMap[fileType] || '📁';
  }
  
  /**
   * Handle /delete command
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<Object>} Response
   */
  async handleDelete(message, args) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    if (!args) {
      return this.telegram.sendMessage(
        chatId,
        "Please specify a file ID to delete or use the file list from /files command."
      );
    }
    
    const fileId = args.trim();
    const file = await this.fileManager.getFile(fileId);
    
    if (!file) {
      return this.telegram.sendMessage(chatId, "File not found.");
    }
    
    // Check permissions
    if (!this.isAdmin(userId) && file.savedBy !== userId) {
      return this.telegram.sendMessage(chatId, "You don't have permission to delete this file.");
    }
    
    // Ask for confirmation
    await this.sessionManager.setState(userId, 'awaiting_delete_confirm', { fileId });
    
    return this.telegram.sendMessage(
      chatId,
      `Are you sure you want to delete this file?\n\n` +
      `Type: ${this.getFileTypeEmoji(file.file_type)} ${file.file_type}\n` +
      `Caption: ${file.caption || 'None'}\n` +
      `Views: ${file.accessCount || 0}\n\n` +
      `Type *confirm* to delete or *cancel* to abort.`
    );
  }
  
  /**
   * Handle delete confirmation
   * @param {Object} message - User's confirmation message
   * @param {Object} session - User session
   * @returns {Promise<Object>} Response
   */
  async handleDeleteConfirmation(message, session) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text.trim().toLowerCase();
    const { fileId } = session.data;
    
    // Reset user state
    await this.sessionManager.setState(userId, 'idle');
    
    if (text === 'confirm') {
      const deleted = await this.fileManager.deleteFile(fileId, userId);
      
      if (deleted) {
        return this.telegram.sendMessage(chatId, "✅ File deleted successfully.");
      } else {
        return this.telegram.sendMessage(chatId, "❌ Failed to delete the file. Please try again later.");
      }
    } else {
      return this.telegram.sendMessage(chatId, "File deletion canceled.");
    }
  }
  
  /**
   * Handle /stats command
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} Response
   */
  async handleStats(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    // Only admins can see global stats
    if (!this.isAdmin(userId)) {
      // For regular users, show their personal stats
      const userFiles = await this.fileManager.getUserFiles(userId);
      const session = await this.sessionManager.getSession(userId);
      
      const joinDate = new Date(session.createdAt).toLocaleDateString();
      const lastActive = new Date(session.lastActive).toLocaleDateString();
      
      return this.telegram.sendMessage(
        chatId,
        `📊 *Your Statistics*\n\n` +
        `Total Files: ${userFiles.length}\n` +
        `Joined: ${joinDate}\n` +
        `Last Active: ${lastActive}`
      );
    }
    
    // Admin gets full stats
    const stats = await this.analytics.getStats();
    const totalUsers = Object.keys(stats.users || {}).length;
    const totalActions = Object.values(stats.actions || {}).reduce((sum, count) => sum + count, 0);
    
    let popularFiles = [];
    const files = await this.db.listKeys(this.fileManager.filePrefix);
    
    for (const key of files.slice(0, 10)) { // Limit to avoid excessive processing
      const file = await this.db.get(key);
      if (file && file.accessCount) {
        popularFiles.push(file);
      }
    }
    
    // Sort by access count
    popularFiles.sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0));
    popularFiles = popularFiles.slice(0, 5); // Top 5
    
    let statsText = `📊 *Bot Statistics*\n\n` +
      `Total Users: ${totalUsers}\n` +
      `Total Actions: ${totalActions}\n\n`;
    
    if (popularFiles.length > 0) {
      statsText += `*Popular Files:*\n`;
      popularFiles.forEach((file, idx) => {
        const emoji = this.getFileTypeEmoji(file.file_type);
        statsText += `${idx + 1}. ${emoji} ${file.caption || 'Unnamed'} - ${file.accessCount || 0} views\n`;
      });
    }
    
    return this.telegram.sendMessage(chatId, statsText);
  }
  
  /**
   * Handle /cancel command
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} Response
   */
  async handleCancel(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    
    // Reset user state
    await this.sessionManager.setState(userId, 'idle');
    
    return this.telegram.sendMessage(chatId, "Current operation canceled.");
  }
  
  // Callback handlers
  
  /**
   * Handle file-related callbacks
   * @param {Object} query - Callback query
   * @param {Array} params - Callback parameters
   * @returns {Promise<Object>} Response
   */
  async handleFileCallback(query, params) {
    const [action, fileId] = params;
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);
    
    // Answer callback to remove loading indicator
    await this.telegram.answerCallbackQuery(query.id);
    
    switch (action) {
      case 'share':
        const file = await this.fileManager.getFile(fileId);
        if (!file) {
          return this.telegram.editMessageText(
            chatId,
            query.message.message_id,
            "This file no longer exists."
          );
        }
        
        const shareLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=post=${fileId}`;
        return this.telegram.sendMessage(
          chatId,
          `🔗 *File Sharing Link*\n\n` +
          `Share this link to give access to your file:\n` +
          `\`${shareLink}\``
        );
        
      case 'delete':
        return this.handleDeleteCallback(query, [fileId]);
        
      case 'list':
        const page = parseInt(params[1]) || 1;
        const files = await this.fileManager.getUserFiles(userId);
        
        if (files.length === 0) {
          return this.telegram.editMessageText(
            chatId,
            query.message.message_id,
            "You don't have any saved files."
          );
        }
        
        const pageSize = 5;
        const totalPages = Math.ceil(files.length / pageSize);
        
        // Edit the message with the new page
        const startIdx = (page - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, files.length);
        const pageFiles = files.slice(startIdx, endIdx);
        
        let messageText = `📂 *Your Files* (${files.length} total) - Page ${page}/${totalPages}\n\n`;
        
        pageFiles.forEach((file, idx) => {
          const fileEmoji = this.getFileTypeEmoji(file.file_type);
          const fileDate = new Date(file.createdAt).toLocaleDateString();
          
          messageText += `${startIdx + idx + 1}. ${fileEmoji} *${file.file_type}* - ${fileDate}\n`;
          if (file.caption) {
            messageText += `   Caption: ${file.caption.substring(0, 30)}${file.caption.length > 30 ? '...' : ''}\n`;
          }
          messageText += `   Views: ${file.accessCount || 0}\n\n`;
        });
        
        // Navigation buttons
        const keyboard = [];
        
        // File action buttons
        pageFiles.forEach((file, idx) => {
          keyboard.push([
            { text: `📤 Share #${startIdx + idx + 1}`, callback_data: `file:share:${file.id}` },
            { text: `❌ Delete #${startIdx + idx + 1}`, callback_data: `file:delete:${file.id}` }
          ]);
        });
        
        // Pagination buttons
        const paginationRow = [];
        if (page > 1) {
          paginationRow.push({ text: "⬅️ Previous", callback_data: `page:files:${page - 1}` });
        }
        if (page < totalPages) {
          paginationRow.push({ text: "➡️ Next", callback_data: `page:files:${page + 1}` });
        }
        
        if (paginationRow.length > 0) {
          keyboard.push(paginationRow);
        }
        
        return this.telegram.editMessageText(
          chatId,
          query.message.message_id,
          messageText,
          { 
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: keyboard }
          }
        );
        
      default:
        return this.telegram.answerCallbackQuery(
          query.id,
          "Unknown file action."
        );
    }
  }
  
  /**
   * Handle page navigation callbacks
   * @param {Object} query - Callback query
   * @param {Array} params - Callback parameters
   * @returns {Promise<Object>} Response
   */
  async handlePageCallback(query, params) {
    const [listType, pageStr] = params;
    const page = parseInt(pageStr);
    
    if (isNaN(page) || page < 1) {
      return this.telegram.answerCallbackQuery(
        query.id,
        "Invalid page number."
      );
    }
    
    // Answer callback to remove loading indicator
    await this.telegram.answerCallbackQuery(query.id);
    
    switch (listType) {
      case 'files':
        // Re-use the file list callback
        return this.handleFileCallback(query, ['list', page.toString()]);
        
      default:
        return this.telegram.answerCallbackQuery(
          query.id,
          "Unknown list type."
        );
    }
  }
  
  /**
   * Handle category selection callbacks
   * @param {Object} query - Callback query
   * @param {Array} params - Callback parameters
   * @returns {Promise<Object>} Response
   */
  async handleCategoryCallback(query, params) {
    const category = params[0];
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);
    const messageId = query.message.message_id;
    
    // Get user session
    const session = await this.sessionManager.getSession(userId);
    
    if (session.state !== 'awaiting_file_category') {
      return this.telegram.answerCallbackQuery(
        query.id,
        "This action is no longer valid."
      );
    }
    
    // Answer callback to remove loading indicator
    await this.telegram.answerCallbackQuery(query.id);
    
    // Handle cancellation
    if (category === 'cancel') {
      await this.sessionManager.setState(userId, 'idle');
      return this.telegram.editMessageText(
        chatId,
        messageId,
        "File saving canceled."
      );
    }
    
    const { fileData } = session.data;
    
    // Save the file with the selected category
    const fileId = await this.fileManager.saveFile(fileData, userId, category);
    
    // Reset user state
    await this.sessionManager.setState(userId, 'idle');
    
    // Construct the shareable link
    const shareLink = `https://t.me/${CONFIG.BOT_USERNAME}?start=post=${fileId}`;
    
    return this.telegram.editMessageText(
      chatId,
      messageId,
      `✅ *File Saved Successfully!*\n\n` +
      `📂 Category: *${category}*\n` +
      `📁 Access it using:\n` +
      `\`${shareLink}\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔗 Copy Link", callback_data: `file:share:${fileId}` }]
          ]
        }
      }
    );
  }
  
  /**
   * Handle delete confirmation callbacks
   * @param {Object} query - Callback query
   * @param {Array} params - Callback parameters
   * @returns {Promise<Object>} Response
   */
  async handleDeleteCallback(query, params) {
    const fileId = params[0];
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);
    const messageId = query.message.message_id;
    
    // Answer callback to remove loading indicator
    await this.telegram.answerCallbackQuery(query.id);
    
    const file = await this.fileManager.getFile(fileId);
    
    if (!file) {
      return this.telegram.editMessageText(
        chatId,
        messageId,
        "This file no longer exists."
      );
    }
    
    // Check permissions
    if (!this.isAdmin(userId) && file.savedBy !== userId) {
      return this.telegram.sendMessage(
        chatId,
        "You don't have permission to delete this file."
      );
    }
    
    // Show confirmation dialog
    return this.telegram.editMessageText(
      chatId,
      messageId,
      `Are you sure you want to delete this file?\n\n` +
      `Type: ${this.getFileTypeEmoji(file.file_type)} ${file.file_type}\n` +
      `Caption: ${file.caption || 'None'}\n` +
      `Views: ${file.accessCount || 0}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, delete it", callback_data: `confirm:delete:${fileId}` },
              { text: "❌ No, keep it", callback_data: "confirm:cancel" }
            ]
          ]
        }
      }
    );
  }
  
  /**
   * Handle confirmation action callbacks
   * @param {Object} query - Callback query
   * @param {Array} params - Callback parameters
   * @returns {Promise<Object>} Response
   */
  async handleConfirmCallback(query, params) {
    const [action, ...actionParams] = params;
    const chatId = query.message.chat.id;
    const userId = String(query.from.id);
    const messageId = query.message.message_id;
    
    // Answer callback to remove loading indicator
    await this.telegram.answerCallbackQuery(query.id);
    
    switch (action) {
      case 'delete':
        const fileId = actionParams[0];
        const deleted = await this.fileManager.deleteFile(fileId, userId);
        
        if (deleted) {
          return this.telegram.editMessageText(
            chatId,
            messageId,
            "✅ File deleted successfully."
          );
        } else {
          return this.telegram.editMessageText(
            chatId,
            messageId,
            "❌ Failed to delete the file. Please try again later."
          );
        }
        
      case 'cancel':
        return this.telegram.editMessageText(
          chatId,
          messageId,
          "Action canceled."
        );
        
      default:
        return this.telegram.editMessageText(
          chatId,
          messageId,
          "Unknown confirmation action."
        );
    }
  }
}

// Main bot class that ties everything together
class TelegramBot {
  constructor(env) {
    this.db = new Database(env.FILE_STORE);
    this.telegram = new TelegramAPI(CONFIG.BOT_TOKEN);
    this.analytics = new Analytics(this.db);
    this.sessionManager = new SessionManager(this.db);
    this.fileManager = new FileManager(this.db);
    this.commandHandler = new CommandHandler(
      this,
      this.db,
      this.telegram,
      this.fileManager,
      this.sessionManager,
      this.analytics
    );
  }
  
  /**
   * Process an incoming update from Telegram
   * @param {Object} update - Telegram update object
   * @returns {Promise<Object|null>} Response or null
   */
  async processUpdate(update) {
    try {
      // Handle different types of updates
      if (update.message) {
        return this.commandHandler.processMessage(update.message);
      }
      
      if (update.callback_query) {
        return this.commandHandler.processCallbackQuery(update.callback_query);
      }
      
      // Other update types can be handled here
      
      // Unhandled update type
      return null;
    } catch (error) {
      Utils.log(`Error processing update: ${error.message}`, "error", { update });
      
      // Try to notify user if possible
      if (update.message) {
        return this.telegram.sendMessage(
          update.message.chat.id,
          "Sorry, an error occurred while processing your request."
        );
      }
      
      if (update.callback_query) {
        return this.telegram.answerCallbackQuery(
          update.callback_query.id,
          "Sorry, an error occurred while processing your request."
        );
      }
      
      // If we can't notify the user, just return null
      return null;
    }
  }
}

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
      Utils.log(`Invalid JSON: ${error.message}`, "error");
      return new Response("Invalid Request Body", { status: 400 });
    }
    
    // Initialize the bot and process the update
    const bot = new TelegramBot(env);
    await bot.processUpdate(update);
    
    // Always return 200 OK to Telegram
    return new Response("OK");
  }
}
