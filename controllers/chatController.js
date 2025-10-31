const { Chat, Message, User } = require('../models');
const { 
  createChat, 
  getUserChats, 
  sendMessage, 
  getChatMessages, 
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  searchMessages
} = require('../utils/chatUtil');

// Get user's chats
const getChats = async (req, res) => {
  try {
    const { page = 1, limit = 20, chat_type } = req.query;
    
    const chats = await getUserChats(req.user.user_id, {
      page,
      limit,
      chat_type
    });
    
    res.json({
      success: true,
      data: chats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get chats',
      error: error.message
    });
  }
};

// Create new chat
const createNewChat = async (req, res) => {
  try {
    const { participant_ids, chat_type = 'direct', chat_name } = req.body;
    
    // Add current user to participants if not included
    const participants = [...new Set([req.user.user_id, ...participant_ids])];
    
    const chat = await createChat(participants, req.user.user_id, chat_type, chat_name);
    
    res.status(201).json({
      success: true,
      message: 'Chat created successfully',
      data: chat
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create chat',
      error: error.message
    });
  }
};

// Get chat messages
const getMessages = async (req, res) => {
  try {
    const { chat_id } = req.params;
    const { page = 1, limit = 50, before_timestamp } = req.query;
    
    const messages = await getChatMessages(chat_id, req.user.user_id, {
      page,
      limit,
      before_timestamp
    });
    
    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message
    });
  }
};

// Send message (also handled via WebSocket)
const sendChatMessage = async (req, res) => {
  try {
    const { chat_id } = req.params;
    const { content, message_type = 'text', attachments = [], reply_to } = req.body;
    
    const message = await sendMessage(
      chat_id, 
      req.user.user_id, 
      content, 
      message_type, 
      attachments, 
      reply_to
    );
    
    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Mark messages as read
const markAsRead = async (req, res) => {
  try {
    const { chat_id } = req.params;
    const { message_ids = [] } = req.body;
    
    await markMessagesAsRead(chat_id, req.user.user_id, message_ids);
    
    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: error.message
    });
  }
};

// Edit message
const editChatMessage = async (req, res) => {
  try {
    const { message_id } = req.params;
    const { content } = req.body;
    
    const message = await editMessage(message_id, req.user.user_id, content);
    
    res.json({
      success: true,
      message: 'Message edited successfully',
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to edit message',
      error: error.message
    });
  }
};

// Delete message
const deleteChatMessage = async (req, res) => {
  try {
    const { message_id } = req.params;
    
    const message = await deleteMessage(message_id, req.user.user_id);
    
    res.json({
      success: true,
      message: 'Message deleted successfully',
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: error.message
    });
  }
};

// Search messages
const searchChatMessages = async (req, res) => {
  try {
    const { query, page = 1, limit = 20, chat_id } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }
    
    const results = await searchMessages(req.user.user_id, query, {
      page,
      limit,
      chat_id
    });
    
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to search messages',
      error: error.message
    });
  }
};

// Get chat details
const getChatDetails = async (req, res) => {
  try {
    const { chat_id } = req.params;
    
    const chat = await Chat.findOne({
      where: { 
        chats_id: chat_id,
        participants: {
          [require('sequelize').Op.contains]: [req.user.user_id]
        }
      }
    });
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }
    
    // Get participant details
    const participants = await User.findAll({
      where: {
        user_id: {
          [require('sequelize').Op.in]: chat.participants
        }
      },
      attributes: ['user_id', 'first_name', 'last_name', 'avatar_url', 'role']
    });
    
    const chatData = chat.toJSON();
    chatData.participant_details = participants;
    chatData.unread_count = chatData.unread_counts[req.user.user_id] || 0;
    
    res.json({
      success: true,
      data: chatData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get chat details',
      error: error.message
    });
  }
};

module.exports = {
  getChats,
  createNewChat,
  getMessages,
  sendChatMessage,
  markAsRead,
  editChatMessage,
  deleteChatMessage,
  searchChatMessages,
  getChatDetails
};