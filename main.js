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
    } catch (e) {
      console.warn('Video not ready for drawing', e);
    }
  }
  requestAnimationFrame(updateCrop);
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