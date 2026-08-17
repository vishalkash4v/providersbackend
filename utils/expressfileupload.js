const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/**
 * Convert filesystem path to public/relative path
 *
 * Windows:
 * W:\providerbackend\uploads\services\file.png
 *
 * Becomes:
 * uploads/services/file.png
 */
function getPublicPath(uploadDir, fileName) {
  return path
    .join(uploadDir, fileName)
    .split(path.sep)
    .join("/");
}

/**
 * Get uploaded files from req.files
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
 * Save uploaded files
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

    // Actual filesystem path
    const filePath = path.join(
      absoluteUploadDir,
      fileName
    );

    await file.mv(filePath);

    // Relative/public path
    const publicPath = getPublicPath(
      uploadDir,
      fileName
    );

    results.push({
      fieldName: item.fieldName,
      originalName,
      fileName,
      path: publicPath,
      size: file.size,
      mimetype: file.mimetype,
    });
  }

  return results;
}

/**
 * Upload only one file from a specific field
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

  // Actual filesystem path
  const filePath = path.join(
    absoluteUploadDir,
    fileName
  );

  await file.mv(filePath);

  // Relative/public path
  const publicPath = getPublicPath(
    uploadDir,
    fileName
  );

  return {
    fieldName,
    originalName: file.name,
    fileName,
    path: publicPath,
    size: file.size,
    mimetype: file.mimetype,
  };
}

module.exports = {
  getUploadedFiles,
  uploadFiles,
  uploadSingleFile,
};