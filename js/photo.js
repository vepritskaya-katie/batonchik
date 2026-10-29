// Фото с телефона: выбрать и сжать до JPEG разумного размера (строка data:image/jpeg;base64,…),
// чтобы оно поместилось в документ Firestore (до ~0,9 МБ) и быстро загружалось.

export function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
    input.click();
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть фото'));
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
