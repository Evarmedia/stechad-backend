// config/gcpStorage.js
const { Storage } = require('@google-cloud/storage');

// If you prefer env var auth, omit keyFilename and rely on GOOGLE_APPLICATION_CREDENTIALS
const storage = new Storage({
   keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const bucketName = process.env.GCS_BUCKET_NAME || 'stechad_engr_platform';
const bucket = storage.bucket(bucketName);

// helper: generate a V4 signed URL (READ)
async function getV4ReadSignedUrl(objectName, expiresInSeconds = 7 * 24 * 3600) {
  const [url] = await bucket.file(objectName).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

module.exports = { storage, bucket, bucketName, getV4ReadSignedUrl };
