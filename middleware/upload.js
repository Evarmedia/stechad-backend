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
  } else if (file.fieldname === "receipt") {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      return cb(null, true);
    }
    return cb(new Error("Only image or PDF files are allowed for receipts"), false);
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
  const organizationId = require('../services/tenantContext').peekTenantContext()?.organizationId;
  const prefix = organizationId ? `organizations/${organizationId}/` : '';
  return `${prefix}${folder}/${userId}__${ts}__${rand}${base ? "__" + base : ""}${ext}`;
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
  const context = require('../services/tenantContext').peekTenantContext();
  if (context && context.userId !== userId) throw Object.assign(new Error('Uploads must belong to the authenticated member'), { status: 403 });
  if (!context && process.env.TENANCY_ENFORCED === 'true') throw Object.assign(new Error('Organization context is required for uploads'), { status: 403 });
  if (context) await require('../services/tenantContext').revalidateTenantContext(context);

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
  await require('../services/fileAccess').registerFile(objectName, userId, folderName);
  const signedUrl = await getV4ReadSignedUrl(objectName, signedUrlTTLSeconds);
  return { objectName, signedUrl };
}

// Delete by objectName (path inside bucket)
async function deleteFromGCP(objectName) {
  await require('../services/fileAccess').assertFileOwnership(objectName, { write: true });
  await bucket.file(objectName).delete({ ignoreNotFound: false });
  return true;
}

module.exports = { upload, uploadToGCP, deleteFromGCP };
