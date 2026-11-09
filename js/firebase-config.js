// Настройки Firebase. Как их получить и вставить — в README.md, шаги 2 и 8.
// Пока здесь стоит «ВСТАВЬТЕ_СЮДА», приложение работает без общего прогресса:
// отметки сохраняются только на этом телефоне.
// Эти настройки не секретные: данные защищают правила Firestore (файл firestore.rules).

export const firebaseConfig = {
  apiKey: 'AIzaSyD2ubzpzum2nS5V7Uh8hVJvcTFw07vxke8',
  authDomain: 'batonchik-vepritskiy.firebaseapp.com',
  projectId: 'batonchik-vepritskiy',
  storageBucket: 'batonchik-vepritskiy.firebasestorage.app',
  messagingSenderId: '38227995827',
  appId: '1:38227995827:web:833b814ac8d462f92914c6',
  // Ключ для уведомлений (Firebase → Настройки проекта → Cloud Messaging → Web Push certificates).
  // Он тоже не секретный. Пока пусто — уведомления не включаются (README, раздел «Уведомления»)
  vapidKey: 'BP_1WQXDRePSOLjm7F5uvfunhh7b0FTmfqlzS3JdojEjUdbVsO7FpMY4GPF4x8aNix-RhuuBRPcWoWMjyk1ibJM',
};
