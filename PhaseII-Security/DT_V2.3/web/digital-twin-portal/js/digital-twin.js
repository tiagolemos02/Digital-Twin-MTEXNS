/* =======================================
   Digital-Twin viewer bootstrap & helpers
   ======================================= */
export function initTwinViewer() {
  const viewer = document.getElementById('machineViewer');
  const loader = document.getElementById('twinLoader');
  
  if (!viewer) return; // should never happen

  // Hide spinner once model is ready
  viewer.addEventListener('load', () => loader?.classList.add('hidden'));

  // Pause auto-rotate while user is interacting
  const pause  = () => (viewer.autoRotate = false);
  const resume = () => (viewer.autoRotate = true);
  viewer.addEventListener('mousedown',  pause);
  viewer.addEventListener('touchstart', pause);
  viewer.addEventListener('mouseup',    resume);
  viewer.addEventListener('touchend',   resume);
}

// Optional utility if ever need to switch models on the fly
/*export function loadModel(path){
  const viewer = document.getElementById('machineViewer')
  if (viewer) viewer.src = path;
}*/
