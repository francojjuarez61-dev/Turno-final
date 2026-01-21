/* ====== ESTADO VISUAL ====== */
const bgImage = document.getElementById('bg-image');
const bgRgb   = document.getElementById('bg-rgb');
const blurRange = document.getElementById('blur-range');
const rgbToggle = document.getElementById('rgb-toggle');

/* Cargar estado guardado */
const savedBg = localStorage.getItem('bgImage');
const savedBlur = localStorage.getItem('bgBlur');
const savedRgb = localStorage.getItem('bgRgb') === 'true';

if (savedBg) bgImage.style.backgroundImage = `url(${savedBg})`;
if (savedBlur) {
  document.documentElement.style.setProperty('--bg-blur', savedBlur + 'px');
  blurRange.value = savedBlur;
}
if (savedRgb) {
  bgRgb.classList.add('active');
  rgbToggle.checked = true;
}

/* Imagen de fondo */
document.getElementById('bg-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    bgImage.style.backgroundImage = `url(${ev.target.result})`;
    localStorage.setItem('bgImage', ev.target.result);
  };
  reader.readAsDataURL(file);
});

/* Quitar imagen */
document.getElementById('bg-remove').onclick = () => {
  bgImage.style.backgroundImage = '';
  localStorage.removeItem('bgImage');
};

/* Blur */
blurRange.oninput = e => {
  const v = e.target.value;
  document.documentElement.style.setProperty('--bg-blur', v + 'px');
  localStorage.setItem('bgBlur', v);
};

/* RGB toggle */
rgbToggle.onchange = e => {
  bgRgb.classList.toggle('active', e.target.checked);
  localStorage.setItem('bgRgb', e.target.checked);
};

/* ====== MODAL ====== */
const modal = document.getElementById('customize-modal');
document.getElementById('btn-customize').onclick = () => modal.hidden = false;
document.getElementById('close-customize').onclick = () => modal.hidden = true;

/* ====== BOTÓN CENTRAL (placeholder lógica) ====== */
const mainBtn = document.getElementById('main-btn');
let running = false;

mainBtn.onclick = () => {
  running = !running;
  mainBtn.querySelector('#btn-label').textContent = running ? 'Finalizar' : 'Iniciar';
  if (navigator.vibrate) navigator.vibrate(30);
};
