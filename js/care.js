// Уход (когти, зубы, вычёсывание, уши, купание), социализация («Новое для Батончика»)
// и «Если потерялся» — списки, подсчёты и картинка-объявление.

import { escapeHtml } from './md.js';
import { dayTitle, plural } from './diary.js';
import { daysBetween } from './passport.js';

// ---------- Уход ----------

// every — раз в сколько дней напоминать по умолчанию (0 — не напоминать); card — тренировка с подробностями
export const CARE_ITEMS = [
  { id: 'nails', icon: '✂️', name: 'Когти', every: 14, what: 'подстричь или подпилить', card: 'kogti' },
  { id: 'teeth', icon: '🪥', name: 'Зубы', every: 2, what: 'почистить', card: 'chistka-zubov-i-smena-zubov' },
  { id: 'brush', icon: '🖌️', name: 'Вычёсывание', every: 3, what: 'вычесать: у аусси густой подшёрсток, колтуны — за ушами, на штанах и под мышками', card: 'vychesyvanie' },
  { id: 'ears', icon: '👂', name: 'Уши', every: 7, what: 'осмотреть: чистые, без запаха и покраснения', card: 'day-posmotryu' },
  { id: 'bath', icon: '🛁', name: 'Купание', every: 0, what: 'только когда испачкался: частое мытьё сушит кожу', card: 'myte' },
];
export const EVERY_OPTIONS = [0, 1, 2, 3, 7, 10, 14, 21, 30, 60, 90];
export const everyText = (n) => (!n ? 'не напоминать' : n === 1 ? 'каждый день' : `раз в ${n} ${plural(n, 'день', 'дня', 'дней')}`);

// Состояние пункта: когда делали в последний раз, сколько дней прошло, пора ли
export function careState(item, data, today) {
  const log = (data && data.log) || [];
  const every = data && data.every != null ? data.every : item.every;
  const last = log.filter((d) => d <= today).pop() || '';
  const days = last ? daysBetween(last, today) : null;
  const due = !!every && (days == null || days >= every);
  return { last, days, every, due, log };
}

export const daysAgoText = (days) => (days == null ? 'ещё не отмечали' : days === 0 ? 'сегодня'
  : days === 1 ? 'вчера' : `${days} ${plural(days, 'день', 'дня', 'дней')} назад`);

// Что пора сделать — для главной: просроченное, начиная с самого давнего
export function careDue(care, today) {
  return CARE_ITEMS.map((item) => ({ item, st: careState(item, care[item.id], today) }))
    .filter(({ st }) => st.due && st.last)
    .sort((a, b) => b.st.days / b.st.every - a.st.days / a.st.every);
}

// ---------- Социализация ----------

export const REACTIONS = {
  calm: { icon: '😌', label: 'Спокойно' },
  alert: { icon: '👀', label: 'Насторожился' },
  scared: { icon: '😟', label: 'Испугался' },
};

// Список нового для щенка в городе. id не меняем: по ним хранятся отметки
export const SOCIAL_GROUPS = [
  { title: 'Люди', items: [
    ['beard', 'Мужчина с бородой'], ['hood', 'Люди в капюшонах и шапках'], ['glasses', 'Тёмные очки, маска на лице'],
    ['toddlers', 'Малыши'], ['schoolkids', 'Школьники с рюкзаками'], ['elderly', 'Пожилой человек с палочкой'],
    ['uniform', 'Люди в форме и ярких жилетах'], ['umbrella', 'Раскрытый зонт'], ['runners', 'Бегуны'],
    ['suitcase', 'Чемодан на колёсиках'], ['guests', 'Гости дома'],
  ] },
  { title: 'Транспорт и техника', items: [
    ['tram', 'Трамвай рядом'], ['bus', 'Автобус на остановке'], ['car', 'Поездка на машине'],
    ['scooter', 'Самокаты и велосипеды'], ['skateboard', 'Скейтборд и ролики'], ['stroller', 'Детская коляска'],
    ['truck', 'Мусоровоз и грузовик'], ['snowplow', 'Снегоуборочная техника'], ['motorcycle', 'Мотоцикл'], ['lift', 'Лифт'],
  ] },
  { title: 'Звуки', items: [
    ['construction', 'Стройка и перфоратор'], ['siren', 'Сирена скорой и полиции'], ['thunder', 'Гроза'],
    ['fireworks', 'Салют и петарды', 'salyuty-i-novyy-god'], ['vacuum', 'Пылесос'], ['hairdryer', 'Фен'],
    ['doorbell', 'Домофон и звонок в дверь'], ['bark-door', 'Лай собаки за дверью'], ['bang', 'Грохот: упала кастрюля, хлопнула дверь'],
  ] },
  { title: 'Места и поверхности', items: [
    ['grates', 'Решётки и люки'], ['tiles', 'Скользкий пол: плитка, кафель'], ['stairs', 'Открытые ступеньки'],
    ['underpass', 'Подземный переход'], ['puddles', 'Лужи и мокрый асфальт'], ['snow', 'Снег и лёд'],
    ['crowd', 'Многолюдная улица'], ['park', 'Парк в выходной'], ['pet-shop', 'Зоомагазин'], ['cafe', 'Кафе, куда пускают с собаками'],
  ] },
  { title: 'Животные', items: [
    ['calm-dog', 'Спокойная взрослая собака'], ['puppy', 'Другой щенок'], ['small-dog', 'Маленькая лающая собака'],
    ['cat', 'Кошка'], ['birds', 'Голуби и вороны'],
  ] },
  { title: 'Уход и врач', items: [
    ['vet-visit', 'Ветклиника: зайти просто так'], ['scale', 'Весы в клинике'], ['exam', 'Осмотр ушей, зубов и лап', 'day-posmotryu'],
    ['muzzle', 'Намордник', 'korzinochnyy-namordnik'], ['paws', 'Мытьё лап и полотенце', 'lapy-posle-progulki-i-reagenty'], ['bath', 'Ванна и душ'],
  ] },
].map((g) => ({ title: g.title, items: g.items.map(([id, name, card]) => ({ id, name, card: card || '' })) }));

