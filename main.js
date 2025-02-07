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
const fullMapCanvas = document.getElementById('fullMapCanvas');

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

// New globals for full map merging.
let globalMarker = null; // global position of the white dot (in tile units)
let fullMap = {};        // object to store merged tile data, key: "row,col"

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
  
  // Threshold for "white".
  const threshold = 240;
  
  let bestRegion = null;
  
  // Perform flood fill to get a connected white region.
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
    const centerX = (bestRegion.minX + bestRegion.maxX) / 2;
    const centerY = (bestRegion.minY + bestRegion.maxY) / 2;
    const radius = Math.max(bestRegion.maxX - bestRegion.minX, bestRegion.maxY - bestRegion.minY) / 2;
    
    detectedCircle = { x: centerX, y: centerY, radius };
    
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

  cropCanvas.width = cropSettings.width;
  cropCanvas.height = cropSettings.height;
  mapCanvas.width = cropSettings.width;
  mapCanvas.height = cropSettings.height;
}

// Event handlers for drag selection.
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

window.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  cropOverlay.style.pointerEvents = 'none';
  updateCropSettingsFromOverlay();
});

startCaptureButton.addEventListener('click', () => {
  startCapture();
});

// Toggle Auto Map: update mapped feed, move marker, and merge into a full map.
function toggleAutoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  if (!autoMapRunning) {
    autoMapTileSize = detectedCircle.radius * 2;
    autoMapCols = Math.floor(cropCanvas.width / autoMapTileSize);
    autoMapRows = Math.floor(cropCanvas.height / autoMapTileSize);
    autoMapGrid = createGrid();
    const startCol = Math.floor(detectedCircle.x / autoMapTileSize);
    const startRow = Math.floor(detectedCircle.y / autoMapTileSize);
    
    marker = { row: startRow, col: startCol };
    // Initialize global marker and full map.
    globalMarker = { row: marker.row, col: marker.col };
    fullMap = {};
    autoMapButton.textContent = 'Stop Auto Map';
    autoMapRunning = true;
    autoMapInterval = setInterval(() => {
      autoMapGrid = createGrid();
      const oldMarker = { row: marker.row, col: marker.col };
      moveMarker();
      drawMappedFeed();
      updateFullMap();
      drawFullMap();
    }, 500);
  } else {
    clearInterval(autoMapInterval);
    autoMapInterval = null;
    autoMapRunning = false;
    autoMapButton.textContent = 'Start Auto Map';
  }
}

autoMapButton.addEventListener('click', toggleAutoMap);

// Create a grid reflecting the cropped feed.
function createGrid() {
  const grid = [];
  for (let r = 0; r < autoMapRows; r++) {
    grid[r] = [];
    for (let c = 0; c < autoMapCols; c++) {
      const imageData = cropCtx.getImageData(c * autoMapTileSize, r * autoMapTileSize, autoMapTileSize, autoMapTileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      grid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  return grid;
}

// Move marker (allowing up to 8-directional moves) if destination tile is empty.
function moveMarker() {
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 }
  ];
  const shuffled = directions.sort(() => 0.5 - Math.random());
  const oldMarker = { row: marker.row, col: marker.col };
  for (const dir of shuffled) {
    const newRow = marker.row + dir.dr;
    const newCol = marker.col + dir.dc;
    if (newRow >= 0 && newRow < autoMapRows && newCol >= 0 && newCol < autoMapCols) {
      if (autoMapGrid[newRow][newCol] === 0) {
        marker.row = newRow;
        marker.col = newCol;
        // Update global marker using the delta move.
        if (globalMarker) {
          globalMarker.row += (newRow - oldMarker.row);
          globalMarker.col += (newCol - oldMarker.col);
        } else {
          globalMarker = { row: newRow, col: newCol };
        }
        return;
      }
    }
  }
}

// Draw the mapped feed with grid, red square marker, and white dot.
function drawMappedFeed() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
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
  const markerX = marker.col * autoMapTileSize + autoMapTileSize / 2;
  const markerY = marker.row * autoMapTileSize + autoMapTileSize / 2;
  const squareSize = detectedCircle ? detectedCircle.radius : autoMapTileSize / 2;
  mapCtx.strokeStyle = '#FF0000';
  mapCtx.lineWidth = 2;
  mapCtx.strokeRect(
    markerX - squareSize / 2,
    markerY - squareSize / 2,
    squareSize,
    squareSize
  );
  mapCtx.beginPath();
  mapCtx.fillStyle = '#FFFFFF';
  mapCtx.arc(markerX, markerY, 4, 0, 2 * Math.PI);
  mapCtx.fill();
}

// Compute percentage of black pixels in a tile.
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

// Show black percentage on hover.
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

// Merge the current autoMap grid into the overall full map.
function updateFullMap() {
  if (!globalMarker || !autoMapGrid) return;
  // Calculate patch origin so that the local marker maps to the global marker.
  const patchOrigin = {
    row: globalMarker.row - marker.row,
    col: globalMarker.col - marker.col
  };
  for (let r = 0; r < autoMapRows; r++) {
    for (let c = 0; c < autoMapCols; c++) {
      const globalRow = patchOrigin.row + r;
      const globalCol = patchOrigin.col + c;
      const key = globalRow + ',' + globalCol;
      if (fullMap[key] === undefined) {
        fullMap[key] = autoMapGrid[r][c];
      }
    }
  }
}

// Render the full map (merged grid) on the fullMapCanvas.
function drawFullMap() {
  const keys = Object.keys(fullMap);
  if (keys.length === 0) return;
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  keys.forEach(key => {
    const [r, c] = key.split(',').map(Number);
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);
  });
  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;
  const tileSize = autoMapTileSize;
  fullMapCanvas.width = numCols * tileSize;
  fullMapCanvas.height = numRows * tileSize;
  const ctx = fullMapCanvas.getContext('2d');
  ctx.clearRect(0, 0, fullMapCanvas.width, fullMapCanvas.height);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = r + ',' + c;
      const tile = fullMap[key];
      const x = (c - minCol) * tileSize;
      const y = (r - minRow) * tileSize;
      ctx.strokeStyle = '#555';
      ctx.strokeRect(x, y, tileSize, tileSize);
      if (tile === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }
  if (globalMarker) {
    const globalX = (globalMarker.col - minCol) * tileSize + tileSize / 2;
    const globalY = (globalMarker.row - minRow) * tileSize + tileSize / 2;
    ctx.beginPath();
    ctx.fillStyle = '#FFFFFF';
    ctx.arc(globalX, globalY, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}