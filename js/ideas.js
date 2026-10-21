// «Идея на сегодня»: одна игра и одна тренировка вне плана, подобранные по прогрессу и журналу.
// Простые правила, без случайности внутри дня: идея меняется раз в сутки или по кнопке «Другая».

import { hash, plainText } from './md.js';

const DAY = 86400000;

// Карточки из «Готовность: …» в блоке «Понадобится»: по словам в «ёлочках» («Отдай»)
// или по полному названию карточки («намордник-корзинка освоен», «шаги 1–4 тренировки «Трамвай: …»»)
function readinessRefs(card, trainings) {
  const need = card.blocks.find((b) => b.kind === 'need');
  if (!need) return [];
  const text = plainText(need.content);
  const i = text.search(/готовность/i);
  if (i < 0) return [];
  const sentence = text.slice(i).split(/(?<=\.)\s/)[0];
  const quoted = sentence.match(/«[^»]+»/g) || [];
  const plain = sentence.toLowerCase().replace(/[«»]/g, '');
  return trainings.filter((c) => c !== card && (
    (c.name.match(/«[^»]+»/g) || []).some((q) => quoted.includes(q)) || nameRe(c.name).test(plain)));
}

// Название в любом падеже: «Протокол расслабления» находится и в «Протокола расслабления»
function nameRe(name) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = name.toLowerCase().replace(/[«»]/g, '').split(/[\s,:;—]+/).filter(Boolean);
  return new RegExp(words.map((w) => esc(w.length > 5 ? w.slice(0, -1) : w) + '\\S*').join('[\\s,:;—]+'));
}

// ctx: { day, games, trainings, inPlan(ref), events (журнал за ~2 недели и сегодня),
//        progress(card) → { done, total, mastered }, shift: { game, training } }
export function pickIdeas(ctx) {
  const lastDone = {};
  for (const e of ctx.events) {
    if (e.type !== 'train' || !e.card) continue;
    if (!lastDone[e.card] || e.at > lastDone[e.card]) lastDone[e.card] = e.at;
  }
  const now = Date.now();
  const daysSince = (ref) => (lastDone[ref] ? Math.floor((now - lastDone[ref]) / DAY) : 99);
  const tie = (ref) => hash(ctx.day + ref);
  const started = (c) => { const p = ctx.progress(c); return p.mastered || p.done > 0; };
  const masteredAll = (c) => { const p = ctx.progress(c); return p.mastered || (p.total > 0 && p.done === p.total); };

  // Игры: те, для которых он готов; давно не играли — выше
  const games = ctx.games
    .map((c) => ({ c, ref: `g/${c.id}`, refs: readinessRefs(c, ctx.trainings) }))
    .filter((x) => !ctx.inPlan(x.ref) && x.refs.every(started))
    .sort((a, b) => daysSince(b.ref) - daysSince(a.ref) || (tie(a.ref) < tie(b.ref) ? -1 : 1))
    .map((x) => {
      const d = daysSince(x.ref);
      return { tab: 'g', card: x.c, ref: x.ref, reason: d >= 99 ? 'ещё не играли' : d === 0 ? 'уже играли сегодня' : `не играли ${d} дн.` };
    });

  // Тренировки вне плана: освоенные и давно не повторённые → начатые → новые, к которым он готов
  const trainings = ctx.trainings
    .map((c) => ({ c, ref: `k/${c.id}`, p: ctx.progress(c) }))
    .filter((x) => !ctx.inPlan(x.ref))
    .map((x) => {
      const d = daysSince(x.ref);
      if (masteredAll(x.c)) return d >= 3 ? { ...x, rank: 0, reason: 'освоено — повторить, чтобы не забылось' } : null;
      if (started(x.c)) return { ...x, rank: 1, reason: `в процессе: освоено шагов ${x.p.done} из ${x.p.total}` };
      return readinessRefs(x.c, ctx.trainings).every(masteredAll) ? { ...x, rank: 2, reason: 'можно начать' } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || daysSince(b.ref) - daysSince(a.ref) || (tie(a.ref) < tie(b.ref) ? -1 : 1))
    .map((x) => ({ tab: 'k', card: x.c, ref: x.ref, reason: x.reason }));

  const at = (list, n) => (list.length ? list[n % list.length] : null);
  return {
    game: at(games, ctx.shift.game || 0), gameCount: games.length,
    training: at(trainings, ctx.shift.training || 0), trainingCount: trainings.length,
  };
}
