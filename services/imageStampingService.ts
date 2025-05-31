

export const generateStampedImage = (
  base64Image: string,
  mimeType: string,
  receiptNumber: string,
  siteLocation: string,
  inspectionDate: string,
  item: string
  // Removed site1, site2 parameters
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get 2D context from canvas.'));
        return;
      }

      ctx.drawImage(img, 0, 0);

      const fontSize = Math.max(16, Math.min(img.width / 35, img.height / 25));
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      
      const textLines: string[] = [];
      if (receiptNumber && receiptNumber.trim() !== '') textLines.push(`접수번호: ${receiptNumber}`);
      if (siteLocation && siteLocation.trim() !== '') textLines.push(`현장: ${siteLocation}`);
      if (item && item.trim() !== '') textLines.push(`항목: ${item}`); 
      if (inspectionDate && inspectionDate.trim() !== '') textLines.push(`검사시작일: ${inspectionDate}`);
      // Removed site1, site2 logic

      if (textLines.length === 0) {
        resolve(canvas.toDataURL(mimeType)); // Use original mimeType for single image
        return;
      }
      
      const padding = fontSize * 0.5;
      const lineHeight = fontSize * 1.4;
      
      let maxTextWidth = 0;
      textLines.forEach(line => {
          const metrics = ctx.measureText(line);
          if (metrics.width > maxTextWidth) {
              maxTextWidth = metrics.width;
          }
      });
      
      const textBlockWidth = maxTextWidth + (padding * 2);
      const textBlockHeight = (textLines.length * lineHeight) - (lineHeight - fontSize) + padding; 

      const rectX = padding / 2;
      const rectY = canvas.height - textBlockHeight - (padding / 2);
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(rectX , rectY , textBlockWidth, textBlockHeight);

      ctx.fillStyle = 'white';
      textLines.forEach((line, index) => {
        const textY = rectY + (index * lineHeight) + fontSize + (padding / 2) - (lineHeight - fontSize) / 2;
        ctx.fillText(line, rectX + padding, textY);
      });

      resolve(canvas.toDataURL(mimeType)); // Use original mimeType for single image
    };
    img.onerror = (err) => {
      console.error("Error loading image for stamping:", err);
      reject(new Error('Failed to load image for stamping. The image might be corrupt or in an unsupported format.'));
    };
    try {
        // Ensure data URL prefix if not present
        if (base64Image.startsWith('data:')) {
            img.src = base64Image;
        } else {
            img.src = `data:${mimeType};base64,${base64Image}`;
        }
    } catch (e) {
        reject(new Error('Error setting image source for stamping. Invalid image data or MIME type.'));
    }
  });
};


interface ImageInfoMinimal {
  base64: string;
  mimeType: string;
}

interface StampDetails {
  receiptNumber: string;
  siteLocation: string;
  inspectionStartDate: string;
  item: string;
}

