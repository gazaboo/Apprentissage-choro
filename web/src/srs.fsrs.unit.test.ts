import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsrs, Rating } from 'ts-fsrs';
import { GRADES, PASSING_GRADE, ensureFsrs, newCard, review } from './srs';
import type { SrsCard } from './types';

const FIXED_TODAY = new Date(2026, 8, 14); // 2026-09-14, un lundi arbitraire

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('newCard', () => {
  it('porte un état FSRS neuf (New, stabilité et difficulté à 0)', () => {
    const card = newCard();
    expect(card.fsrs).toEqual({
      stability: 0,
      difficulty: 0,
      state: 0,
      reps: 0,
      lapses: 0,
      learningSteps: 0,
      lastReview: null,
      scheduledDays: 0,
    });
  });
});

describe('review — correspondance des notes', () => {
  it('note < 3 (Néant/Bribes/Difficile) échoue : lapses augmente, intervalle ramené à 1 jour', () => {
    let card = review(undefined, 4, 'fluide', 0); // installe une carte en révision
    card = review(card, 4, 'fluide', 0);
    const lapsesBefore = card.fsrs!.lapses;
    for (const grade of [0, 1, 2]) {
      const failed = review(card, grade, 'fluide', 0);
      expect(failed.interval).toBe(1);
      expect(failed.fsrs!.lapses).toBe(lapsesBefore + 1);
    }
  });

  it('note 3 (Correct) = Hard, note 4 (Bon) = Good, note 5 (Parfait) = Easy : intervalles croissants', () => {
    const hard = review(undefined, 3, 'fluide', 0);
    const good = review(undefined, 4, 'fluide', 0);
    const easy = review(undefined, 5, 'fluide', 0);
    expect(hard.interval).toBeLessThanOrEqual(good.interval);
    expect(good.interval).toBeLessThanOrEqual(easy.interval);
  });

  it('les quatre notes du questionnaire couvrent les quatre notes FSRS, une chacune', () => {
    const [rate, difficile, bien, facile] = GRADES.map((grade) => grade.value);
    // Raté échoue ; les trois autres réussissent, dans l'ordre Hard < Good < Easy.
    expect(rate).toBeLessThan(PASSING_GRADE);
    expect([difficile, bien, facile]).toEqual([3, 4, 5]);

    let card = review(undefined, bien!, 'fluide', 0);
    card = review(card, bien!, 'fluide', 0);
    const failed = review(card, rate!, 'fluide', 0);
    expect(failed.fsrs!.lapses).toBe(card.fsrs!.lapses + 1);
    expect(failed.interval).toBe(1);

    const intervals = [difficile, bien, facile].map((grade) => review(card, grade!, 'fluide', 0).interval);
    expect(intervals[0]).toBeLessThan(intervals[1]!);
    expect(intervals[1]).toBeLessThan(intervals[2]!);
  });

  it('clampe la note comme avant (0..5, arrondie)', () => {
    const failing = review(undefined, -3, 'fluide', 0);
    const passing = review(undefined, 42, 'fluide', 0);
    expect(failing.history.at(-1)!.grade).toBe(0);
    expect(passing.history.at(-1)!.grade).toBe(5);
  });
});

/** Avance l'horloge simulée de `days` jours — une révision réaliste arrive
 *  à peu près à échéance, pas le jour même (voir la note ci-dessous sur les
 *  révisions same-day). */
function advance(days: number): void {
  vi.setSystemTime(new Date(Date.now() + days * 86_400_000));
}

