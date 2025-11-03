const express = require("express");
/**
 * @swagger
 * tags:
 *   name: File Upload
 *   description: File upload endpoints for resumes, avatars, and other documents
 */

const { authenticate } = require("../middleware/auth");
const router = express.Router();
const { upload, uploadToGCP, deleteFromGCP } = require("../middleware/upload");

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /upload/resume:
 *   post:
 *     summary: Upload engineer resume (PDF only)
 *     tags: [File Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               resume:
 *                 type: string
 *                 format: binary
 *                 description: PDF file containing the engineer's resume
 *     responses:
 *       200:
 *         description: Resume uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Resume uploaded successfully
 *                 data:
 *                   $ref: '#/components/schemas/FileUpload'
 *       400:
 *         description: No file uploaded or invalid file type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Endpoint to upload a resume
router.post("/resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No resume uploaded" });
    const userId = req.body.user_id || req.user?.user_id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "Please Login" });

    const { objectName, signedUrl } = await uploadToGCP(
      req.file,
      userId,
      "resumes"
    );
    res
      .status(200)
      .json({
        success: true,
        message: "Resume uploaded",
        data: { objectName, url: signedUrl },
      });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "File upload failed",
        error: error.message,
      });
  }
});

/**
 * @swagger
 * /upload/avatar:
 *   post:
 *     summary: Upload user profile picture (images only)
 *     tags: [File Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Image file for user's profile picture
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Avatar uploaded successfully
 *                 data:
 *                   $ref: '#/components/schemas/FileUpload'
 *       400:
 *         description: No file uploaded or invalid file type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Endpoint to upload a profile image (avatar)
router.post("/avatar", upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No avatar uploaded" });
    const userId = req.body.user_id || req.user?.user_id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "user_id required" });

    const { objectName, signedUrl } = await uploadToGCP(
      req.file,
      userId,
      "profile-images"
    );
    res
      .status(200)
      .json({
        success: true,
        message: "Avatar uploaded",
        data: { objectName, url: signedUrl },
      });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "File upload failed",
        error: error.message,
      });
  }
});

/**
 * @swagger
 * /upload/delete-file:
 *   delete:
 *     summary: Delete an uploaded file (owner only)
 *     tags: [File Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - fileName
 *               - folderName
 *             properties:
 *               user_id:
 *                 type: string
 *                 description: The ID of the user who owns the file
 *                 example: "12345"
 *               fileName:
 *                 type: string
 *                 description: The name of the file to delete (including file extension)
 *                 example: "resume.pdf"
 *               folderName:
 *                 type: string
 *                 description: The folder where the file is stored in Google Cloud Storage (e.g., "resumes", "profile-images")
 *                 example: "resumes"
 *     responses:
 *       200:
 *         description: File deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: 'File deleted successfully'
 *       400:
 *         description: Missing required parameters (user_id, fileName, folderName)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: File not found in the specified folder
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Not authorized to delete this file (user is not the owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: File deletion failed due to an internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Endpoint to delete a file from Google Cloud Storage
router.delete("/delete-file", async (req, res) => {
  const { user_id, fileName, folderName } = req.body;

  try {
    if (!fileName || !folderName) {
      return res.status(400).json({
        success: false,
        message: "File name and folder name are required to delete the file.",
      });
    }

    // Construct the file path in the bucket
    const filePath = `${folderName}/${user_id}_${fileName}`;

    // Get a reference to the file in the bucket
    const file = bucket.file(filePath);

    // Delete the file from the bucket
    await file.delete();

    res.status(200).json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to delete file",
      error: error.message,
    });
  }
});

module.exports = router;
