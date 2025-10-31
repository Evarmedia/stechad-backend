const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Real-time chat system endpoints
 */

const { authenticate } = require('../middleware/auth');
const {
  getChats,
  createNewChat,
  getMessages,
  sendChatMessage,
  markAsRead,
  editChatMessage,
  deleteChatMessage,
  searchChatMessages,
  getChatDetails
} = require('../controllers/chatController');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /chat:
 *   get:
 *     summary: Get user's chats
 *     tags: [Chat]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: chat_type
 *         schema:
 *           type: string
 *           enum: [direct, group, support]
 *     responses:
 *       200:
 *         description: Chats retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     chats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           chats_id:
 *                             type: string
 *                           chat_type:
 *                             type: string
 *                           chat_name:
 *                             type: string
 *                           participants:
 *                             type: array
 *                             items:
 *                               type: string
 *                           unread_count:
 *                             type: integer
 *                           last_message_content:
 *                             type: string
 *                           last_message_timestamp:
 *                             type: string
 *                           participant_details:
 *                             type: array
 *                             items:
 *                               type: object
 *                     pagination:
 *                       type: object
 */
router.get('/', getChats);

/**
 * @swagger
 * /chat:
 *   post:
 *     summary: Create new chat
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participant_ids
 *             properties:
 *               participant_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["user-id-1", "user-id-2"]
 *               chat_type:
 *                 type: string
 *                 enum: [direct, group, support]
 *                 default: direct
 *               chat_name:
 *                 type: string
 *                 example: "Project Discussion"
 *     responses:
 *       201:
 *         description: Chat created successfully
 *       400:
 *         description: Invalid participants or chat already exists
 */
router.post('/', createNewChat);

/**
 * @swagger
 * /chat/{chat_id}:
 *   get:
 *     summary: Get chat details
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: chat_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chat details retrieved successfully
 *       404:
 *         description: Chat not found or access denied
 */
router.get('/:chat_id', getChatDetails);

/**
 * @swagger
 * /chat/{chat_id}/messages:
 *   get:
 *     summary: Get chat messages
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: chat_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: before_timestamp
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
 *       404:
 *         description: Chat not found or access denied
 */
router.get('/:chat_id/messages', getMessages);

/**
 * @swagger
 * /chat/{chat_id}/messages:
 *   post:
 *     summary: Send message to chat
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: chat_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Hello, how are you?"
 *               message_type:
 *                 type: string
 *                 enum: [text, image, file, system]
 *                 default: text
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *               reply_to:
 *                 type: string
 *                 description: Message ID being replied to
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       404:
 *         description: Chat not found or access denied
 */
router.post('/:chat_id/messages', sendChatMessage);

/**
 * @swagger
 * /chat/{chat_id}/read:
 *   post:
 *     summary: Mark messages as read
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: chat_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Specific message IDs to mark as read (optional)
 *     responses:
 *       200:
 *         description: Messages marked as read successfully
 */
router.post('/:chat_id/read', markAsRead);

/**
 * @swagger
 * /chat/messages/{message_id}:
 *   put:
 *     summary: Edit message
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: message_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Updated message content"
 *     responses:
 *       200:
 *         description: Message edited successfully
 *       403:
 *         description: Only sender can edit message
 *       404:
 *         description: Message not found
 */
router.put('/messages/:message_id', editChatMessage);

/**
 * @swagger
 * /chat/messages/{message_id}:
 *   delete:
 *     summary: Delete message
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: message_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message deleted successfully
 *       403:
 *         description: Only sender can delete message
 *       404:
 *         description: Message not found
 */
router.delete('/messages/:message_id', deleteChatMessage);

/**
 * @swagger
 * /chat/search:
 *   get:
 *     summary: Search messages
 *     tags: [Chat]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (minimum 2 characters)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: chat_id
 *         schema:
 *           type: string
 *         description: Search within specific chat
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *       400:
 *         description: Query too short
 */
router.get('/search', searchChatMessages);

module.exports = router;