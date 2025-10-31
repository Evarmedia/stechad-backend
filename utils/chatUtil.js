const { Chat, Message, User } = require('../models');
const { Op } = require('sequelize');

/**
 * Create a new chat between users
 * @param {Array} participantIds - Array of user IDs
 * @param {string} createdBy - ID of user creating the chat
 * @param {string} chatType - Type of chat (direct, group, support)
 * @param {string} chatName - Name of the chat (optional for direct chats)
 * @returns {Promise<Object>} The created chat
 */
const createChat = async (participantIds, createdBy, chatType = 'direct', chatName = null) => {
  try {
    // Validate participants
    if (!Array.isArray(participantIds) || participantIds.length < 2) {
      throw new Error('At least 2 participants are required');
    }

    // Check if direct chat already exists between these users
    if (chatType === 'direct' && participantIds.length === 2) {
      const existingChat = await Chat.findOne({
        where: {
          chat_type: 'direct',
          participants: {
            [Op.contains]: participantIds
          },
          is_active: true
        }
      });

      if (existingChat) {
        return existingChat;
      }
    }

    // Initialize unread counts for all participants
    const unreadCounts = {};
    participantIds.forEach(id => {
      unreadCounts[id] = 0;
    });

    const chat = await Chat.create({
      chat_type: chatType,
      chat_name: chatName,
      participants: participantIds,
      unread_counts: unreadCounts,
      created_by: createdBy,
      is_active: true
    });

    return chat;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw error;
  }
};

/**
 * Get user's chats with pagination
 * @param {string} userId - The user's ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated chats
 */
const getUserChats = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      chat_type
    } = options;

    const offset = (page - 1) * limit;
    let where = {
      participants: {
        [Op.contains]: [userId]
      },
      is_active: true
    };

    if (chat_type) {
      where.chat_type = chat_type;
    }

    const chats = await Chat.findAndCountAll({
      where,
      include: [
        {
          model: Message,
          as: 'messages',
          limit: 1,
          order: [['timestamp', 'DESC']],
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['first_name', 'last_name', 'avatar_url']
            }
          ]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['updated_at', 'DESC']]
    });

    // Get participant details for each chat
    const chatsWithParticipants = await Promise.all(
      chats.rows.map(async (chat) => {
        const participants = await User.findAll({
          where: {
            user_id: {
              [Op.in]: chat.participants
            }
          },
          attributes: ['user_id', 'first_name', 'last_name', 'avatar_url', 'role']
        });

        const chatData = chat.toJSON();
        chatData.participant_details = participants;
        chatData.unread_count = chatData.unread_counts[userId] || 0;

        return chatData;
      })
    );

    return {
      chats: chatsWithParticipants,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(chats.count / limit),
        totalItems: chats.count,
        itemsPerPage: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error getting user chats:', error);
    throw error;
  }
};

/**
 * Send a message in a chat
 * @param {string} chatId - The chat ID
 * @param {string} senderId - The sender's user ID
 * @param {string} content - The message content
 * @param {string} messageType - Type of message (text, image, file, system)
 * @param {Array} attachments - Array of attachment objects
 * @param {string} replyTo - ID of message being replied to
 * @returns {Promise<Object>} The created message
 */
const sendMessage = async (chatId, senderId, content, messageType = 'text', attachments = [], replyTo = null) => {
  try {
    // Verify chat exists and user is participant
    const chat = await Chat.findByPk(chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }

    if (!chat.participants.includes(senderId)) {
      throw new Error('User is not a participant in this chat');
    }

    // Create the message
    const message = await Message.create({
      chat_id: chatId,
      sender_id: senderId,
      message_type: messageType,
      content,
      attachments,
      reply_to: replyTo,
      timestamp: new Date()
    });

    // Update chat's last message info
    await chat.update({
      last_message_id: message.messages_id,
      last_message_content: content,
      last_message_sender_id: senderId,
      last_message_timestamp: message.timestamp,
      updated_at: new Date()
    });

    // Update unread counts for other participants
    const updatedUnreadCounts = { ...chat.unread_counts };
    chat.participants.forEach(participantId => {
      if (participantId !== senderId) {
        updatedUnreadCounts[participantId] = (updatedUnreadCounts[participantId] || 0) + 1;
      }
    });

    await chat.update({ unread_counts: updatedUnreadCounts });

    // Get message with sender details
    const messageWithSender = await Message.findByPk(message.messages_id, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['user_id', 'first_name', 'last_name', 'avatar_url']
        },
        {
          model: Message,
          as: 'replyToMessage',
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['first_name', 'last_name']
            }
          ]
        }
      ]
    });

    return messageWithSender;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
};

