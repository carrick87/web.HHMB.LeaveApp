/**
 * File storage utilities for Firestore
 * Converts files to base64 for storage in Firestore
 */

export interface StoredFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  base64Data: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface FileStorageResult {
  success: boolean;
  storedFiles?: StoredFile[];
  error?: string;
}

/**
 * Convert File to base64
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

/**
 * Convert base64 back to File
 */
export const base64ToFile = (base64Data: string, fileName: string, fileType: string): File => {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new File([byteArray], fileName, { type: fileType });
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

const isIOSDevice = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Resolve MIME type from stored value or file extension fallback.
 */
export const inferMimeType = (fileName: string, fileType?: string): string => {
  if (fileType && fileType !== 'text/plain' && fileType.trim() !== '') {
    return fileType;
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
};

/**
 * Download a StoredFile attachment with iOS Safari-safe blob handling.
 */
export const downloadStoredFile = async (attachment: StoredFile): Promise<void> => {
  try {
    const mimeType = inferMimeType(attachment.fileName, attachment.fileType);
    const file = base64ToFile(attachment.base64Data, attachment.fileName, mimeType);

    if (isIOSDevice() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }

    const blobType = isIOSDevice() ? 'application/octet-stream' : mimeType;
    const blob = new Blob([file], { type: blobType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    alert('Failed to download file. Please try again or contact support.');
  }
};

// Firestore has a 1MB limit per document field
const FIRESTORE_MAX_SIZE = 1 * 1024 * 1024; // 1MB
// Allow larger files initially, we'll compress them down to 1MB
const MAX_INITIAL_FILE_SIZE = 10 * 1024 * 1024; // 10MB initial limit
const MAX_FILE_COUNT = 3;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];

/**
 * Get file size in human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Compress image using Canvas API
 * Converts all images to JPEG for better compression and aggressively reduces size
 */
const compressImage = (file: File, maxSizeBytes: number = FIRESTORE_MAX_SIZE, quality: number = 0.7): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const originalSize = file.size;
        
        // More aggressive dimension reduction - start with smaller max dimension
        // Calculate scale factor to get under size limit
        let scaleFactor = 1;
        const targetSize = maxSizeBytes * 0.8; // Target 80% of max to leave room for quality variations
        
        // Start with a reasonable max dimension based on file size
        let maxDimension = 1200; // Reduced from 1920 for better compression
        
        // If file is very large, reduce dimensions more aggressively
        if (originalSize > 2 * 1024 * 1024) { // > 2MB
          maxDimension = 800;
        } else if (originalSize > 1024 * 1024) { // > 1MB
          maxDimension = 1000;
        }
        
        // Resize if image is larger than max dimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            scaleFactor = maxDimension / width;
          } else {
            scaleFactor = maxDimension / height;
          }
          width = Math.round(width * scaleFactor);
          height = Math.round(height * scaleFactor);
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        // Use better image rendering for compression
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG for better compression (even if original was PNG/GIF)
        const outputType = 'image/jpeg';
        const outputQuality = 0.7; // Start with lower quality
        
        // Try different quality levels and dimensions until we get under the size limit
        const tryCompress = (currentQuality: number, currentMaxDim: number): void => {
          // Recalculate dimensions if we need to reduce more
          let currentWidth = img.width;
          let currentHeight = img.height;
          
          if (currentWidth > currentMaxDim || currentHeight > currentMaxDim) {
            if (currentWidth > currentHeight) {
              currentHeight = (currentHeight / currentWidth) * currentMaxDim;
              currentWidth = currentMaxDim;
            } else {
              currentWidth = (currentWidth / currentHeight) * currentMaxDim;
              currentHeight = currentMaxDim;
            }
          }
          
          canvas.width = Math.round(currentWidth);
          canvas.height = Math.round(currentHeight);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }
              
              // If still too large, try reducing quality or dimensions further
              if (blob.size > maxSizeBytes) {
                if (currentQuality > 0.1) {
                  // Try lower quality first
                  tryCompress(Math.max(0.1, currentQuality - 0.15), currentMaxDim);
                } else if (currentMaxDim > 400) {
                  // If quality is already low, reduce dimensions
                  tryCompress(0.1, Math.max(400, currentMaxDim - 200));
                } else {
                  // Can't compress further - reject
                  reject(new Error(
                    `Unable to compress image below ${formatFileSize(maxSizeBytes)}. ` +
                    `Current size: ${formatFileSize(blob.size)}. ` +
                    `Please use a smaller image or compress it externally.`
                  ));
                }
              } else {
                // Successfully compressed - use the smaller of original or compressed
                const finalFile = blob.size < originalSize 
                  ? new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
                      type: outputType,
                      lastModified: Date.now()
                    })
                  : file; // If compression made it larger, use original
                
                resolve(finalFile);
              }
            },
            outputType,
            currentQuality
          );
        };
        
        tryCompress(outputQuality, maxDimension);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
  });
};

/**
 * Note: PDF compression is not supported in the browser.
 * PDF files must be 1MB or smaller before upload.
 * Users should compress PDFs using external tools if needed.
 */

/**
 * Compress file if it exceeds the size limit
 * Accounts for base64 encoding overhead (~33% increase)
 */
