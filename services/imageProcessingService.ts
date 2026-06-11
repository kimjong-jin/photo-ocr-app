
export interface PreprocessImageOptions {
  maxWidth?: number;
  jpegQuality?: number;
  grayscale?: boolean;
}

/**
 * Preprocesses an image file for Gemini API by resizing, converting to grayscale, and compressing.
 * @param imageFile The original image file.
 * @param options Preprocessing options.
 * @returns A promise resolving to the preprocessed image as a base64 string and its new MIME type.
 */
export async function preprocessImageForGemini(
  imageFile: File,
  options: PreprocessImageOptions = {}
): Promise<{ base64: string; mimeType: string }> {
  const { maxWidth = 1600, jpegQuality = 0.9, grayscale = true } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    // iOS Safari data URI(약 2~4MB) 한도 우회: FileReader data URL 대신 object URL로 로드.
    // 대용량 아이폰 원본(5~10MB)을 data URL로 로드하면 iOS에서 실패하던 문제 해결.
    const objectUrl = URL.createObjectURL(imageFile);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          return reject(new Error('Could not get canvas context.'));
        }

        // 1. Scale resolution (maintaining aspect ratio)
        let { width, height } = img;
        if (width > maxWidth) {
          const scaleFactor = maxWidth / width;
          width = maxWidth;
          height = height * scaleFactor;
        }
        canvas.width = width;
        canvas.height = height;

        // 2. Apply grayscale filter (optional)
        if (grayscale) {
          ctx.filter = 'grayscale(100%)';
        }

        ctx.drawImage(img, 0, 0, width, height);

        // 3. Convert to JPEG and get base64
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        const base64 = dataUrl.split(',')[1];
        if (!base64) {
          return reject(new Error('Failed to generate base64 string from canvas.'));
        }
        resolve({ base64, mimeType: 'image/jpeg' });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Image could not be loaded: ${err}`));
    };
    img.src = objectUrl;
  });
}
