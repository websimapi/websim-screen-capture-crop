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

// Global variables for live mapping
let liveMapping = false;
let liveMapInterval = null;
let globalMarker = null; // current marker position from autoMap
let initialGlobalPosition = null;  // initial position for persistent mapping

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
  
  const tileSize = detectedCircle.radius * 2;
  const cols = Math.floor(cropCanvas.width / tileSize);
  const rows = Math.floor(cropCanvas.height / tileSize);
  
  // Create grid with brightness sampling.
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const imageData = cropCtx.getImageData(c * tileSize, r * tileSize, tileSize, tileSize);
      let total = 0;
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      grid[r][c] = avg < 80 ? 0 : 1;
    }
  }
  
  // Draw the initial grid map.
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
  
  // Marker object to animate.
  let marker = { row: 0, col: 0 };
  // Determine starting marker tile.
  marker.col = Math.floor(detectedCircle.x / tileSize);
  marker.row = Math.floor(detectedCircle.y / tileSize);
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
    const markerX = marker.col * tileSize + tileSize / 2;
    const markerY = marker.row * tileSize + tileSize / 2;
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
  
  // Animate marker movement.
  const interval = setInterval(() => {
    let moved = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const newRow = marker.row + dir.dr;
      const newCol = marker.col + dir.dc;
      if (newRow >= 0 && newRow < rows && newCol >= 0 && newCol < cols) {
        if (grid[newRow][newCol] === 0) {
          marker.row = newRow;
          marker.col = newCol;
          moved = true;
          break;
        }
      }
    }
    if (!moved) {
      clearInterval(interval);
      if (liveMapping) {
        stopLiveMapping();
      }
    }
    globalMarker = { ...marker };
    drawMarker();
  }, 500);
}

// Live Map functionality.
// This will keep a persistent mapping of the user's traveled path.
// It uses the global marker position from autoMap and maps it on a persistent canvas.
function startLiveMapping() {
  if (!globalMarker || !initialGlobalPosition) {
    alert("Please run Auto Map first to establish a reference point.");
    return;
  }
  liveMapping = true;
  // Set persistent map canvas size to a larger area.
  persistentMapCanvas.width = cropCanvas.width * 2;
  persistentMapCanvas.height = cropCanvas.height * 2;
  // Fill background.
  persistentMapCtx.fillStyle = '#eee';
  persistentMapCtx.fillRect(0, 0, persistentMapCanvas.width, persistentMapCanvas.height);
  // Draw initial marker on persistent map at center.
  const centerX = persistentMapCanvas.width / 2;
  const centerY = persistentMapCanvas.height / 2;
  // Store the last drawn persistent position.
  let lastPersistentPos = { x: centerX, y: centerY };
  
  liveMapInterval = setInterval(() => {
    // Calculate offset relative to initialGlobalPosition.
    const deltaCol = globalMarker.col - initialGlobalPosition.col;
    const deltaRow = globalMarker.row - initialGlobalPosition.row;
    // Assume each tile in persistent map is scaled similarly.
    const tileSize = detectedCircle.radius * 2;
    const persistentX = centerX + deltaCol * tileSize;
    const persistentY = centerY + deltaRow * tileSize;
    
    // Draw a line from the last position to the new position.
    persistentMapCtx.beginPath();
    persistentMapCtx.strokeStyle = '#FF0000';
    persistentMapCtx.lineWidth = 3;
    persistentMapCtx.moveTo(lastPersistentPos.x, lastPersistentPos.y);
    persistentMapCtx.lineTo(persistentX, persistentY);
    persistentMapCtx.stroke();
    
    // Draw the marker.
    persistentMapCtx.beginPath();
    persistentMapCtx.arc(persistentX, persistentY, detectedCircle.radius / 2, 0, 2 * Math.PI);
    persistentMapCtx.fillStyle = '#00F';
    persistentMapCtx.fill();
    
    lastPersistentPos = { x: persistentX, y: persistentY };
  }, 500);
}

function stopLiveMapping() {
  liveMapping = false;
  clearInterval(liveMapInterval);
}

autoMapButton.addEventListener('click', autoMap);
liveMapButton.addEventListener('click', () => {
  if (!liveMapping) {
    startLiveMapping();
    liveMapButton.textContent = "Stop Live Map";
  } else {
    stopLiveMapping();
    liveMapButton.textContent = "Start Live Map";
  }
});