const startCaptureButton = document.getElementById('startCaptureButton');
const autoMapButton = document.getElementById('autoMapButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');

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

// Global merged map variable to store persistent mapping details.
let mergedGrid = [];

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

// Auto Map functionality with continuous mapping merge.
// This function analyzes the cropped feed, uses the detected white circle's diameter as tile size,
// creates a grid map from the current cropped output, and then continuously updates (merges) mapping data
// based on the marker's moves (assumes user only moves 1 tile at a time).
function autoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  
  // Set tile size as circle's diameter.
  const tileSize = detectedCircle.radius * 2;
  const cols = Math.floor(cropCanvas.width / tileSize);
  const rows = Math.floor(cropCanvas.height / tileSize);
  
  // Create initial grid for mapping.
  let grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      // Sample average brightness for each tile.
      const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i+=4) {
        // Grayscale value.
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      // If average brightness is less than 80, consider it empty.
      grid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  
  // Initialize mergedGrid with initial grid data.
  mergedGrid = grid.map(row => row.slice());
  
  // Determine starting position: tile containing the white circle center.
  const startCol = Math.floor(detectedCircle.x / tileSize);
  const startRow = Math.floor(detectedCircle.y / tileSize);
  
  // Marker object to animate.
  let marker = { row: startRow, col: startCol };
  
  // Function to redraw the full map with merged data and the marker.
  function drawMap() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    // Draw merged grid.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        mapCtx.strokeStyle = '#555';
        mapCtx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
        // If tile marked as occupied (1), fill tile.
        if (mergedGrid[r][c] === 1) {
          mapCtx.fillStyle = 'rgba(0,0,0,0.3)';
          mapCtx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
        }
      }
    }
    // Draw marker circle.
    mapCtx.beginPath();
    mapCtx.lineWidth = 2;
    mapCtx.strokeStyle = '#FF0000';
    const markerX = marker.col * tileSize + tileSize / 2;
    const markerY = marker.row * tileSize + tileSize / 2;
    mapCtx.arc(markerX, markerY, detectedCircle.radius / 2, 0, 2 * Math.PI);
    mapCtx.stroke();
  }
  
  drawMap();
  
  // Function to update local grid based on current cropped feed for the tiles around the marker.
  function updateLocalGrid() {
    // Update tiles in a 3x3 region surrounding the current marker.
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = marker.row + dr;
        const c = marker.col + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          try {
            const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
            let total = 0;
            const data = imageData.data;
            for (let i = 0; i < data.length; i +=4) {
              total += (data[i] + data[i+1] + data[i+2]) / 3;
            }
            const avg = total / (data.length/4);
            // Update merged grid: if new reading shows a tile is occupied, mark as occupied.
            const newVal = avg < 80 ? 0 : 1;
            // Here, if any update shows occupancy, we lock that tile.
            if (newVal === 1 || mergedGrid[r][c] === 1) {
              mergedGrid[r][c] = 1;
            } else {
              mergedGrid[r][c] = 0;
            }
          } catch (ex) {
            console.warn("Error updating local grid at tile", r, c, ex);
          }
        }
      }
    }
  }
  
  // Simple algorithm: continuously try to move marker in random direction (up, down, left, right)
  // and update merging in local area.
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];
  
  const interval = setInterval(() => {
    // Before moving, update local grid from current feed.
    updateLocalGrid();
    
    let moved = false;
    // Try random direction moving one tile at a time.
    for (let attempt = 0; attempt < 4; attempt++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const newRow = marker.row + dir.dr;
      const newCol = marker.col + dir.dc;
      // Check boundaries.
      if (newRow >= 0 && newRow < rows && newCol >= 0 && newCol < cols) {
        // Move only if destination is empty in the merged grid.
        if (mergedGrid[newRow][newCol] === 0) {
          marker.row = newRow;
          marker.col = newCol;
          moved = true;
          break;
        }
      }
    }
    if (!moved) {
      // If unable to move after several tries, do not change the marker.
    }
    drawMap();
  }, 500); // Update every 500ms.
}

autoMapButton.addEventListener('click', autoMap);