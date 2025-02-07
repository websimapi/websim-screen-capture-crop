// Global DOM Elements
const startCaptureButton = document.getElementById('startCaptureButton');
const autoMapButton = document.getElementById('autoMapButton');
const liveMapButton = document.getElementById('liveMapButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
const persistentMapCanvas = document.getElementById('persistentMapCanvas');
const persistentMapCtx = persistentMapCanvas.getContext('2d');

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

// Global variables for auto mapping
let globalMarker = null; // current marker position from autoMap
let initialGlobalPosition = null;  // initial position for persistent mapping
let autoMapGrid = null;
let gridRows = 0;
let gridCols = 0;
let gridTileSize = 0;

// Global variable for live mapping
let liveMapping = false;
let liveMapRequestID = null;

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
  
  const visited = new Uint8Array(width * height);
  const threshold = 240;
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
    
    // Redraw the current crop image to clear previously drawn overlays.
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

// Auto Map functionality.
// This function analyzes the cropped feed, uses the detected white circle as a reference,
// and then simulates marker movement on a grid mapped based on the circle's diameter.
function autoMap() {
  if (!detectedCircle) {
    alert("White circle not detected. Please ensure the white circle is visible in the cropped output.");
    return;
  }
  
  gridTileSize = detectedCircle.radius * 2;
  gridCols = Math.floor(cropCanvas.width / gridTileSize);
  gridRows = Math.floor(cropCanvas.height / gridTileSize);
  
  // Create grid with brightness sampling.
  autoMapGrid = [];
  for (let r = 0; r < gridRows; r++) {
    autoMapGrid[r] = [];
    for (let c = 0; c < gridCols; c++) {
      const imageData = cropCtx.getImageData(c * gridTileSize, r * gridTileSize, gridTileSize, gridTileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      autoMapGrid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  
  // Draw the initial grid map.
  function drawGrid() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        mapCtx.strokeStyle = '#555';
        mapCtx.strokeRect(c * gridTileSize, r * gridTileSize, gridTileSize, gridTileSize);
        if (autoMapGrid[r][c] === 1) {
          mapCtx.fillStyle = 'rgba(0,0,0,0.3)';
          mapCtx.fillRect(c * gridTileSize, r * gridTileSize, gridTileSize, gridTileSize);
        }
      }
    }
  }
  
  // Marker object to animate.
  let marker = { row: 0, col: 0 };
  // Determine starting marker tile.
  marker.col = Math.floor(detectedCircle.x / gridTileSize);
  marker.row = Math.floor(detectedCircle.y / gridTileSize);
  // Set global marker for persistent mapping.
  globalMarker = { ...marker };
  // Record the initial marker position for offset calculations.
  initialGlobalPosition = { ...marker };
  
  // Draw marker on the mapped feed.
  function drawMarker() {
    drawGrid();
    mapCtx.beginPath();
    mapCtx.lineWidth = 2;
    mapCtx.strokeStyle = '#FF0000';
    const markerX = marker.col * gridTileSize + gridTileSize / 2;
    const markerY = marker.row * gridTileSize + gridTileSize / 2;
    mapCtx.arc(markerX, markerY, detectedCircle.radius / 2, 0, 2 * Math.PI);
    mapCtx.stroke();
  }
  
  drawMarker();
  
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];
  
  // Animate marker movement using faster intervals.
  const markerMovementInterval = 100; // faster refresh rate
  const autoMapInterval = setInterval(() => {
    let moved = false;
    // Randomly attempt moves.
    for (let attempt = 0; attempt < 4; attempt++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const newRow = marker.row + dir.dr;
      const newCol = marker.col + dir.dc;
      if (newRow >= 0 && newRow < gridRows && newCol >= 0 && newCol < gridCols) {
        if (autoMapGrid[newRow][newCol] === 0) {
          marker.row = newRow;
          marker.col = newCol;
          moved = true;
          break;
        }
      }
    }
    if (!moved) {
      clearInterval(autoMapInterval);
      if (liveMapping) {
        stopLiveMapping();
      }
    }
    globalMarker = { ...marker };
    drawMarker();
  }, markerMovementInterval);
}

autoMapButton.addEventListener('click', autoMap);

// Persistent Live Mapping functionality using requestAnimationFrame for smoother updates.
function startLiveMapping() {
  if (!globalMarker || !initialGlobalPosition || !autoMapGrid) {
    alert("Please run Auto Map first to establish a reference point.");
    return;
  }
  liveMapping = true;
  liveMapButton.textContent = "Stop Live Map";
  // Configure persistent map canvas to be larger and in sync with mapped feed.
  const scaleFactor = 2;
  persistentMapCanvas.width = cropCanvas.width * scaleFactor;
  persistentMapCanvas.height = cropCanvas.height * scaleFactor;
  
  // Start the continuous update loop.
  updatePersistentMap();
}

function updatePersistentMap() {
  if (!liveMapping) return;
  
  // Clear persistent canvas.
  persistentMapCtx.clearRect(0, 0, persistentMapCanvas.width, persistentMapCanvas.height);
  
  // Draw persistent map similar to the mapped feed.
  const scaleFactor = 2;
  // Calculate offset from the initial marker position.
  const deltaCol = globalMarker.col - initialGlobalPosition.col;
  const deltaRow = globalMarker.row - initialGlobalPosition.row;
  
  // Draw the grid.
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cellX = c * gridTileSize * scaleFactor + deltaCol * gridTileSize * scaleFactor;
      const cellY = r * gridTileSize * scaleFactor + deltaRow * gridTileSize * scaleFactor;
      persistentMapCtx.strokeStyle = '#555';
      persistentMapCtx.strokeRect(cellX, cellY, gridTileSize * scaleFactor, gridTileSize * scaleFactor);
      if (autoMapGrid[r][c] === 1) {
        persistentMapCtx.fillStyle = 'rgba(0,0,0,0.3)';
        persistentMapCtx.fillRect(cellX, cellY, gridTileSize * scaleFactor, gridTileSize * scaleFactor);
      }
    }
  }
  
  // Draw the live marker.
  persistentMapCtx.beginPath();
  persistentMapCtx.lineWidth = 2;
  persistentMapCtx.strokeStyle = '#FF0000';
  const markerX = (globalMarker.col * gridTileSize + gridTileSize / 2 + deltaCol * gridTileSize) * scaleFactor;
  const markerY = (globalMarker.row * gridTileSize + gridTileSize / 2 + deltaRow * gridTileSize) * scaleFactor;
  persistentMapCtx.arc(markerX, markerY, (detectedCircle.radius / 2) * scaleFactor, 0, 2 * Math.PI);
  persistentMapCtx.stroke();
  
  liveMapRequestID = requestAnimationFrame(updatePersistentMap);
}

function stopLiveMapping() {
  liveMapping = false;
  liveMapButton.textContent = "Start Live Map";
  if (liveMapRequestID) {
    cancelAnimationFrame(liveMapRequestID);
  }
}

liveMapButton.addEventListener('click', () => {
  if (!liveMapping) {
    startLiveMapping();
  } else {
    stopLiveMapping();
  }
});