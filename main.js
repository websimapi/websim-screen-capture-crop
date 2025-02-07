// Get DOM Elements
const startCaptureButton = document.getElementById('startCaptureButton');
const autoMapButton = document.getElementById('autoMapButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
const worldMapCanvas = document.getElementById('worldMapCanvas');
const worldMapCtx = worldMapCanvas.getContext('2d');
const directionDisplay = document.getElementById('directionDisplay');

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

// Variables for auto mapping.
let autoMapInterval = null;

// For the world map: we maintain an infinite grid using a Map
// Key: "r,c", value: grid value (0 for empty, 1 for blocked)
const worldMapData = new Map();
// We maintain absolute grid coordinates for our cropped feed mapping.
let baseCoordinates = { row: 0, col: 0 };

// Marker (player) state, with absolute grid coordinates.
let marker = null;
// We'll store the previous marker position for movement detection.
let prevMarker = null;

// Setup world map canvas dimensions:
worldMapCanvas.width = 400;
worldMapCanvas.height = 400;

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
  if (screenVideo.readyState >= 2) {
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
      detectWhiteCircle();
    } catch (e) {
      console.warn('Video not ready for drawing', e);
    }
  }
  requestAnimationFrame(updateCrop);
}

// Detect the largest white circle in cropped output.
function detectWhiteCircle() {
  if (cropCanvas.width === 0 || cropCanvas.height === 0) return;

  const imageData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  const data = imageData.data;
  const width = cropCanvas.width;
  const height = cropCanvas.height;

  const visited = new Uint8Array(width * height);
  const threshold = 240; // pixel must be bright enough

  let bestRegion = null;

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
      // Explore 4-neighbor pixels.
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

  // If best region found, draw its circle.
  if (bestRegion) {
    const centerX = (bestRegion.minX + bestRegion.maxX) / 2;
    const centerY = (bestRegion.minY + bestRegion.maxY) / 2;
    const radius = Math.max(bestRegion.maxX - bestRegion.minX, bestRegion.maxY - bestRegion.minY) / 2;
    detectedCircle = { x: centerX, y: centerY, radius };
    // Redraw the image data and overlay the circle.
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

// Get offset of video container.
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

window.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  cropOverlay.style.pointerEvents = 'none';
  updateCropSettingsFromOverlay();
});

startCaptureButton.addEventListener('click', () => {
  startCapture();
});

// Auto Map function with an infinite grid and eight-direction movement detection.
function autoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  // Use the circle's diameter as tile size.
  const tileSize = detectedCircle.radius * 2;
  const cols = Math.floor(cropCanvas.width / tileSize);
  const rows = Math.floor(cropCanvas.height / tileSize);
  // Build a local grid from crop canvas.
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      let cellValue = 1; // default blocked
      // Ensure tile is within bounds.
      if ((c + 1) * tileSize <= cropCanvas.width && (r + 1) * tileSize <= cropCanvas.height) {
        const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
        let total = 0;
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          total += (data[i] + data[i+1] + data[i+2]) / 3;
        }
        const avg = total / (data.length / 4);
        // brightness < 80 means empty.
        cellValue = avg < 80 ? 0 : 1;
      }
      grid[r][c] = cellValue;
    }
  }

  // Determine initial marker if not set.
  if (!marker) {
    // Set initial marker position based on detected circle in local grid.
    const startCol = Math.floor(detectedCircle.x / tileSize);
    const startRow = Math.floor(detectedCircle.y / tileSize);
    // Set absolute coordinates based on current baseCoordinates.
    marker = { row: baseCoordinates.row + startRow, col: baseCoordinates.col + startCol };
    prevMarker = { ...marker };
    // Initialize world map with grid.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const absRow = baseCoordinates.row + r;
        const absCol = baseCoordinates.col + c;
        worldMapData.set(`${absRow},${absCol}`, grid[r][c]);
      }
    }
  } else {
    // Compute movement direction: check current cell in grid where circle is.
    const currentLocalCol = Math.floor(detectedCircle.x / tileSize);
    const currentLocalRow = Math.floor(detectedCircle.y / tileSize);
    // If the detected local cell changes relative to previous local cell, update marker.
    const newAbsRow = baseCoordinates.row + currentLocalRow;
    const newAbsCol = baseCoordinates.col + currentLocalCol;
    // Allowed move if difference in row and col are within [-1,1]
    const dr = newAbsRow - marker.row;
    const dc = newAbsCol - marker.col;
    if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && (dr !== 0 || dc !== 0)) {
      prevMarker = { ...marker };
      marker.row = newAbsRow;
      marker.col = newAbsCol;
      // Update movement direction display.
      const dir = getDirectionFromDelta(dr, dc);
      directionDisplay.textContent = `Moved ${dir}`;
    } else {
      directionDisplay.textContent = `No clear movement detected`;
    }
    // Also update world map data with new grid state.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const absRow = baseCoordinates.row + r;
        const absCol = baseCoordinates.col + c;
        const key = `${absRow},${absCol}`;
        worldMapData.set(key, grid[r][c]);
      }
    }
  }

  drawMappedFeed(grid, tileSize);
  drawWorldMap();
}