describe('review — dynamique FSRS', () => {
  it('la stabilité croît sur des réussites espacées dans le temps', () => {
    // Deux révisions le même jour ne font pas croître la stabilité au-delà
    // de la première (FSRS traite les révisions same-day à part) : il faut
    // laisser le temps s'écouler entre deux révisions pour observer la
    // croissance attendue.
    let card = review(undefined, 4, 'fluide', 0);
    const s1 = card.fsrs!.stability;
    advance(card.interval);
    card = review(card, 4, 'fluide', 0);
    const s2 = card.fsrs!.stability;
    advance(card.interval);
    card = review(card, 4, 'fluide', 0);
    const s3 = card.fsrs!.stability;
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it('un échec fait chuter la stabilité et augmente la difficulté', () => {
    let card = review(undefined, 5, 'fluide', 0);
    advance(card.interval);
    card = review(card, 5, 'fluide', 0);
    const stableBefore = card.fsrs!.stability;
    const difficultyBefore = card.fsrs!.difficulty;
    advance(card.interval);
    const failed = review(card, 0, 'fluide', 0);
    expect(failed.fsrs!.stability).toBeLessThan(stableBefore);
    expect(failed.fsrs!.difficulty).toBeGreaterThan(difficultyBefore);
  });

  it("plafonne l'intervalle au voisinage de maximum_interval (365 j), même sur des réussites répétées", () => {
    // Chaque révision arrive pile à échéance, comme dans un usage réel : la
    // stabilité croît sans à-coups jusqu'à buter sur le plafond. `ts-fsrs`
    // garantit Hard < Good < Easy en ajoutant +1 jour en cascade quand les
    // trois se retrouvent collés au plafond (`basic_scheduler.ts`,
    // `next_interval`) : la marge ci-dessous absorbe ce +1/+1 documenté,
    // sans quoi le test serait fragile à un détail d'implémentation amont.
    let card = review(undefined, 5, 'fluide', 0);
    for (let i = 0; i < 60; i += 1) {
      advance(Math.max(1, card.interval));
      card = review(card, 5, 'fluide', 0);
    }
    expect(card.fsrs!.scheduledDays).toBeLessThanOrEqual(370);
    expect(card.interval).toBeLessThanOrEqual(370);
  });
});

describe('review — facteur de tempo', () => {
  it("réduit l'intervalle affiché (sous-tempo < crispé ≤ fluide) sans jamais tomber sous 1 jour", () => {
    const sousTempo = review(undefined, 4, 'sous-tempo', 0);
    const crispe = review(undefined, 4, 'crispe', 0);
    const fluide = review(undefined, 4, 'fluide', 0);
    expect(sousTempo.interval).toBeLessThanOrEqual(crispe.interval);
    expect(crispe.interval).toBeLessThanOrEqual(fluide.interval);
    expect(sousTempo.interval).toBeGreaterThanOrEqual(1);
  });

  it("n'altère ni la stabilité ni la difficulté FSRS — seul l'intervalle affiché change", () => {
    const sousTempo = review(undefined, 4, 'sous-tempo', 0);
    const fluide = review(undefined, 4, 'fluide', 0);
    expect(sousTempo.fsrs!.stability).toBeCloseTo(fluide.fsrs!.stability, 6);
    expect(sousTempo.fsrs!.difficulty).toBeCloseTo(fluide.fsrs!.difficulty, 6);
    expect(sousTempo.fsrs!.scheduledDays).toBe(fluide.fsrs!.scheduledDays);
  });
});

describe("le champ `due` transmis à FSRS n'affecte jamais scheduler.next()", () => {
  it('deux cartes identiques hormis `due` produisent le même résultat', () => {
    const scheduler = fsrs({
      enable_short_term: false,
      enable_fuzz: false,
      maximum_interval: 365,
      request_retention: 0.9,
    });
    const base = {
      stability: 5,
      difficulty: 4,
      elapsed_days: 0,
      scheduled_days: 5,
      learning_steps: 0,
      reps: 2,
      lapses: 0,
      state: 2 as const,
      last_review: new Date(2026, 8, 10),
    };
    const now = new Date(2026, 8, 14);
    const resA = scheduler.next({ ...base, due: new Date(2026, 8, 20) }, now, Rating.Good);
    const resB = scheduler.next({ ...base, due: new Date(2026, 8, 10) }, now, Rating.Good);
    expect(resA.card.stability).toBe(resB.card.stability);
    expect(resA.card.difficulty).toBe(resB.card.difficulty);
    expect(resA.card.scheduled_days).toBe(resB.card.scheduled_days);
  });
});

describe('ensureFsrs', () => {
  it('carte déjà migrée : renvoyée telle quelle', () => {
    const card = review(undefined, 4, 'fluide', 0);
    expect(ensureFsrs(card)).toBe(card);
  });

  it('carte sans historique : ressort en carte neuve', () => {
    const legacy: SrsCard = {
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      due: '2026-09-14',
      history: [],
    };
    const migrated = ensureFsrs(legacy);
    expect(migrated.fsrs.state).toBe(0);
    expect(migrated.fsrs.stability).toBe(0);
    expect(migrated.history).toEqual([]);
  });

  it('rejoue un historique multi-jours et reproduit exactement le même état que les révisions jouées une à une', () => {
    let live: SrsCard = newCard();
    live = review(live, 4, 'fluide', 0);

    vi.setSystemTime(new Date(2026, 8, 20));
    live = review(live, 3, 'crispe', 1);

    vi.setSystemTime(new Date(2026, 8, 28));
    live = review(live, 1, 'sous-tempo', 4); // un échec dans la série

    vi.setSystemTime(new Date(2026, 9, 3));
    live = review(live, 5, 'fluide', 0);

    // On efface l'état FSRS pour forcer le rejeu, comme le ferait une carte
    // dont la synchro aurait perdu ce champ.
    const stripped: SrsCard = { ...live, fsrs: undefined };
    const replayed = ensureFsrs(stripped);

    expect(replayed.fsrs).toEqual(live.fsrs);
    expect(replayed.interval).toBe(live.interval);
    expect(replayed.due).toBe(live.due);
    expect(replayed.repetitions).toBe(live.repetitions);
  });

  it('carte SM-2 héritée (jamais migrée, ease/interval antérieurs) : reconstruite depuis `history` seul', () => {
    const legacy: SrsCard = {
      ease: 1.9, // valeur SM-2 pré-migration, non lue pour la reconstruction
      interval: 12,
      repetitions: 3,
      due: '2026-09-10',
      history: [
        { date: '2026-08-01', grade: 4, tempo: 'fluide', hints: 0 },
        { date: '2026-08-10', grade: 4, tempo: 'fluide', hints: 1 },
        { date: '2026-08-25', grade: 2, tempo: 'crispe', hints: 3 },
      ],
    };
    const migrated = ensureFsrs(legacy);
    expect(migrated.fsrs.reps).toBe(3);
    expect(migrated.fsrs.lapses).toBe(1); // la 3e révision (note 2) est un échec
    expect(migrated.fsrs.lastReview).toBe('2026-08-25');
    // `due` recalculée depuis la dernière révision du passé, pas depuis "aujourd'hui".
    expect(migrated.due >= '2026-08-26').toBe(true);
  });
});

describe('plafond de l\'historique', () => {
  it('est désormais de 500 entrées (contre 50 avant la migration FSRS)', () => {
    let card = newCard();
    for (let i = 0; i < 520; i += 1) {
      card = review(card, 4, 'fluide', 0);
    }
    expect(card.history).toHaveLength(500);
  });
});
