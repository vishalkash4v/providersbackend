const {
  uploadFiles,
} = require('../utils/r2uploads');

module.exports = {

  // ============================================================
  // UPLOAD SINGLE OR MULTIPLE FILES
  // ============================================================
  //
  // POST /api/upload
  //
  // form-data:
  //
  // file     = single file
  // OR
  // files    = multiple files
  //
  // folder   = uploads/providers
  //
  // Maximum size: 4 MB PER FILE
  // ============================================================

  upload: async (req, res) => {
    try {

      // ========================================================
      // FILE CHECK
      // ========================================================

      if (
        !req.files ||
        Object.keys(req.files).length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'At least one file is required',
        });
      }

      // ========================================================
      // FOLDER
      // ========================================================

      const {
        folder,
      } = req.body;

      if (
        !folder ||
        !folder.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Folder is required',
        });
      }

      // ========================================================
      // NORMALIZE FOLDER
      // ========================================================

      const normalizedFolder =
        folder
          .trim()
          .replace(/^\/+|\/+$/g, '')
          .replace(/\\/g, '/');

      // ========================================================
      // SECURITY
      // ========================================================

      if (
        normalizedFolder.includes('..') ||
        normalizedFolder.includes('//')
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid folder path',
        });
      }

      // ========================================================
      // 4 MB PER FILE
      // ========================================================

      const MAX_FILE_SIZE =
        4 * 1024 * 1024;

      const uploadedFiles = [];

      for (
        const fieldName of Object.keys(
          req.files
        )
      ) {

        let files =
          req.files[fieldName];

        // Single file -> array
        if (!Array.isArray(files)) {
          files = [files];
        }

        for (const file of files) {

          if (!file) {
            continue;
          }

          if (
            Number(file.size) >
            MAX_FILE_SIZE
          ) {
            return res.status(400).json({
              success: false,
              message:
                `File "${file.name}" exceeds the maximum size of 4 MB`,
            });
          }

          uploadedFiles.push({
            fieldName,
            file,
          });
        }
      }

      if (!uploadedFiles.length) {
        return res.status(400).json({
          success: false,
          message: 'No valid files found',
        });
      }

      // ========================================================
      // USE EXISTING R2 HELPER
      // ========================================================
      //
      // uploadFiles() already supports:
      //
      // req.files.file
      // req.files.files
      // multiple fields
      // multiple files
      //
      // ========================================================

      const uploaded =
        await uploadFiles(
          req,
          normalizedFolder
        );

      if (
        !uploaded ||
        !uploaded.length
      ) {
        return res.status(500).json({
          success: false,
          message: 'File upload failed',
        });
      }

      // ========================================================
      // RESPONSE
      // ========================================================

      return res.status(201).json({
        success: true,

        message:
          uploaded.length === 1
            ? 'File uploaded successfully'
            : 'Files uploaded successfully',

        count:
          uploaded.length,

        data:
          uploaded,
      });

    } catch (error) {

      console.error(
        'Upload Error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Something went wrong',

        error:
          error.message,
      });
    }
  },
};