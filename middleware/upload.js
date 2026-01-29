// middleware/upload.js
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { bucket, getV4ReadSignedUrl } = require("../config/gcpStorage");

// ---------- fileFilter (yours, kept) ----------
const fileFilter = (req, file, cb) => {
  if (file.fieldname === "resume" || file.fieldname === "cv" || file.fieldname === "cv_file") {
      if (file.mimetype === "application/pdf") return cb(null, true);
      return cb(new Error("Only PDF files are allowed for resumes/CVs"), false);
  } else if (file.fieldname === "avatar") {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new Error("Only image files are allowed for avatars"), false);
  }
  return cb(new Error("Invalid file field"), false);
};

// ---------- storage & limits ----------
const multerStorage = multer.memoryStorage();
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter,
});

// Build a safe, unique object name: <folder>/<userId>__<ts>__<rand>.<ext>
function buildObjectName(folder, userId, originalname) {
  const ts = Date.now();
  const ext = path.extname(originalname || "").toLowerCase();
  const base = path
    .basename(originalname || "", ext)
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 30);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${folder}/${userId}__${ts}__${rand}${base ? "__" + base : ""}${ext}`;
}

// Upload buffer to GCS, return { objectName, signedUrl }
async function uploadToGCP(
  file,
  userId,
  folderName,
  signedUrlTTLSeconds = 7 * 24 * 3600
) {
  if (!file) throw new Error("No file buffer provided");
  if (!userId) throw new Error("userId required for naming");

  const objectName = buildObjectName(folderName, userId, file.originalname);
  const gcsFile = bucket.file(objectName);

  await new Promise((resolve, reject) => {
    const stream = gcsFile.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
      metadata: {
        contentType: file.mimetype,
        // You can add cacheControl if desired:
        // cacheControl: 'public, max-age=3600',
      },
    });
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(file.buffer);
  });

  // With UBLA, do NOT call makePublic(). Use a signed URL:
  const signedUrl = await getV4ReadSignedUrl(objectName, signedUrlTTLSeconds);
  return { objectName, signedUrl };
}

// Delete by objectName (path inside bucket)
async function deleteFromGCP(objectName) {
  await bucket.file(objectName).delete({ ignoreNotFound: false });
  return true;
}

module.exports = { upload, uploadToGCP, deleteFromGCP };
