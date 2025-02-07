const startCaptureButton = document.getElementById('startCaptureButton');
const screenVideo = document.getElementById('screenVideo');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const videoContainer = document.getElementById('videoContainer');
const cropOverlay = document.getElementById('cropOverlay');

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

// Start screen capture
async function startCapture() {
  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo.srcObject = captureStream;
    // Wait for video metadata to load to know dimensions
    screenVideo.onloadedmetadata = () => {
      // Set default canvas dimensions based on video cropping settings.
      cropCanvas.width = cropSettings.width;
      cropCanvas.height = cropSettings.height;
      requestAnimationFrame(updateCrop);
    }
  } catch (error) {
    console.error('Error accessing display media.', error);
  }
}

// Continuously update the crop output canvas from the video feed.
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
      // After drawing the cropped image, attempt to detect a white circle.
      detectWhiteCircle();
    } catch (e) {
      console.warn('Video not ready for drawing', e);
    }
  }
  requestAnimationFrame(updateCrop);
}

// Detect a white circle in the cropped canvas and outline it.
// A simple approach: scan image data to find white-ish pixels, compute bounding box, then draw a circle.
function detectWhiteCircle() {
  if (cropCanvas.width === 0 || cropCanvas.height === 0) return;
  
  const imageData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  const data = imageData.data;
  
  let minX = cropCanvas.width, minY = cropCanvas.height;
  let maxX = 0, maxY = 0;
  let found = false;
  
  // Threshold for white: all channels above a certain value.
  const threshold = 240;
  
  for (let y = 0; y < cropCanvas.height; y++) {
    for (let x = 0; x < cropCanvas.width; x++) {
      const index = (y * cropCanvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      
      // Check if pixel is almost white
      if (a > 0 && r >= threshold && g >= threshold && b >= threshold) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  
  if (found) {
    // Clear previous overlay drawing by redrawing the image before drawing the outline.
    // Get center and approximate radius.
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radius = Math.max((maxX - minX), (maxY - minY)) / 2;
    
    // Draw a green circle outlining the detected white area.
    cropCtx.beginPath();
    cropCtx.lineWidth = 3;
    cropCtx.strokeStyle = '#00FF00';
    cropCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    cropCtx.stroke();
  }
}

// Get the offset of the videoContainer relative to the page.
function getContainerOffset() {
  const rect = videoContainer.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

// Convert overlay selection dimensions to video coordinates.
function updateCropSettingsFromOverlay() {
  // Current overlay bounding box relative to videoContainer.
  const containerRect = videoContainer.getBoundingClientRect();
  const overlayRect = cropOverlay.getBoundingClientRect();

  // Calculate relative selection coordinates.
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

  // Update canvas dimensions based on new crop dimensions.
  cropCanvas.width = cropSettings.width;
  cropCanvas.height = cropSettings.height;
}

// Mouse event handlers for drag selection on the video container.
videoContainer.addEventListener('mousedown', (e) => {
  // Only activate if screen capture started.
  if (!captureStream) return;
  isDragging = true;
  const containerRect = videoContainer.getBoundingClientRect();
  startX = e.clientX - containerRect.left;
  startY = e.clientY - containerRect.top;
  // Initialize overlay element.
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

  // Calculate dimensions for the overlay.
  const rectX = Math.min(startX, currentX);
  const rectY = Math.min(startY, currentY);
  const rectWidth = Math.abs(currentX - startX);
  const rectHeight = Math.abs(currentY - startY);

  // Update overlay style.
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