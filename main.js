const startCaptureButton = document.getElementById('startCaptureButton');
const autoMapButton = document.getElementById('autoMapButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
const tileInfoDiv = document.getElementById('tileInfo');

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
let detectedCircle = null; // store detected white circle info

// Auto Map global states
let autoMapInterval = null;
let autoMapRunning = false;
let autoMapTileSize = 0;
let autoMapGrid = null;
let autoMapRows = 0;
let autoMapCols = 0;
let marker = null;  // marker position {row, col}

// Start screen capture using getDisplayMedia.
async function startCapture() {
  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo.srcObject = captureStream;
    screenVideo.onloadedmetadata = () => {
      // Initialize canvas dimensions.
      cropCanvas.width = cropSettings.width;
      cropCanvas.height = cropSettings.height;
      // Set map canvas size to match cropped area for simplicity.
      mapCanvas.width = cropSettings.width;
      mapCanvas.height = cropSettings.height;
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
  
  // Threshold value for considering a pixel white.
  const threshold = 240;
  
  let bestRegion = null;
  
  // Helper: perform flood fill to get connected white region.
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
      
      // Check neighbors.
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < width - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < height - 1) stack.push([cx, cy + 1]);
    }
    
    return { minX, minY, maxX, maxY, pixelCount };
  }
  
  // Loop through pixels and apply flood fill for white areas.
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
        // Consider region only if it's of a reasonable size.
        if (region.pixelCount > 50) {
          if (!bestRegion || region.pixelCount > bestRegion.pixelCount) {
            bestRegion = region;
          }
        }
      }
    }
  }
  
  // If found a best region, draw a circle:
  if (bestRegion) {
    const centerX = (bestRegion.minX + bestRegion.maxX) / 2;
    const centerY = (bestRegion.minY + bestRegion.maxY) / 2;
    const radius = Math.max(bestRegion.maxX - bestRegion.minX, bestRegion.maxY - bestRegion.minY) / 2;
    
    // Store detected circle for auto mapping.
    detectedCircle = { x: centerX, y: centerY, radius };
    
    // Clear any previous overlay by redrawing the image data.
    cropCtx.putImageData(imageData, 0, 0);
    
    cropCtx.beginPath();
    cropCtx.lineWidth = 3;
    cropCtx.strokeStyle = '#00FF00';
    cropCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    cropCtx.stroke();
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

// Toggle Auto Map functionality.
// When auto mapping is on, continuously update our mapped feed and animate the marker.
function toggleAutoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  if (!autoMapRunning) {
    // Set tile size as circle's diameter.
    autoMapTileSize = detectedCircle.radius * 2;
    autoMapCols = Math.floor(cropCanvas.width / autoMapTileSize);
    autoMapRows = Math.floor(cropCanvas.height / autoMapTileSize);
    // Create initial grid.
    autoMapGrid = createGrid();
    // Starting position: find the tile containing the white circle center.
    const startCol = Math.floor(detectedCircle.x / autoMapTileSize);
    const startRow = Math.floor(detectedCircle.y / autoMapTileSize);
    
    marker = { row: startRow, col: startCol };
    autoMapButton.textContent = 'Stop Auto Map';
    autoMapRunning = true;
    autoMapInterval = setInterval(() => {
      // Update grid on every interval.
      autoMapGrid = createGrid();
      // Move marker.
      moveMarker();
      // Draw mapped feed.
      drawMappedFeed();
    }, 500);
  } else {
    clearInterval(autoMapInterval);
    autoMapInterval = null;
    autoMapRunning = false;
    autoMapButton.textContent = 'Start Auto Map';
  }
}

autoMapButton.addEventListener('click', toggleAutoMap);

// Create grid that reflects the cropped feed.
// Each cell is 1 for non-empty, 0 for empty (if average brightness < 80).
function createGrid() {
  const grid = [];
  for (let r = 0; r < autoMapRows; r++) {
    grid[r] = [];
    for (let c = 0; c < autoMapCols; c++) {
      // Sample average brightness for each tile.
      const imageData = cropCtx.getImageData(c * autoMapTileSize, r * autoMapTileSize, autoMapTileSize, autoMapTileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      // If average brightness is less than 80, consider it empty.
      grid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  return grid;
}

// Move marker in random valid direction (up, down, left, right) if destination cell is empty.
function moveMarker() {
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];
  
  let moved = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const newRow = marker.row + dir.dr;
    const newCol = marker.col + dir.dc;
    if (newRow >= 0 && newRow < autoMapRows && newCol >= 0 && newCol < autoMapCols) {
      if (autoMapGrid[newRow][newCol] === 0) {
        marker.row = newRow;
        marker.col = newCol;
        moved = true;
        break;
      }
    }
  }
  // If unable to move, do nothing.
}

// Draw the grid map on the mapCanvas, including the red square marker and the white dot representing the player.
function drawMappedFeed() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  // Draw grid.
  for (let r = 0; r < autoMapRows; r++) {
    for (let c = 0; c < autoMapCols; c++) {
      mapCtx.strokeStyle = '#555';
      mapCtx.strokeRect(c * autoMapTileSize, r * autoMapTileSize, autoMapTileSize, autoMapTileSize);
      if (autoMapGrid[r][c] === 1) {
        mapCtx.fillStyle = 'rgba(0,0,0,0.3)';
        mapCtx.fillRect(c * autoMapTileSize, r * autoMapTileSize, autoMapTileSize, autoMapTileSize);
      }
    }
  }
  // Draw red square marker.
  const markerX = marker.col * autoMapTileSize + autoMapTileSize / 2;
  const markerY = marker.row * autoMapTileSize + autoMapTileSize / 2;
  const squareSize = detectedCircle.radius; // set square side based on circle radius.
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

// Compute percentage of black pixels in a tile.
// We define a pixel as black if its grayscale value is less than 80.
function computeBlackPercentage(tileX, tileY, tileSize) {
  const imageData = cropCtx.getImageData(tileX, tileY, tileSize, tileSize);
  const data = imageData.data;
  let darkCount = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i+1] + data[i+2]) / 3;
    if (avg < 80) darkCount++;
  }
  return ((darkCount / total) * 100).toFixed(2);
}

// Add hover functionality on the mapped feed to show black percentage for each tile.
mapCanvas.addEventListener('mousemove', (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  if (autoMapTileSize <= 0) return;
  const tileCol = Math.floor(mouseX / autoMapTileSize);
  const tileRow = Math.floor(mouseY / autoMapTileSize);
  if (tileCol < 0 || tileRow < 0 || tileCol >= autoMapCols || tileRow >= autoMapRows) {
    tileInfoDiv.textContent = '';
    return;
  }
  const tileX = tileCol * autoMapTileSize;
  const tileY = tileRow * autoMapTileSize;
  const blackPercent = computeBlackPercentage(tileX, tileY, autoMapTileSize);
  tileInfoDiv.textContent = `Tile [${tileRow}, ${tileCol}] Black Percentage: ${blackPercent}%`;
});

mapCanvas.addEventListener('mouseleave', () => {
  tileInfoDiv.textContent = '';
});