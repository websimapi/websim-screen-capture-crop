const startCaptureButton = document.getElementById('startCaptureButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
const largeMapCanvas = document.getElementById('largeMapCanvas');
const largeMapCtx = largeMapCanvas.getContext('2d');

let captureStream = null;
let cropSettings = {
  x: 0,
  y: 0,
  width: 300,
  height: 200
};

let isDragging = false;
let startX = 0;
let startY = 0;
let detectedCircle = null; // Detected white circle info

// Auto Map globals
let autoMapInterval = null;
let playerTile = null; // { row, col }
let gridCurrent = []; // grid for current view
let gridAll = {}; // overall explored region, keys as "r,c"

// Start screen capture using getDisplayMedia.
async function startCapture() {
  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo.srcObject = captureStream;
    screenVideo.onloadedmetadata = () => {
      // Initialize canvas dimensions.
      cropCanvas.width = cropSettings.width;
      cropCanvas.height = cropSettings.height;
      // Set map canvas size to match cropped area for current view.
      mapCanvas.width = cropSettings.width;
      mapCanvas.height = cropSettings.height;
      largeMapCanvas.width = cropSettings.width * 2; // start with double size; can adjust later.
      largeMapCanvas.height = cropSettings.height * 2;
      requestAnimationFrame(updateCrop);
    }
  } catch (error) {
    console.error('Error accessing display media.', error);
  }
}

// Continuously update the cropped output canvas from the video feed.
function updateCrop() {
  if (screenVideo.readyState >= 2) { // HAVE_CURRENT_DATA
    try {
      cropCtx.drawImage(
        screenVideo,
        cropSettings.x,
        cropSettings.y,
        cropSettings.width,
        cropSettings.height,
        0,
        0,
        cropSettings.width,
        cropSettings.height
      );
      // After drawing, detect the best matching white circle.
      detectWhiteCircle();
    } catch (e) {
      console.warn('Video not ready for drawing', e);
    }
  }
  requestAnimationFrame(updateCrop);
}

// Detect the largest connected white region and outline it as a circle.
function detectWhiteCircle() {
  if (cropCanvas.width === 0 || cropCanvas.height === 0) return;
  
  const imageData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  const data = imageData.data;
  const width = cropCanvas.width;
  const height = cropCanvas.height;
  
  // Create a visited array for flood fill.
  const visited = new Uint8Array(width * height);
  const threshold = 240; // white threshold
  
  let bestRegion = null;
  
  // Flood fill helper to get connected white region.
  function floodFill(x, y) {
    const stack = [[x, y]];
    let minX = x, minY = y, maxX = x, maxY = y;
    let pixelCount = 0;
    
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const idx = cy * width + cx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      
      const dataIdx = idx * 4;
      const r = data[dataIdx];
      const g = data[dataIdx + 1];
      const b = data[dataIdx + 2];
      const a = data[dataIdx + 3];
      
      if (a === 0 || r < threshold || g < threshold || b < threshold) continue;
      
      pixelCount++;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < width - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < height - 1) stack.push([cx, cy + 1]);
    }
    
    return { minX, minY, maxX, maxY, pixelCount };
  }
  
  // Loop through pixels.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      
      const dataIdx = idx * 4;
      const r = data[dataIdx];
      const g = data[dataIdx + 1];
      const b = data[dataIdx + 2];
      const a = data[dataIdx + 3];
      
      if (a > 0 && r >= threshold && g >= threshold && b >= threshold) {
        const region = floodFill(x, y);
        if (region.pixelCount > 50) {
          if (!bestRegion || region.pixelCount > bestRegion.pixelCount) {
            bestRegion = region;
          }
        }
      }
    }
  }
  
  if (bestRegion) {
    // Calculate center and radius.
    const centerX = (bestRegion.minX + bestRegion.maxX) / 2;
    const centerY = (bestRegion.minY + bestRegion.maxY) / 2;
    const radius = Math.max(bestRegion.maxX - bestRegion.minX, bestRegion.maxY - bestRegion.minY) / 2;
    detectedCircle = { x: centerX, y: centerY, radius };
    
    // Redraw image and overlay detection.
    cropCtx.putImageData(imageData, 0, 0);
    cropCtx.beginPath();
    cropCtx.lineWidth = 3;
    cropCtx.strokeStyle = '#00FF00';
    cropCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    cropCtx.stroke();
    
    // Once a circle is detected, run auto mapping update.
    updateAutoMap();
  } else {
    detectedCircle = null;
  }
}