const compressFileIfNeeded = async (file: File): Promise<File> => {
  // Account for base64 encoding overhead
  // Base64 increases size by ~33%, so we compress to ~75% of limit
  const maxBinarySize = FIRESTORE_MAX_SIZE * 0.75; // ~750KB binary = ~1MB base64
  
  // If file is already under limit, return as-is
  if (file.size <= maxBinarySize) {
    return file;
  }
  
  // Compress based on file type
  
  if (file.type.startsWith('image/')) {
    try {
      return await compressImage(file, maxBinarySize);
    } catch (error: any) {
      // If compression fails or makes file larger, throw error
      throw new Error(
        `Failed to compress image "${file.name}": ${error.message || error}`
      );
    }
  } else if (file.type === 'application/pdf') {
    // PDF compression is not supported - files must be under 1MB before upload
    // Account for base64 encoding overhead (~33% increase)
    // So PDF binary size must be ~750KB or less to stay under 1MB after base64 encoding
    if (file.size > maxBinarySize) {
      throw new Error(
        `PDF file "${file.name}" is too large (${formatFileSize(file.size)}). ` +
        `Maximum file size for PDF attachments is 1 MB. ` +
        `Please compress the PDF using an external tool before uploading.`
      );
    }
    return file;
  }
  
  // For other file types, return as-is (shouldn't happen due to validation)
  return file;
};

/**
 * Validate files for storage
 */
export const validateFilesForStorage = (files: File[]): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (files.length === 0) {
    return { isValid: true, errors: [] };
  }

  if (files.length > MAX_FILE_COUNT) {
    errors.push(`You can upload a maximum of ${MAX_FILE_COUNT} files.`);
  }

  files.forEach(file => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push(`File type not allowed: ${file.name}. Only images (JPEG, PNG, GIF) and PDFs are accepted.`);
    }
    
    // Check file size based on type
    if (file.type === 'application/pdf') {
      // PDFs must be 1MB or smaller (accounting for base64 overhead, max ~750KB binary)
      const pdfMaxSize = FIRESTORE_MAX_SIZE * 0.75; // ~750KB to account for base64 encoding
      if (file.size > pdfMaxSize) {
        errors.push(
          `PDF file "${file.name}" is too large (${formatFileSize(file.size)}). ` +
          `Maximum file size for PDF attachments is 1 MB. ` +
          `Please compress the PDF using an external tool before uploading.`
        );
      }
    } else if (file.size > MAX_INITIAL_FILE_SIZE) {
      // Images can be larger initially as they will be compressed
      errors.push(
        `File too large: ${file.name}. Maximum initial size is ${formatFileSize(MAX_INITIAL_FILE_SIZE)}. ` +
        `Images will be automatically compressed to ${formatFileSize(FIRESTORE_MAX_SIZE)} if needed.`
      );
    }
  });

  return {
    isValid: errors.length === 0,
    errors: errors
  };
};

/**
 * Convert files to StoredFile objects for Firestore storage
 * Automatically compresses files if they exceed 1MB limit
 */
export const convertFilesToStoredFiles = async (files: File[], userId: string): Promise<StoredFile[]> => {
  const storedFiles: StoredFile[] = [];

  for (const file of files) {
    try {
      // Compress file if it exceeds Firestore limit
      // Account for base64 encoding overhead (~33% increase)
      const maxBinarySize = FIRESTORE_MAX_SIZE * 0.75; // ~750KB binary = ~1MB base64
      let processedFile = file;
      let wasCompressed = false;
      
      if (file.size > maxBinarySize) {
        console.log(`Compressing file ${file.name} (${formatFileSize(file.size)})...`);
        try {
          processedFile = await compressFileIfNeeded(file);
          wasCompressed = processedFile.size < file.size;
          if (wasCompressed) {
            console.log(`File compressed to ${formatFileSize(processedFile.size)}`);
          }
        } catch (compressionError: any) {
          throw new Error(`Failed to compress file ${file.name}: ${compressionError.message}`);
        }
      }
      
      // Convert to base64
      const base64Data = await fileToBase64(processedFile);
      
      // Calculate actual base64 size (base64 string length * 3/4 = binary size)
      // But we need to check the base64 string size itself for Firestore
      const base64StringSize = base64Data.length;
      
      // Firestore limit is on the base64 string size (1MB)
      // Base64 encoding increases size by ~33%, so we check the string length
      // 1MB = 1,048,576 bytes for base64 string
      if (base64StringSize > FIRESTORE_MAX_SIZE) {
        const errorMessage = file.type === 'application/pdf'
          ? `PDF file "${file.name}" exceeds size limit after encoding (${formatFileSize(base64StringSize)}). ` +
            `Maximum file size for PDF attachments is 1 MB. ` +
            `Please compress the PDF using an external tool before uploading.`
          : `File "${file.name}" exceeds size limit after encoding (${formatFileSize(base64StringSize)}). ` +
            `Maximum size is ${formatFileSize(FIRESTORE_MAX_SIZE)}. ` +
            `Please use a smaller file or compress it using an external tool.`;
        throw new Error(errorMessage);
      }
      
      const storedFile: StoredFile = {
        id: `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fileName: file.name,
        fileType: inferMimeType(processedFile.name, processedFile.type),
        fileSize: processedFile.size,
        base64Data: base64Data,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId
      };
      storedFiles.push(storedFile);
    } catch (error: any) {
      console.error('Error processing file:', error);
      throw new Error(`Failed to process file ${file.name}: ${error.message || error}`);
    }
  }

  return storedFiles;
};

/**
 * Convert StoredFile objects back to File objects
 */
export const convertStoredFilesToFiles = (storedFiles: StoredFile[]): File[] => {
  return storedFiles.map(storedFile => 
    base64ToFile(storedFile.base64Data, storedFile.fileName, storedFile.fileType)
  );
};




