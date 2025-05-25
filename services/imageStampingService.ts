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
        resolve(canvas.toDataURL(mimeType));
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

      resolve(canvas.toDataURL(mimeType));
    };
    img.onerror = (err) => {
      console.error("Error loading image for stamping:", err);
      reject(new Error('Failed to load image for stamping. The image might be corrupt or in an unsupported format.'));
    };
    try {
        if (!base64Image.startsWith('data:')) {
            img.src = `data:${mimeType};base64,${base64Image}`;
        } else {
            img.src = base64Image;
        }
    } catch (e) {
        reject(new Error('Error setting image source for stamping. Invalid image data or MIME type.'));
    }
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
