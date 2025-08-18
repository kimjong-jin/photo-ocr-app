// Renamed from ImageInfoMinimal to avoid confusion with ImageInput.ImageInfo
interface Base64ImageSource {
  base64: string;
  mimeType: string;
}

// New interface for generating composite images with optional comments
export interface CompositeImageInput {
  base64: string;
  mimeType: string;
  comment?: string;
}

interface StampDetails {
  receiptNumber: string;
  siteLocation: string;
  inspectionStartDate?: string; // Made optional
  item: string;
}

export const generateStampedImage = (
  base64Image: string, // Can be full dataURL or just base64 part
  mimeType: string,
  receiptNumber: string,
  siteLocation: string,
  inspectionDate: string, // Parameter kept for compatibility, but PhotoLogPage will pass ''
  item: string,
  comment?: string // New optional parameter for photo comments
): Promise<string> => { // Returns a new dataURL (base64 string with prefix)
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

      // Massively increased font size based on user feedback ("10x bigger")
      const fontSize = Math.max(120, Math.min(img.width / 4, img.height / 3)); 
      
      const textLines: { text: string; isComment: boolean }[] = [];
      if (receiptNumber && receiptNumber.trim() !== '') textLines.push({ text: `접수번호: ${receiptNumber}`, isComment: false });
      if (siteLocation && siteLocation.trim() !== '') textLines.push({ text: `현장: ${siteLocation}`, isComment: false });
      if (item && item.trim() !== '') textLines.push({ text: `항목: ${item}`, isComment: false }); 
      if (inspectionDate && inspectionDate.trim() !== '') textLines.push({ text: `검사시작일: ${inspectionDate}`, isComment: false }); // This line will only add if inspectionDate is non-empty
      if (comment && comment.trim() !== '') textLines.push({ text: `코멘트: ${comment}`, isComment: true }); // Add comment line

      
      if (textLines.length === 0) {
        // If no text to stamp, return original image dataURL (if it was one) or create one
        if (base64Image.startsWith('data:')) {
            resolve(base64Image);
        } else {
            resolve(`data:${mimeType};base64,${base64Image}`);
        }
        return;
      }
      
      const padding = fontSize * 0.5;
      const lineHeight = fontSize * 1.4;
      
      let maxTextWidth = 0;
      ctx.font = `bold ${fontSize}px Arial, sans-serif`; // Set font once before measuring
      textLines.forEach(line => {
          const metrics = ctx.measureText(line.text);
          if (metrics.width > maxTextWidth) {
              maxTextWidth = metrics.width;
          }
      });
      
      const textBlockWidth = maxTextWidth + (padding * 2);
      // Ensure text block height is at least one line, even if padding calculation makes it smaller
      const textBlockHeight = Math.max(lineHeight + padding, (textLines.length * lineHeight) - (lineHeight - fontSize) + padding);


      const rectX = padding / 2; // Position from left edge
      const rectY = canvas.height - textBlockHeight - (padding / 2); // Position from bottom edge
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(rectX , rectY , textBlockWidth, textBlockHeight);

      textLines.forEach((line, index) => {
        // Set font and color for each line
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = line.isComment ? '#FFD700' : 'white'; // Gold for comments, white for others

        const textY = rectY + (index * lineHeight) + fontSize + (padding / 2) - (lineHeight - fontSize) / 2;
        ctx.fillText(line.text, rectX + padding, textY);
      });

      resolve(canvas.toDataURL(mimeType)); // Returns full dataURL
    };
    img.onerror = (err) => {
      console.error("Error loading image for stamping:", err, "MIME:", mimeType, "Base64(start):", base64Image.substring(0,100));
      reject(new Error('Failed to load image for stamping. The image might be corrupt or in an unsupported format.'));
    };
    try {
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


const MAX_COMPOSITE_DIMENSION = 3000;

export const generateCompositeImage = (
  images: CompositeImageInput[],
  stampDetails: StampDetails,
  outputMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.9
): Promise<string> => { // Returns a new dataURL
  return new Promise(async (resolve, reject) => {
    if (images.length === 0) {
      // Create a small blank image with a "No Images" message
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get 2D context for blank composite canvas.'));
        return;
      }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'grey';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('첨부된 사진 없음', canvas.width / 2, canvas.height / 2);
      resolve(canvas.toDataURL(outputMimeType, quality));
      return;
    }

    const loadedImages: HTMLImageElement[] = await Promise.all(
      images.map(imgInfo => new Promise<HTMLImageElement>((resolveImg, rejectImg) => {
        const img = new Image();
        img.onload = () => resolveImg(img);
        img.onerror = (err) => {
            console.error("Error loading an image for composite. MIME:", imgInfo.mimeType, "Base64(start):", imgInfo.base64.substring(0, 30) + "...", "Error:", err);
            rejectImg(new Error(`Failed to load an image (MIME: ${imgInfo.mimeType}) for composite generation. Check console for details.`));
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
    let PADDING = 10; 

    let cols = Math.ceil(Math.sqrt(numImages));
    let rows = Math.ceil(numImages / cols);
    
    if (numImages === 2) { cols = 2; rows = 1; }
    else if (numImages === 3) { cols = 3; rows = 1; }

    const maxImgWidthOriginal = Math.max(...loadedImages.map(img => img.width), 300);
    const maxImgHeightOriginal = Math.max(...loadedImages.map(img => img.height), 200);

    let cellWidthOriginal = maxImgWidthOriginal;
    let cellHeightOriginal = maxImgHeightOriginal;

    let tentativeCanvasWidth = cols * cellWidthOriginal + (cols + 1) * PADDING;
    let tentativeCanvasHeight = rows * cellHeightOriginal + (rows + 1) * PADDING;
    
    let scaleFactor = 1;
    if (tentativeCanvasWidth > MAX_COMPOSITE_DIMENSION || tentativeCanvasHeight > MAX_COMPOSITE_DIMENSION) {
        scaleFactor = Math.min(
            MAX_COMPOSITE_DIMENSION / tentativeCanvasWidth,
            MAX_COMPOSITE_DIMENSION / tentativeCanvasHeight
        );
    }

    const finalCanvasWidth = tentativeCanvasWidth * scaleFactor;
    const finalCanvasHeight = tentativeCanvasHeight * scaleFactor;
    
    const cellWidth = cellWidthOriginal * scaleFactor;
    const cellHeight = cellHeightOriginal * scaleFactor;
    PADDING = PADDING * scaleFactor;


    const canvas = document.createElement('canvas');
    canvas.width = finalCanvasWidth;
    canvas.height = finalCanvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get 2D context for composite canvas.'));
      return;
    }

    ctx.fillStyle = 'white'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    loadedImages.forEach((img, index) => {
      const rowIndex = Math.floor(index / cols);
      const colIndex = index % cols;

      const x = PADDING + colIndex * (cellWidth + PADDING);
      const y = PADDING + rowIndex * (cellHeight + PADDING);

      const hRatio = cellWidth / img.width;
      const vRatio = cellHeight / img.height;
      const ratio = Math.min(hRatio, vRatio); 
      
      const drawWidth = img.width * ratio;
      const drawHeight = img.height * ratio;

      const centerX = x + (cellWidth - drawWidth) / 2;
      const centerY = y + (cellHeight - drawHeight) / 2;

      ctx.drawImage(img, centerX, centerY, drawWidth, drawHeight);

      // Add comment overlay to individual image
      const comment = images[index].comment;
      if (comment && comment.trim() !== '') {
          // Massively increased font size based on user feedback ("10x bigger")
          const commentFontSize = Math.max(96 * scaleFactor, Math.min(drawWidth / 2, drawHeight / 1.7, 240 * scaleFactor));
          ctx.font = `bold ${commentFontSize}px Arial, sans-serif`;
          const commentPadding = commentFontSize * 0.4;
          
          const commentText = `코멘트: ${comment}`;
          const commentMetrics = ctx.measureText(commentText);
          
          // Ensure comment block doesn't exceed image width
          const commentBlockWidth = Math.min(drawWidth - (commentPadding * 2), commentMetrics.width + (commentPadding * 2));
          const commentBlockHeight = commentFontSize + (commentPadding * 2);

          // Position at top-left of the drawn image to act as a title.
          const commentRectX = centerX + commentPadding;
          const commentRectY = centerY + commentPadding;

          // Draw background
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.fillRect(commentRectX, commentRectY, commentBlockWidth, commentBlockHeight);

          // Draw text
          ctx.fillStyle = '#FFD700'; // Gold color for comments
          ctx.textBaseline = 'top'; // Set baseline for predictable positioning
          ctx.fillText(commentText, commentRectX + commentPadding, commentRectY + commentPadding, commentBlockWidth - (commentPadding * 2));
          ctx.textBaseline = 'alphabetic'; // Reset baseline to default for other drawing operations
      }
    });

    // Apply stamp to composite image
    const { receiptNumber, siteLocation, inspectionStartDate, item } = stampDetails;
     // Massively increased font size based on user feedback ("10x bigger")
    const fontSize = Math.max(120 * scaleFactor, Math.min(canvas.width / 5, canvas.height / 4, 240 * scaleFactor));
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;

    const textLines: string[] = [];
    if (receiptNumber && receiptNumber.trim() !== '') textLines.push(`접수번호: ${receiptNumber}`);
    if (siteLocation && siteLocation.trim() !== '') textLines.push(`현장: ${siteLocation}`);
    if (item && item.trim() !== '') textLines.push(`항목: ${item}`);
    if (inspectionStartDate && inspectionStartDate.trim() !== '') textLines.push(`검사시작일: ${inspectionStartDate}`); // Handles optional

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
      const textBlockHeight = Math.max(lineHeight + textPadding, (textLines.length * lineHeight) - (lineHeight - fontSize) + textPadding);
            
      const rectX = textPadding / 2;
      const rectY = canvas.height - textBlockHeight - (textPadding / 2);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(rectX, rectY, textBlockWidth, textBlockHeight);

      ctx.fillStyle = 'white';
      textLines.forEach((line, index) => {
        const textY = rectY + (index * lineHeight) + fontSize + (textPadding / 2) - (lineHeight - fontSize) / 2;
        // Add maxWidth to fillText for robustness
        ctx.fillText(line, rectX + textPadding, textY, maxTextWidth);
      });
    }
    
    const finalDataURL = canvas.toDataURL(outputMimeType, quality);

    const parts = finalDataURL.split(',');
    if (parts.length < 2 || !parts[0].includes(';base64') || parts[1].trim() === '') {
      console.error(
        "canvas.toDataURL in generateCompositeImage returned invalid/empty data. Canvas WxH:",
        canvas.width, canvas.height, "Output (first 100chars):", finalDataURL.substring(0,100)
      );
      reject(new Error("합성 이미지 생성 실패: 캔버스에서 유효한 이미지 데이터를 생성할 수 없습니다. (잘못된 Data URL 형식)"));
      return;
    }
    resolve(finalDataURL);
  });
};


export const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  if (arr.length < 2) {
    console.error("Invalid data URL format for blob conversion (missing comma):", dataurl.substring(0,100));
    throw new Error('Invalid data URL format for blob conversion.');
  }
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch || mimeMatch.length < 2) {
    console.error("Could not determine MIME type from data URL for blob conversion:", arr[0]);
    throw new Error('Could not determine MIME type from data URL for blob conversion.');
  }
  const mime = mimeMatch[1];
  let bstr;
  try {
    bstr = atob(arr[1]);
  } catch (e:any) {
    console.error("Failed to decode base64 string (atob). Input (first 100chars of base64 part):", arr[1].substring(0,100), "Error:", e.message);
    throw new Error(`Invalid base64 data in data URL: ${e.message}`);
  }
  
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};
