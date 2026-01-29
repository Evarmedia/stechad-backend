const { Storage } = require("@google-cloud/storage");

// Initialize credentials as null
let credentials = null;
let keyFilename = null;

// Conditionally assign credentials based on the environment
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (process.env.NODE_ENV === "production") {
    // In production, parse the JSON string stored in the environment variable
    credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  } else {
    // In development, use the path to the credentials file
    keyFilename = "./config/googleServiceKey.json";
  }
}

// Create the Storage client based on credentials or keyFilename (if available)
const storage = credentials
  ? new Storage({ credentials }) // Use credentials object for production
  : new Storage({ keyFilename }); // Use file path for development

// Get the bucket name from the environment, default to 'stechad_engr_platform'
const bucketName = process.env.GCS_BUCKET_NAME || "stechad_engr_platform";
const bucket = storage.bucket(bucketName);

// Helper function to generate a V4 signed URL (for READ access)
async function getV4ReadSignedUrl(
  objectName,
  expiresInSeconds = 7 * 24 * 3600,
) {
  const [url] = await bucket.file(objectName).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

module.exports = { storage, bucket, bucketName, getV4ReadSignedUrl };