export const SOCIAL_ITEMS = SOCIAL_GROUPS.flatMap((g) => g.items);

// Свои пункты: id начинается с «my-», название хранится в базе
export const isOwnSocial = (id) => id.startsWith('my-');

export function socialState(data) {
  const log = ((data && data.log) || []).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const last = log[log.length - 1] || null;
  return { log, last, count: log.length, again: !!last && last.r !== 'calm' };
}

// Отметка за день: одна на пункт, повторное нажатие в тот же день меняет реакцию
export function addReaction(log, day, r) {
  return [...(log || []).filter((x) => x.d !== day), { d: day, r }].sort((a, b) => (a.d < b.d ? -1 : 1));
}

// Сводка: сколько пунктов уже встречали, сколько стоит повторить
export function socialSummary(social) {
  const own = Object.keys(social).filter(isOwnSocial);
  const all = [...SOCIAL_ITEMS.map((x) => x.id), ...own];
  let met = 0;
  let again = 0;
  all.forEach((id) => {
    const st = socialState(social[id]);
    if (st.count) met++;
    if (st.again) again++;
  });
  return { met, again, total: all.length };
}

export function reactionLine(st) {
  if (!st.count) return 'ещё не встречали';
  const r = REACTIONS[st.last.r];
  return `${r.label.toLowerCase()}, ${dayTitle(st.last.d, { day: 'numeric', month: 'long' })}${st.count > 1 ? ` · ${st.count} ${plural(st.count, 'раз', 'раза', 'раз')}` : ''}`;
}

// ---------- Если потерялся ----------

// Шаги на первые часы — коротко, чтобы прочитать на бегу
export const LOST_STEPS = [
  'Не бегите за ним и не кричите: присядьте, позовите спокойно знакомым словом, пошуршите пакетом с лакомством. Испуганная собака от погони убегает дальше.',
  'Один человек остаётся там, где он потерялся, или у подъезда: собаки часто возвращаются на знакомое место.',
  'Отправьте объявление в районные чаты, группы «Потеряшки» вашего района и соседям по дому.',
  'Позвоните в ветклиники и приюты поблизости: туда приносят найденных собак и проверяют чип.',
  'Распечатайте объявления и расклейте в радиусе 1–2 км: у остановок, магазинов, ветклиник, на детских площадках.',
  'Если есть чип — сообщите в базу, где он зарегистрирован, что собака потерялась.',
];

const phonesOf = (lost) => [[lost.name1, lost.phone1], [lost.name2, lost.phone2]]
  .filter(([, p]) => (p || '').trim()).map(([n, p]) => ({ name: (n || '').trim(), phone: p.trim() }));
export const hasLostPhones = (lost) => !!lost && phonesOf(lost).length > 0;

// Строки объявления: заголовок, описание, приметы, телефоны
export function lostLines(pet, lost, age) {
  const p = pet || {};
  const l = lost || {};
  const sex = /сук|девоч/i.test(p.sex || '') ? 'девочка' : /кобел|мальч/i.test(p.sex || '') ? 'мальчик' : '';
  const about = [p.breed, sex, age].filter(Boolean).join(', ');
  return {
    title: 'Потерялась собака',
    name: p.name || 'Батончик',
    about,
    signs: (l.signs || '').trim(),
    chip: (p.chip || '').trim(),
    note: (l.note || '').trim(),
    phones: phonesOf(l),
  };
}

