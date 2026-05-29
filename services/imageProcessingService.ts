
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
    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) {
        return reject(new Error('File could not be read.'));
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
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
        
        // 3. Convert to JPEG and get data URL
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        const base64 = dataUrl.split(',')[1];

        if (!base64) {
          return reject(new Error('Failed to generate base64 string from canvas.'));
        }

        resolve({ base64, mimeType: 'image/jpeg' });
      };
      img.onerror = (err) => reject(new Error(`Image could not be loaded: ${err}`));
      img.src = event.target.result as string;
    };
    reader.onerror = (err) => reject(new Error(`FileReader error: ${err}`));
    reader.readAsDataURL(imageFile);
  });
}
