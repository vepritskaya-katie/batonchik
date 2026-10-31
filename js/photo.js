// Фото с телефона: выбрать и сжать до JPEG разумного размера (строка data:image/jpeg;base64,…),
// чтобы оно поместилось в документ Firestore (до ~0,9 МБ) и быстро загружалось.

// Выбор фото с телефона. Поле выбора добавляем на страницу: на iPhone у поля вне страницы
// событие «фото выбраны» иногда не приходит — и кажется, что ничего не произошло.
export function pickPhotos({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.cssText = 'position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    const done = (files) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    input.click();
  });
}

export async function pickPhoto() {
  const files = await pickPhotos();
  return files[0] || null;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('Фото открывается слишком долго')), 30000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}

// max — длинная сторона в пикселях; limit — предельная длина строки
export async function compressPhoto(file, { max = 1280, quality = 0.8, limit = 850000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    let q = quality;
    for (let i = 0; i < 8; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= limit) return data;
      scale *= 0.82;
      q = Math.max(0.55, q - 0.06);
    }
    throw new Error('Фото слишком большое');
  } finally {
    URL.revokeObjectURL(url);
  }
}