/**
 * Get messages in a chat with pagination
 * @param {string} chatId - The chat ID
 * @param {string} userId - The requesting user's ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated messages
 */
const getChatMessages = async (chatId, userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 50,
      before_timestamp
    } = options;

    // Verify user is participant
    const chat = await Chat.findByPk(chatId);
    if (!chat || !chat.participants.includes(userId)) {
      throw new Error('Chat not found or access denied');
    }

    const offset = (page - 1) * limit;
    let where = {
      chat_id: chatId,
      is_deleted: false
    };

    if (before_timestamp) {
      where.timestamp = {
        [Op.lt]: new Date(before_timestamp)
      };
    }

    const messages = await Message.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['user_id', 'first_name', 'last_name', 'avatar_url']
        },
        {
          model: Message,
          as: 'replyToMessage',
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['first_name', 'last_name']
            }
          ]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });

    return {
      messages: messages.rows.reverse(), // Reverse to show oldest first
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(messages.count / limit),
        totalItems: messages.count,
        itemsPerPage: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error getting chat messages:', error);
    throw error;
  }
};

/**
 * Mark messages as read
 * @param {string} chatId - The chat ID
 * @param {string} userId - The user's ID
 * @param {Array} messageIds - Array of message IDs to mark as read
 * @returns {Promise<Object>} Updated chat
 */
const markMessagesAsRead = async (chatId, userId, messageIds = []) => {
  try {
    const chat = await Chat.findByPk(chatId);
    if (!chat || !chat.participants.includes(userId)) {
      throw new Error('Chat not found or access denied');
    }

    // If no specific messages provided, mark all as read
    if (messageIds.length === 0) {
      // Reset unread count for this user
      const updatedUnreadCounts = { ...chat.unread_counts };
      updatedUnreadCounts[userId] = 0;
      
      await chat.update({ unread_counts: updatedUnreadCounts });
    } else {
      // Mark specific messages as read
      await Message.update(
        {
          read_by: sequelize.fn(
            'jsonb_set',
            sequelize.col('read_by'),
            `{${userId}}`,
            JSON.stringify(new Date()),
            true
          )
        },
        {
          where: {
            messages_id: {
              [Op.in]: messageIds
            },
            chat_id: chatId
          }
        }
      );
    }

    return chat;
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw error;
  }
};

/**
 * Edit a message
 * @param {string} messageId - The message ID
 * @param {string} userId - The user's ID
 * @param {string} newContent - The new message content
 * @returns {Promise<Object>} Updated message
 */
const editMessage = async (messageId, userId, newContent) => {
  try {
    const message = await Message.findByPk(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new Error('Only the sender can edit this message');
    }

    await message.update({
      content: newContent,
      is_edited: true,
      edited_at: new Date()
    });

    return message;
  } catch (error) {
    console.error('Error editing message:', error);
    throw error;
  }
};

/**
 * Delete a message
 * @param {string} messageId - The message ID
 * @param {string} userId - The user's ID
 * @returns {Promise<Object>} Updated message
 */
const deleteMessage = async (messageId, userId) => {
  try {
    const message = await Message.findByPk(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new Error('Only the sender can delete this message');
    }

    await message.update({
      content: 'This message was deleted',
      is_deleted: true,
      deleted_at: new Date()
    });

    return message;
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
};

/**
 * Search messages in chats
 * @param {string} userId - The user's ID
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results
 */
const searchMessages = async (userId, query, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      chat_id
    } = options;

    const offset = (page - 1) * limit;
    let where = {
      content: {
        [Op.iLike]: `%${query}%`
      },
      is_deleted: false
    };

    // Get user's chats first
    const userChats = await Chat.findAll({
      where: {
        participants: {
          [Op.contains]: [userId]
        },
        is_active: true
      },
      attributes: ['chats_id']
    });

    const chatIds = userChats.map(chat => chat.chats_id);
    where.chat_id = {
      [Op.in]: chatIds
    };

    if (chat_id) {
      where.chat_id = chat_id;
    }

    const messages = await Message.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['first_name', 'last_name', 'avatar_url']
        },
        {
          model: Chat,
          as: 'chat',
          attributes: ['chats_id', 'chat_name', 'chat_type']
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });

    return {
      messages: messages.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(messages.count / limit),
        totalItems: messages.count,
        itemsPerPage: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error searching messages:', error);
    throw error;
  }
};

module.exports = {
  createChat,
  getUserChats,
  sendMessage,
  getChatMessages,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  searchMessages
};