// Determine direction string based on delta movement.
function getDirectionFromDelta(dr, dc) {
  const mapping = {
    '-1,-1': 'Up-Left',
    '-1,0': 'Up',
    '-1,1': 'Up-Right',
    '0,-1': 'Left',
    '0,1': 'Right',
    '1,-1': 'Down-Left',
    '1,0': 'Down',
    '1,1': 'Down-Right'
  };
  return mapping[`${dr},${dc}`] || 'Stationary';
}

// Draw the mapped feed on mapCanvas.
function drawMappedFeed(grid, tileSize) {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  const rows = grid.length;
  const cols = grid[0].length;
  // Draw grid.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      mapCtx.strokeStyle = '#555';
      mapCtx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      if (grid[r][c] === 1) {
        mapCtx.fillStyle = 'rgba(0,0,0,0.3)';
        mapCtx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
  }
  // Draw marker as a red square.
  // Translate absolute marker coordinates to local grid space.
  const localRow = marker.row - baseCoordinates.row;
  const localCol = marker.col - baseCoordinates.col;
  if (localRow >= 0 && localRow < rows && localCol >= 0 && localCol < cols) {
    const squareSize = tileSize * 0.8;
    const centerX = localCol * tileSize + tileSize / 2;
    const centerY = localRow * tileSize + tileSize / 2;
    mapCtx.strokeStyle = '#FF0000';
    mapCtx.lineWidth = 2;
    mapCtx.strokeRect(
      centerX - squareSize / 2,
      centerY - squareSize / 2,
      squareSize,
      squareSize
    );
    // Draw the player's position as a white dot in the center.
    mapCtx.beginPath();
    mapCtx.fillStyle = '#FFFFFF';
    mapCtx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
    mapCtx.fill();
  }
}

// Draw the world map (infinite grid) from worldMapData.
function drawWorldMap() {
  worldMapCtx.clearRect(0, 0, worldMapCanvas.width, worldMapCanvas.height);
  // Determine extents from worldMapData keys.
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (let key of worldMapData.keys()) {
    const [r, c] = key.split(',').map(Number);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  // Ensure marker cell is included.
  minR = Math.min(minR, marker.row);
  maxR = Math.max(maxR, marker.row);
  minC = Math.min(minC, marker.col);
  maxC = Math.max(maxC, marker.col);
  const gridRows = maxR - minR + 1;
  const gridCols = maxC - minC + 1;
  const cellSize = Math.min(worldMapCanvas.width / gridCols, worldMapCanvas.height / gridRows);
  // Draw each cell.
  for (let key of worldMapData.keys()) {
    const [r, c] = key.split(',').map(Number);
    const drawR = r - minR;
    const drawC = c - minC;
    const cellVal = worldMapData.get(key);
    worldMapCtx.fillStyle = cellVal === 0 ? '#cccccc' : '#555555';
    worldMapCtx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
    worldMapCtx.strokeStyle = '#999';
    worldMapCtx.strokeRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
  }
  // Mark the player's current position.
  const playerDrawR = marker.row - minR;
  const playerDrawC = marker.col - minC;
  worldMapCtx.fillStyle = '#FFFFFF';
  worldMapCtx.beginPath();
  worldMapCtx.arc(playerDrawC * cellSize + cellSize/2, playerDrawR * cellSize + cellSize/2, cellSize/4, 0, 2 * Math.PI);
  worldMapCtx.fill();
}

autoMapButton.addEventListener('click', () => {
  if (autoMapInterval) clearInterval(autoMapInterval);
  // Run autoMap every 500ms.
  autoMapInterval = setInterval(autoMap, 500);
});