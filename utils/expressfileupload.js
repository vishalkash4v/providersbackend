const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/**
 * Get uploaded files from req.files
 *
 * Supports:
 * - Single file
 * - Multiple files
 * - One field containing multiple files
 * - Multiple different file fields
 *
 * Example:
 * req.files.file
 * req.files.files
 * req.files.image
 */
function getUploadedFiles(req) {
  if (!req.files) {
    return [];
  }

  const files = [];

  Object.keys(req.files).forEach((fieldName) => {
    const fieldFiles = req.files[fieldName];

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
  });

  return files;
}

/**
 * Save uploaded files to a directory
 *
 * Returns:
 * [
 *   {
 *     fieldName,
 *     originalName,
 *     fileName,
 *     path,
 *     size,
 *     mimetype
 *   }
 * ]
 */
async function uploadFiles(req, uploadDir = "uploads") {
  const uploadedFiles = getUploadedFiles(req);

  if (!uploadedFiles.length) {
    return [];
  }

  const absoluteUploadDir = path.resolve(uploadDir);

  await fs.promises.mkdir(absoluteUploadDir, {
    recursive: true,
  });

  const results = [];

  for (const item of uploadedFiles) {
    const file = item.file;

    const originalName = file.name;

    const extension = path.extname(originalName);

    const fileName =
      `${Date.now()}-` +
      `${crypto.randomBytes(8).toString("hex")}` +
      extension;

    const filePath = path.join(
      absoluteUploadDir,
      fileName
    );

    await file.mv(filePath);

    results.push({
      fieldName: item.fieldName,
      originalName,
      fileName,
      path: filePath,
      size: file.size,
      mimetype: file.mimetype,
    });
  }

  return results;
}

/**
 * Upload only one file from a specific field
 *
 * Example:
 * uploadSingleFile(req, "profile")
 */
async function uploadSingleFile(
  req,
  fieldName,
  uploadDir = "uploads"
) {
  if (!req.files || !req.files[fieldName]) {
    return null;
  }

  let file = req.files[fieldName];

  // If frontend accidentally sends multiple files,
  // take the first one.
  if (Array.isArray(file)) {
    file = file[0];
  }

  const absoluteUploadDir = path.resolve(uploadDir);

  await fs.promises.mkdir(absoluteUploadDir, {
    recursive: true,
  });

  const extension = path.extname(file.name);

  const fileName =
    `${Date.now()}-` +
    `${crypto.randomBytes(8).toString("hex")}` +
    extension;

  const filePath = path.join(
    absoluteUploadDir,
    fileName
  );

  await file.mv(filePath);

  return {
    fieldName,
    originalName: file.name,
    fileName,
    path: filePath,
    size: file.size,
    mimetype: file.mimetype,
  };
}

module.exports = {
  getUploadedFiles,
  uploadFiles,
  uploadSingleFile,
};