export const generateCompositeImage = (
  images: ImageInfoMinimal[],
  stampDetails: StampDetails,
  outputMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.9
): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    if (images.length === 0) {
      reject(new Error('No images provided for composite generation.'));
      return;
    }

    const loadedImages: HTMLImageElement[] = await Promise.all(
      images.map(imgInfo => new Promise<HTMLImageElement>((resolveImg, rejectImg) => {
        const img = new Image();
        img.onload = () => resolveImg(img);
        img.onerror = (err) => {
            console.error("Error loading an image for composite:", err, imgInfo.mimeType);
            rejectImg(new Error(`Failed to load an image (MIME: ${imgInfo.mimeType}) for composite generation.`));
        };
        if (imgInfo.base64.startsWith('data:')) {
            img.src = imgInfo.base64;
        } else {
            img.src = `data:${imgInfo.mimeType};base64,${imgInfo.base64}`;
        }
      }))
    ).catch(err => {
      reject(err);
      return null;
    });

    if (!loadedImages) return;


    const numImages = loadedImages.length;
    const PADDING = 10; // Padding between images and around border

    // Determine grid layout
    let cols = Math.ceil(Math.sqrt(numImages));
    let rows = Math.ceil(numImages / cols);
    
    // Optimize layout for few images (e.g. 2, 3) to be more strip-like if preferred
    if (numImages === 2) { cols = 2; rows = 1; } // Horizontal strip
    else if (numImages === 3) { cols = 3; rows = 1; } // Horizontal strip


    // Assume all images are roughly the same size for cell calculation, or use a standard cell size
    // For simplicity, let's find max width/height among images and use that as a basis for cell size
    // Or, more robustly, define a target cell size and scale images into it.
    // Let's go with a max individual image dimension to scale cells
    const maxImgWidth = Math.max(...loadedImages.map(img => img.width), 300); // Min 300px width
    const maxImgHeight = Math.max(...loadedImages.map(img => img.height), 200); // Min 200px height

    const cellWidth = maxImgWidth;
    const cellHeight = maxImgHeight;

    const canvasWidth = cols * cellWidth + (cols + 1) * PADDING;
    const canvasHeight = rows * cellHeight + (rows + 1) * PADDING;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get 2D context for composite canvas.'));
      return;
    }

    ctx.fillStyle = 'white'; // Background for the composite image
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    loadedImages.forEach((img, index) => {
      const rowIndex = Math.floor(index / cols);
      const colIndex = index % cols;

      const x = PADDING + colIndex * (cellWidth + PADDING);
      const y = PADDING + rowIndex * (cellHeight + PADDING);

      // Scale image to fit cell while maintaining aspect ratio
      const hRatio = cellWidth / img.width;
      const vRatio = cellHeight / img.height;
      const ratio = Math.min(hRatio, vRatio);
      
      const drawWidth = img.width * ratio;
      const drawHeight = img.height * ratio;

      // Center the image within the cell
      const centerX = x + (cellWidth - drawWidth) / 2;
      const centerY = y + (cellHeight - drawHeight) / 2;

      ctx.drawImage(img, centerX, centerY, drawWidth, drawHeight);
    });

    // Apply stamp
    const { receiptNumber, siteLocation, inspectionStartDate, item } = stampDetails;
    const fontSize = Math.max(16, Math.min(canvas.width / 40, canvas.height / 30, 24)); // Adjusted for potentially larger canvas
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;

    const textLines: string[] = [];
    if (receiptNumber && receiptNumber.trim() !== '') textLines.push(`접수번호: ${receiptNumber}`);
    if (siteLocation && siteLocation.trim() !== '') textLines.push(`현장: ${siteLocation}`);
    if (item && item.trim() !== '') textLines.push(`항목: ${item}`);
    if (inspectionStartDate && inspectionStartDate.trim() !== '') textLines.push(`검사시작일: ${inspectionStartDate}`);

    if (textLines.length > 0) {
      const textPadding = fontSize * 0.5;
      const lineHeight = fontSize * 1.4;
      
      let maxTextWidth = 0;
      textLines.forEach(line => {
          const metrics = ctx.measureText(line);
          if (metrics.width > maxTextWidth) {
              maxTextWidth = metrics.width;
          }
      });

      const textBlockWidth = maxTextWidth + (textPadding * 2);
      const textBlockHeight = (textLines.length * lineHeight) - (lineHeight - fontSize) + textPadding;
      
      const rectX = textPadding / 2;
      const rectY = canvas.height - textBlockHeight - (textPadding / 2);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(rectX, rectY, textBlockWidth, textBlockHeight);

      ctx.fillStyle = 'white';
      textLines.forEach((line, index) => {
        const textY = rectY + (index * lineHeight) + fontSize + (textPadding / 2) - (lineHeight - fontSize) / 2;
        ctx.fillText(line, rectX + textPadding, textY);
      });
    }

    resolve(canvas.toDataURL(outputMimeType, quality));
  });
};


export const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  if (arr.length < 2) {
    throw new Error('Invalid data URL format for blob conversion.');
  }
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch || mimeMatch.length < 2) {
    throw new Error('Could not determine MIME type from data URL for blob conversion.');
  }
  const mime = mimeMatch[1];
  let bstr;
  try {
    bstr = atob(arr[1]);
  } catch (e) {
    console.error("Failed to decode base64 string (atob):", e);
    throw new Error("Invalid base64 data in data URL.");
  }
  
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};
