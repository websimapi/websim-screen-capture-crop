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

// Variables for the auto mapping algorithm.
let autoMapInterval = null;

// For the world map: we will continuously re-check the entire grid
// and update a cumulative world map based on changes detected in the crop feed.
let worldMapData = {}; // key: "r,c", value: grid value (0 for empty, 1 for blocked)
let prevGrid = null; // previous snapshot of grid mapping

// Marker state for mapped feed:
// This marker will represent the red square.
// It is initialized once autoMap is triggered.
let marker = null;

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

window.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  cropOverlay.style.pointerEvents = 'none';
  updateCropSettingsFromOverlay();
});

startCaptureButton.addEventListener('click', () => {
  startCapture();
});

// Enhanced Auto Map Section with improved live world map logic
function autoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  
  // Set tile size as circle's diameter.
  const tileSize = detectedCircle.radius * 2;
  const cols = Math.floor(cropCanvas.width / tileSize);
  const rows = Math.floor(cropCanvas.height / tileSize);
  
  // Compute the grid from the current crop canvas.
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      // Ensure tile dimensions are within bounds.
      if ((c + 1) * tileSize > cropCanvas.width || (r + 1) * tileSize > cropCanvas.height) {
        grid[r][c] = 1; // Treat out-of-bound areas as blocked.
        continue;
      }
      const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      // If average brightness is less than 80, consider it empty (0), else blocked (1).
      grid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  
  // Initialize the marker if it hasn't been set yet.
  if (!marker) {
    const startCol = Math.floor(detectedCircle.x / tileSize);
    const startRow = Math.floor(detectedCircle.y / tileSize);
    marker = { row: startRow, col: startCol };
    // Initialize the world map data with the entire current grid.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${r},${c}`;
        worldMapData[key] = grid[r][c];
      }
    }
    // Store a snapshot for later diff comparisons.
    prevGrid = grid.map(row => [...row]);
  } else {
    // Compare current grid with previous snapshot and update world map if changes are detected.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!prevGrid || grid[r][c] !== prevGrid[r][c]) {
          const key = `${r},${c}`;
          worldMapData[key] = grid[r][c];
        }
      }
    }
    // Deep clone current grid as the new previous snapshot.
    prevGrid = grid.map(row => [...row]);
  }
  
  // Draw the grid map on the mapCanvas.
  function drawGrid() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
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
  }
  
  // Draw marker as a red square and the player's position as a white dot.
  function drawMarker() {
    drawGrid();
    const markerX = marker.col * tileSize + tileSize / 2;
    const markerY = marker.row * tileSize + tileSize / 2;
    const squareSize = detectedCircle.radius;
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
  
  // Attempt to move the marker to an adjacent empty tile.
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];
  for (let attempt = 0; attempt < 10; attempt++) {
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const newRow = marker.row + dir.dr;
    const newCol = marker.col + dir.dc;
    if (newRow >= 0 && newRow < rows && newCol >= 0 && newCol < cols && grid[newRow][newCol] === 0) {
      marker.row = newRow;
      marker.col = newCol;
      // Update world map data for the marker's new position.
      const key = `${newRow},${newCol}`;
      worldMapData[key] = grid[newRow][newCol];
      break;
    }
  }
  
  drawMarker();
  drawWorldMap();
}

// Draw world map by checking all collected worldMapData tiles.
function drawWorldMap() {
  // Guard: if marker is not set, do nothing.
  if (!marker) return;
  
  worldMapCtx.clearRect(0, 0, worldMapCanvas.width, worldMapCanvas.height);
  
  // Determine grid extents from collected keys.
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  Object.keys(worldMapData).forEach(key => {
    const [r, c] = key.split(',').map(Number);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  });
  
  // Ensure the marker's current cell is included.
  minR = Math.min(minR, marker.row);
  maxR = Math.max(maxR, marker.row);
  minC = Math.min(minC, marker.col);
  maxC = Math.max(maxC, marker.col);
  
  const gridRows = maxR - minR + 1;
  const gridCols = maxC - minC + 1;
  const cellSize = Math.min(worldMapCanvas.width / gridCols, worldMapCanvas.height / gridRows);
  
  // Draw visited cells based on worldMapData.
  Object.keys(worldMapData).forEach(key => {
    const [r, c] = key.split(',').map(Number);
    const drawR = r - minR;
    const drawC = c - minC;
    if (worldMapData[key] === 0) {
      // Empty tile (visited)
      worldMapCtx.fillStyle = '#cccccc';
    } else {
      // Blocked tile
      worldMapCtx.fillStyle = '#555555';
    }
    worldMapCtx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
    worldMapCtx.strokeStyle = '#999';
    worldMapCtx.strokeRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
  });
  
  // Mark the player's current position (marker).
  const playerDrawR = marker.row - minR;
  const playerDrawC = marker.col - minC;
  worldMapCtx.fillStyle = '#FFFFFF';
  worldMapCtx.beginPath();
  worldMapCtx.arc(playerDrawC * cellSize + cellSize/2, playerDrawR * cellSize + cellSize/2, cellSize/4, 0, 2 * Math.PI);
  worldMapCtx.fill();
}

autoMapButton.addEventListener('click', () => {
  // Clear any existing interval to avoid duplicates.
  if (autoMapInterval) clearInterval(autoMapInterval);
  autoMapInterval = setInterval(autoMap, 500);
});