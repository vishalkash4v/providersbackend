const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const path = require('path');
const crypto = require('crypto');

const R2StorageUsage =
  require('../models/R2StorageUsage');

// ============================================================
// R2 CONFIG
// ============================================================

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID;

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID;

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY;

const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME;

const R2_ENDPOINT =
  process.env.R2_ENDPOINT;

const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL;

// ============================================================
// APPLICATION STORAGE LIMIT
//
// Default = 8 GB
//
// You can change this from .env
// ============================================================

const R2_STORAGE_LIMIT_GB =
  Number(
    process.env.R2_APP_STORAGE_LIMIT_GB || 8
  );

const R2_STORAGE_LIMIT_BYTES =
  R2_STORAGE_LIMIT_GB *
  1024 *
  1024 *
  1024;

// ============================================================
// R2 CLIENT
// ============================================================

const r2 = new S3Client({
  region: 'auto',

  endpoint: R2_ENDPOINT,

  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey:
      R2_SECRET_ACCESS_KEY,
  },
});

// ============================================================
// GET CURRENT MONTH
// ============================================================

function getCurrentMonth() {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, '0')}`;
}

// ============================================================
// GET / CREATE MONTHLY USAGE
// ============================================================

async function getStorageUsage() {
  const month =
    getCurrentMonth();

  let usage =
    await R2StorageUsage.findOne({
      month,
    });

  if (!usage) {
    usage =
      await R2StorageUsage.create({
        month,
        usedBytes: 0,
        limitBytes:
          R2_STORAGE_LIMIT_BYTES,
      });
  }

  return usage;
}

// ============================================================
// CHECK STORAGE LIMIT
// ============================================================

async function checkStorageLimit(
  fileSize
) {
  const usage =
    await getStorageUsage();

  const newTotal =
    usage.usedBytes + fileSize;

  if (
    newTotal >
    R2_STORAGE_LIMIT_BYTES
  ) {
    const error =
      new Error(
        'R2 application storage limit reached. Please upgrade R2 storage.'
      );

    error.code =
      'R2_STORAGE_LIMIT_REACHED';

    error.usedBytes =
      usage.usedBytes;

    error.fileSize =
      fileSize;

    error.limitBytes =
      R2_STORAGE_LIMIT_BYTES;

    throw error;
  }

  return usage;
}

// ============================================================
// INCREASE STORAGE USAGE
// ============================================================

async function increaseStorageUsage(
  fileSize
) {
  const month =
    getCurrentMonth();

  const usage =
    await R2StorageUsage.findOneAndUpdate(
      {
        month,
      },

      {
        $inc: {
          usedBytes: fileSize,
        },

        $setOnInsert: {
          limitBytes:
            R2_STORAGE_LIMIT_BYTES,
        },
      },

      {
        new: true,
        upsert: true,
      }
    );

  return usage;
}

// ============================================================
// DECREASE STORAGE USAGE
// ============================================================

async function decreaseStorageUsage(
  fileSize
) {
  if (!fileSize || fileSize <= 0) {
    return;
  }

  const month =
    getCurrentMonth();

  await R2StorageUsage.findOneAndUpdate(
    {
      month,
    },

    [
      {
        $set: {
          usedBytes: {
            $max: [
              {
                $subtract: [
                  '$usedBytes',
                  fileSize,
                ],
              },
              0,
            ],
          },
        },
      },
    ]
  );
}

// ============================================================
// GET UPLOADED FILES
// ============================================================

function getUploadedFiles(req) {
  if (!req.files) {
    return [];
  }

  const files = [];

  Object.keys(req.files).forEach(
    (fieldName) => {
      const fieldFiles =
        req.files[fieldName];

      if (Array.isArray(fieldFiles)) {
        fieldFiles.forEach((file) => {
          files.push({
            fieldName,
            file,
          });
        });
      } else {
        files.push({
          fieldName,
          file: fieldFiles,
        });
      }
    }
  );

  return files;
}

// ============================================================
// CREATE UNIQUE FILE NAME
// ============================================================

function createFileName(
  originalName
) {
  const extension =
    path.extname(originalName);

  return (
    `${Date.now()}-` +
    `${crypto.randomBytes(8).toString('hex')}` +
    extension
  );
}

// ============================================================
// NORMALIZE FOLDER
// ============================================================

function normalizeFolder(folder) {
  if (!folder) {
    return '';
  }

  return folder
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
}

// ============================================================
// UPLOAD ONE FILE TO R2
// ============================================================

async function uploadFileToR2(
  file,
  folder = ''
) {
  if (!file) {
    return null;
  }

  // ----------------------------------------------------------
  // CHECK STORAGE LIMIT BEFORE UPLOAD
  // ----------------------------------------------------------

  await checkStorageLimit(
    file.size
  );

  const cleanFolder =
    normalizeFolder(folder);

  const fileName =
    createFileName(file.name);

  const key = cleanFolder
    ? `${cleanFolder}/${fileName}`
    : fileName;

  try {
    // --------------------------------------------------------
    // UPLOAD TO R2
    // --------------------------------------------------------

    await r2.send(
      new PutObjectCommand({
        Bucket:
          R2_BUCKET_NAME,

        Key: key,

        Body: file.data,

        ContentType:
          file.mimetype ||
          'application/octet-stream',

        ContentLength:
          file.size,
      })
    );

    // --------------------------------------------------------
    // UPDATE USAGE ONLY AFTER SUCCESSFUL UPLOAD
    // --------------------------------------------------------

    await increaseStorageUsage(
      file.size
    );

  } catch (error) {
    console.error(
      'R2 Upload Error:',
      error
    );

    throw error;
  }

  // ----------------------------------------------------------
  // PUBLIC URL
  // ----------------------------------------------------------

  const publicBaseUrl =
    R2_PUBLIC_URL
      ? R2_PUBLIC_URL.replace(
          /\/+$/,
          ''
        )
      : null;

  const publicUrl =
    publicBaseUrl
      ? `${publicBaseUrl}/${key}`
      : null;

  return {
    originalName:
      file.name,

    fileName,

    key,

    path: publicUrl,

    size: file.size,

    mimetype:
      file.mimetype,

    bucket:
      R2_BUCKET_NAME,
  };
}

// ============================================================
// UPLOAD MULTIPLE FILES
// ============================================================

async function uploadFiles(
  req,
  uploadDir = 'uploads'
) {
  const uploadedFiles =
    getUploadedFiles(req);

  if (!uploadedFiles.length) {
    return [];
  }

  // ----------------------------------------------------------
  // CHECK TOTAL SIZE FIRST
  //
  // This prevents uploading file #1/#2 and then failing
  // halfway through a multi-file booking.
  // ----------------------------------------------------------

  const totalSize =
    uploadedFiles.reduce(
      (total, item) =>
        total +
        Number(item.file.size || 0),
      0
    );

  await checkStorageLimit(
    totalSize
  );

  const results = [];

  const uploadedR2Files = [];

  try {
    for (
      const item of uploadedFiles
    ) {
      const cleanFolder =
        normalizeFolder(
          uploadDir
        );

      const fileName =
        createFileName(
          item.file.name
        );

      const key =
        cleanFolder
          ? `${cleanFolder}/${fileName}`
          : fileName;

      await r2.send(
        new PutObjectCommand({
          Bucket:
            R2_BUCKET_NAME,

          Key: key,

          Body:
            item.file.data,

          ContentType:
            item.file.mimetype ||
            'application/octet-stream',

          ContentLength:
            item.file.size,
        })
      );

      uploadedR2Files.push({
        key,
        size:
          item.file.size,
      });

      const publicBaseUrl =
        R2_PUBLIC_URL
          ? R2_PUBLIC_URL.replace(
              /\/+$/,
              ''
            )
          : null;

      const publicUrl =
        publicBaseUrl
          ? `${publicBaseUrl}/${key}`
          : null;

      results.push({
        fieldName:
          item.fieldName,

        originalName:
          item.file.name,

        fileName,

        key,

        path:
          publicUrl,

        size:
          item.file.size,

        mimetype:
          item.file.mimetype,

        bucket:
          R2_BUCKET_NAME,
      });
    }

    // --------------------------------------------------------
    // UPDATE USAGE AFTER ALL FILES UPLOADED
    // --------------------------------------------------------

    await increaseStorageUsage(
      totalSize
    );

    return results;

  } catch (error) {

    // --------------------------------------------------------
    // CLEAN UP PARTIALLY UPLOADED FILES
    // --------------------------------------------------------

    for (
      const uploaded
      of uploadedR2Files
    ) {
      try {
        await r2.send(
          new DeleteObjectCommand({
            Bucket:
              R2_BUCKET_NAME,

            Key:
              uploaded.key,
          })
        );
      } catch (deleteError) {
        console.error(
          'R2 Rollback Delete Error:',
          deleteError
        );
      }
    }

    throw error;
  }
}

// ============================================================
// UPLOAD SINGLE FILE
// ============================================================

async function uploadSingleFile(
  req,
  fieldName,
  uploadDir = 'uploads'
) {
  if (
    !req.files ||
    !req.files[fieldName]
  ) {
    return null;
  }

  let file =
    req.files[fieldName];

  if (Array.isArray(file)) {
    file = file[0];
  }

  return await uploadFileToR2(
    file,
    uploadDir
  );
}

// ============================================================
// DELETE FILE FROM R2
// ============================================================

async function deleteFileFromR2(
  key,
  fileSize = 0
) {
  if (!key) {
    return false;
  }

  await r2.send(
    new DeleteObjectCommand({
      Bucket:
        R2_BUCKET_NAME,

      Key: key,
    })
  );

  // ----------------------------------------------------------
  // DECREASE OUR TRACKED USAGE
  // ----------------------------------------------------------

  if (fileSize > 0) {
    await decreaseStorageUsage(
      fileSize
    );
  }

  return true;
}

// ============================================================
// DELETE FILE USING URL
// ============================================================

async function deleteFileByUrl(
  fileUrl,
  fileSize = 0
) {
  if (!fileUrl) {
    return false;
  }

  const publicBaseUrl =
    R2_PUBLIC_URL
      ? R2_PUBLIC_URL.replace(
          /\/+$/,
          ''
        )
      : null;

  if (
    !publicBaseUrl ||
    !fileUrl.startsWith(
      `${publicBaseUrl}/`
    )
  ) {
    return false;
  }

  const key =
    fileUrl
      .replace(
        `${publicBaseUrl}/`,
        ''
      )
      .split('?')[0];

  return await deleteFileFromR2(
    key,
    fileSize
  );
}

// ============================================================
// STORAGE INFORMATION
// ============================================================

async function getStorageInfo() {
  const usage =
    await getStorageUsage();

  const usedBytes =
    usage.usedBytes;

  const limitBytes =
    R2_STORAGE_LIMIT_BYTES;

  const remainingBytes =
    Math.max(
      limitBytes -
        usedBytes,
      0
    );

  const usedGB =
    usedBytes /
    (1024 * 1024 * 1024);

  const limitGB =
    limitBytes /
    (1024 * 1024 * 1024);

  const remainingGB =
    remainingBytes /
    (1024 * 1024 * 1024);

  const percentage =
    limitBytes > 0
      ? (usedBytes /
          limitBytes) *
        100
      : 0;

  return {
    month:
      usage.month,

    usedBytes,

    usedGB:
      Number(
        usedGB.toFixed(3)
      ),

    limitBytes,

    limitGB:
      Number(
        limitGB.toFixed(3)
      ),

    remainingBytes,

    remainingGB:
      Number(
        remainingGB.toFixed(3)
      ),

    percentage:
      Number(
        percentage.toFixed(2)
      ),
  };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  getUploadedFiles,

  uploadFiles,

  uploadSingleFile,

  uploadFileToR2,

  deleteFileFromR2,

  deleteFileByUrl,

  getStorageInfo,
};