export function lostText(lines) {
  return [
    `${lines.title.toUpperCase()}`,
    `${lines.name} — откликается на кличку.`,
    lines.about,
    lines.signs && `Приметы: ${lines.signs}`,
    lines.chip && `Чип: ${lines.chip}`,
    lines.note,
    lines.phones.length ? `Звоните: ${lines.phones.map((x) => `${x.phone}${x.name ? ` (${x.name})` : ''}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export function lostPosterHtml(lines, photo) {
  return `<div class="poster">
    <p class="poster-title">${escapeHtml(lines.title)}</p>
    ${photo ? `<img class="poster-photo" src="${escapeHtml(photo)}" alt="">` : '<div class="poster-photo empty">Добавьте фото в паспорте</div>'}
    <p class="poster-name">${escapeHtml(lines.name)} <span>— откликается на кличку</span></p>
    ${lines.about ? `<p class="poster-about">${escapeHtml(lines.about)}</p>` : ''}
    ${lines.signs ? `<p class="poster-signs"><b>Приметы:</b> ${escapeHtml(lines.signs)}</p>` : ''}
    ${lines.chip ? `<p class="poster-chip">Чип: ${escapeHtml(lines.chip)}</p>` : ''}
    ${lines.note ? `<p class="poster-note">${escapeHtml(lines.note)}</p>` : ''}
    <div class="poster-phones">${lines.phones.length ? lines.phones.map((x) => `<p><b>${escapeHtml(x.phone)}</b>${x.name ? ` ${escapeHtml(x.name)}` : ''}</p>`).join('')
      : '<p class="poster-empty">Добавьте телефоны</p>'}</div>
  </div>`;
}

// Картинка-объявление (JPEG): фото сверху, крупно кличка и телефоны — чтобы читалось и в чате, и на столбе
export async function lostPosterImage(lines, photo) {
  const W = 1200;
  const H = 1700;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px "Manrope", "Helvetica Neue", Arial, sans-serif`;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  // Красная полоса с заголовком
  g.fillStyle = '#c62f24';
  g.fillRect(0, 0, W, 170);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(800, 84);
  g.fillText(lines.title.toUpperCase(), W / 2, 88);
  let y = 200;
  // Фото: обрезаем до прямоугольника 1120×780
  const PW = 1120;
  const PH = 780;
  if (photo) {
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = photo;
      });
      const s = Math.max(PW / img.width, PH / img.height);
      const sw = PW / s;
      const sh = PH / s;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, (W - PW) / 2, y, PW, PH);
    } catch { /* без фото */ }
  } else {
    g.fillStyle = '#eeeeee';
    g.fillRect((W - PW) / 2, y, PW, PH);
  }
  y += PH + 70;
  g.fillStyle = '#111111';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const X = 50;
  const wrap = (text, f, lh, color = '#111111', maxLines = 3) => {
    g.font = f;
    g.fillStyle = color;
    const words = String(text).split(/\s+/);
    let line = '';
    let n = 0;
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > W - 2 * X && line) {
        if (++n >= maxLines) { g.fillText(`${line}…`, X, y); y += lh; return; }
        g.fillText(line, X, y);
        y += lh;
        line = w;
      } else line = t;
    }
    if (line) { g.fillText(line, X, y); y += lh; }
  };
  wrap(`${lines.name} — откликается на кличку`, font(800, 64), 76, '#111111', 2);
  if (lines.about) wrap(lines.about, font(600, 40), 52, '#333333', 2);
  if (lines.signs) wrap(`Приметы: ${lines.signs}`, font(500, 36), 48, '#333333', 3);
  if (lines.chip) wrap(`Чип: ${lines.chip}`, font(500, 34), 46, '#555555', 1);
  if (lines.note) wrap(lines.note, font(600, 36), 48, '#c62f24', 2);
  // Телефоны — внизу, крупно
  const phones = lines.phones.length ? lines.phones : [{ phone: '', name: '' }];
  const box = 70 + phones.length * 92;
  const top = Math.max(y + 10, H - box - 40);
  g.fillStyle = '#fff4d6';
  g.fillRect(0, top, W, H - top);
  let py = top + 70;
  g.fillStyle = '#111111';
  g.font = font(700, 38);
  g.fillText('Видели? Позвоните:', X, py);
  py += 84;
  phones.forEach((x) => {
    g.font = font(800, 72);
    g.fillText(x.phone || '—', X, py);
    if (x.name) {
      const w = g.measureText(x.phone || '—').width;
      g.font = font(600, 44);
      g.fillText(x.name, X + w + 28, py);
    }
    py += 92;
  });
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.88));
}