// Get video container's offset relative to the page.
function getContainerOffset() {
  const rect = videoContainer.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

// Update crop settings based on overlay selection.
function updateCropSettingsFromOverlay() {
  const containerRect = videoContainer.getBoundingClientRect();
  const overlayRect = cropOverlay.getBoundingClientRect();

  const scaleX = screenVideo.videoWidth / containerRect.width;
  const scaleY = screenVideo.videoHeight / containerRect.height;

  const offsetX = overlayRect.left - containerRect.left;
  const offsetY = overlayRect.top - containerRect.top;

  cropSettings = {
    x: Math.round(offsetX * scaleX),
    y: Math.round(offsetY * scaleY),
    width: Math.round(overlayRect.width * scaleX),
    height: Math.round(overlayRect.height * scaleY)
  };

  // Update canvas sizes.
  cropCanvas.width = cropSettings.width;
  cropCanvas.height = cropSettings.height;
  mapCanvas.width = cropSettings.width;
  mapCanvas.height = cropSettings.height;
}

// Mouse event handlers for drag selection.
videoContainer.addEventListener('mousedown', (e) => {
  if (!captureStream) return;
  isDragging = true;
  const containerRect = videoContainer.getBoundingClientRect();
  startX = e.clientX - containerRect.left;
  startY = e.clientY - containerRect.top;
  cropOverlay.style.left = `${startX}px`;
  cropOverlay.style.top = `${startY}px`;
  cropOverlay.style.width = `0px`;
  cropOverlay.style.height = `0px`;
  cropOverlay.style.pointerEvents = 'auto';
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const containerRect = videoContainer.getBoundingClientRect();
  const currentX = e.clientX - containerRect.left;
  const currentY = e.clientY - containerRect.top;

  const rectX = Math.min(startX, currentX);
  const rectY = Math.min(startY, currentY);
  const rectWidth = Math.abs(currentX - startX);
  const rectHeight = Math.abs(currentY - startY);

  cropOverlay.style.left = `${rectX}px`;
  cropOverlay.style.top = `${rectY}px`;
  cropOverlay.style.width = `${rectWidth}px`;
  cropOverlay.style.height = `${rectHeight}px`;
});

window.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  cropOverlay.style.pointerEvents = 'none';
  updateCropSettingsFromOverlay();
});

startCaptureButton.addEventListener('click', () => {
  startCapture();
});

// Auto Map update function – continuously checks for the white circle’s tile position
function updateAutoMap() {
  if (!detectedCircle) return;
  
  // Use circle's diameter as tile size.
  const tileSize = detectedCircle.radius * 2;
  const cols = Math.floor(cropCanvas.width / tileSize);
  const rows = Math.floor(cropCanvas.height / tileSize);
  
  // Sample brightness for each tile.
  gridCurrent = [];
  for (let r = 0; r < rows; r++) {
    gridCurrent[r] = [];
    for (let c = 0; c < cols; c++) {
      const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      // 0 for empty (dark), 1 for tile present.
      gridCurrent[r][c] = avg < 80 ? 0 : 1;
      
      // Merge into overall map.
      const key = `${r},${c}`;
      if (!(key in gridAll)) {
        gridAll[key] = gridCurrent[r][c];
      }
    }
  }
  
  // Determine current player tile based on white circle center.
  const currentCol = Math.floor(detectedCircle.x / tileSize);
  const currentRow = Math.floor(detectedCircle.y / tileSize);
  
  // Initialize playerTile if null.
  if (!playerTile) {
    playerTile = { row: currentRow, col: currentCol };
  } else {
    // If moved, update player tile.
    if (playerTile.row !== currentRow || playerTile.col !== currentCol) {
      playerTile = { row: currentRow, col: currentCol };
    }
  }
  
  drawCurrentMap(tileSize, rows, cols);
  drawLargeMap(tileSize);
}

// Draw current cropped map with grid and marker.
function drawCurrentMap(tileSize, rows, cols) {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      mapCtx.strokeStyle = '#555';
      mapCtx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      if (gridCurrent[r][c] === 1) {
        mapCtx.fillStyle = 'rgba(0,0,0,0.3)';
        mapCtx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
  }
  
  // Draw red square marker at player's tile.
  const markerX = playerTile.col * tileSize + tileSize / 2;
  const markerY = playerTile.row * tileSize + tileSize / 2;
  const squareSize = detectedCircle.radius;
  mapCtx.strokeStyle = '#FF0000';
  mapCtx.lineWidth = 2;
  mapCtx.strokeRect(
    markerX - squareSize / 2,
    markerY - squareSize / 2,
    squareSize,
    squareSize
  );
  
  // Draw player's position as a white dot.
  mapCtx.beginPath();
  mapCtx.fillStyle = '#FFFFFF';
  mapCtx.arc(markerX, markerY, 4, 0, 2 * Math.PI);
  mapCtx.fill();
}

// Draw full explored map on the large map canvas.
function drawLargeMap(tileSize) {
  // Determine bounds from gridAll keys.
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  Object.keys(gridAll).forEach(key => {
    const [r, c] = key.split(',').map(Number);
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
  });
  
  const totalRows = maxRow - minRow + 1;
  const totalCols = maxCol - minCol + 1;
  
  // Set large map canvas to accommodate full grid (scale factor 20 for visibility).
  const scale = 20;
  largeMapCanvas.width = totalCols * scale;
  largeMapCanvas.height = totalRows * scale;
  
  largeMapCtx.clearRect(0, 0, largeMapCanvas.width, largeMapCanvas.height);
  
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      // Draw cell background.
      if (gridAll[key] === 1) {
        largeMapCtx.fillStyle = 'rgba(0,0,0,0.3)';
      } else {
        largeMapCtx.fillStyle = '#DDD';
      }
      const drawX = (c - minCol) * scale;
      const drawY = (r - minRow) * scale;
      largeMapCtx.fillRect(drawX, drawY, scale, scale);
      largeMapCtx.strokeStyle = '#999';
      largeMapCtx.strokeRect(drawX, drawY, scale, scale);
    }
  }
  
  // Mark player's position on the large map.
  if (playerTile) {
    const playerDrawX = (playerTile.col - minCol) * scale + scale / 2;
    const playerDrawY = (playerTile.row - minRow) * scale + scale / 2;
    largeMapCtx.beginPath();
    largeMapCtx.fillStyle = '#FFFFFF';
    largeMapCtx.arc(playerDrawX, playerDrawY, scale/5, 0, 2 * Math.PI);
    largeMapCtx.fill();
  }
}

// Continuously update auto map every 500ms.
if (!autoMapInterval) {
  autoMapInterval = setInterval(() => {
    if (detectedCircle) {
      updateAutoMap();
    }
  }, 500);
}