const startCaptureButton = document.getElementById('startCaptureButton');
const screenVideo = document.getElementById('screenVideo');
const cropForm = document.getElementById('cropForm');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');

let captureStream = null;
let cropSettings = {
  x: 0,
  y: 0,
  width: 300,
  height: 200
};

async function startCapture() {
  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo.srcObject = captureStream;
    // Reset canvas dimensions based on default crop values.
    cropCanvas.width = cropSettings.width;
    cropCanvas.height = cropSettings.height;
    requestAnimationFrame(updateCrop);
  }
  catch (error) {
    console.error('Error accessing display media.', error);
  }
}

function updateCrop() {
  if (screenVideo.readyState >= 2) { // HAVE_CURRENT_DATA
    try {
      // Draw cropped region from video feed to canvas.
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
      // In case video dimensions not ready
      console.warn('Video not ready for drawing', e);
    }
  }
  requestAnimationFrame(updateCrop);
}

cropForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // Update crop settings based on form inputs.
  const x = parseInt(document.getElementById('cropX').value, 10);
  const y = parseInt(document.getElementById('cropY').value, 10);
  const width = parseInt(document.getElementById('cropWidth').value, 10);
  const height = parseInt(document.getElementById('cropHeight').value, 10);
  
  if (!isNaN(x) && !isNaN(y) && width > 0 && height > 0) {
    cropSettings = { x, y, width, height };
    // Update canvas dimension 
    cropCanvas.width = width;
    cropCanvas.height = height;
  }
});

startCaptureButton.addEventListener('click', () => {
  startCapture();
});