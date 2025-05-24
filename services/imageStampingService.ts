
export const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  if (arr.length < 2) {
    throw new Error('Invalid data URL');
  }
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch || mimeMatch.length < 2) {
    throw new Error('Could not parse MIME type from data URL');
  }
  const mime = mimeMatch[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

export const generateStampedImage = (
  originalImageBase64: string,
  mimeType: string,
  receiptNumber: string,
  siteLocation: string,
  inspectionStartDate: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get 2D context from canvas'));
        return;
      }

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // --- Context Stamping logic (Top-Right) ---
      const mainPadding = Math.max(10, Math.min(img.width, img.height) * 0.015); 
      let mainFontSize = Math.max(12, Math.min(img.width, img.height) * 0.025); 
      mainFontSize = Math.min(mainFontSize, 48); // Cap main font size
      
      ctx.font = `bold ${mainFontSize}px Arial, sans-serif`;
      
      const mainTextLines = [];
      if (receiptNumber) mainTextLines.push(`접수번호: ${receiptNumber}`);
      if (siteLocation) mainTextLines.push(`현장: ${siteLocation}`);
      if (inspectionStartDate) mainTextLines.push(`검사시작일: ${inspectionStartDate}`);

      if (mainTextLines.length > 0) {
        const mainLineHeight = mainFontSize * 1.3;
        const mainTextMetrics = mainTextLines.map(line => ctx.measureText(line));
        const mainMaxWidth = Math.max(...mainTextMetrics.map(m => m.width));
        
        const mainRectHeight = (mainLineHeight * mainTextLines.length) + (mainPadding * 1.5);
        const mainRectWidth = mainMaxWidth + (mainPadding * 2);
        
        const mainRectX = canvas.width - mainRectWidth - mainPadding;
        const mainRectY = mainPadding;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; 
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(mainRectX, mainRectY, mainRectWidth, mainRectHeight, 8);
        } else { 
            ctx.rect(mainRectX, mainRectY, mainRectWidth, mainRectHeight);
        }
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        mainTextLines.forEach((line, index) => {
          ctx.fillText(line, mainRectX + mainPadding, mainRectY + (mainPadding / 2) + (index * mainLineHeight));
        });
      }
      // --- End Context Stamping logic ---

      // --- KTL Mark Stamping logic (Bottom-Left) ---
      ctx.save(); // Isolate KTL drawing context

      const ktlText = "KTL";
      let ktlFontSize = Math.max(10, mainFontSize * 0.75); 
      ktlFontSize = Math.min(ktlFontSize, 32); 
      
      const ktlPadding = Math.max(6, ktlFontSize * 0.25);

      ctx.font = `bold ${ktlFontSize}px Arial, sans-serif`;
      const ktlTextMetrics = ctx.measureText(ktlText);
      
      const ktlRectWidth = ktlTextMetrics.width + (ktlPadding * 2);
      const ktlRectHeight = ktlFontSize + (ktlPadding * 2); 
      
      const ktlRectX = mainPadding; 
      let ktlRectY = canvas.height - ktlRectHeight - mainPadding;

      if (ktlRectY < mainPadding) {
        ktlRectY = mainPadding;
      }
      if (ktlRectY + ktlRectHeight > canvas.height - mainPadding) {
          ktlRectY = canvas.height - mainPadding - ktlRectHeight;
      }
      if (ktlRectY < mainPadding) ktlRectY = mainPadding;

      console.log("[KTL Mark Debug] Canvas Width:", canvas.width, "Height:", canvas.height);
      console.log("[KTL Mark Debug] Main Padding:", mainPadding);
      console.log("[KTL Mark Debug] KTL Font Size:", ktlFontSize, "Padding:", ktlPadding);
      console.log("[KTL Mark Debug] KTL Rect X:", ktlRectX, "Y:", ktlRectY, "Width:", ktlRectWidth, "Height:", ktlRectHeight);
      
      // Draw background rectangle for KTL mark (DEBUG COLORS)
      const ktlBgColor = 'rgba(255, 0, 255, 1)'; // Opaque Magenta
      const ktlStrokeColor = 'rgba(255, 255, 0, 1)'; // Opaque Yellow
      const ktlTextColor = 'rgba(0, 255, 0, 1)'; // Opaque Lime Green

      console.log("[KTL Mark Debug] Background Color:", ktlBgColor);
      ctx.fillStyle = ktlBgColor;
      ctx.fillRect(ktlRectX, ktlRectY, ktlRectWidth, ktlRectHeight);

      // Draw border for KTL mark (DEBUG)
      console.log("[KTL Mark Debug] Stroke Color:", ktlStrokeColor);
      ctx.strokeStyle = ktlStrokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(ktlRectX, ktlRectY, ktlRectWidth, ktlRectHeight);

      // Draw KTL text (DEBUG COLORS)
      console.log("[KTL Mark Debug] Text Color:", ktlTextColor);
      ctx.fillStyle = ktlTextColor; 
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ktlText, ktlRectX + ktlRectWidth / 2, ktlRectY + ktlRectHeight / 2);
      
      ctx.restore(); // Restore drawing context
      // --- End KTL Mark Stamping logic ---

      resolve(canvas.toDataURL('image/png')); 
    };
    img.onerror = (err) => {
      console.error("Failed to load image for stamping:", err);
      reject(new Error('Failed to load image for stamping'));
    };
    img.src = `data:${mimeType};base64,${originalImageBase64}`;
  });
};
