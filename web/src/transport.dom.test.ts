/** Caractérisation de la barre de transport, avant la refonte #137.
 *
 * Ces tests ne corrigent rien : ils figent le comportement actuel du dock
 * pour que la refonte (dock en flux, remontée de la tonalité, primitives
 * partagées avec le filage) ne le change pas par accident. `transport.ts`
 * n'avait aucun test propre — seulement une couverture indirecte par
 * `views/trainer.dom.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import { createTransport } from './transport';
import { createFakePlayer } from '../test/fakes/player';
import type { AudioSource, InstrumentId, Song } from './types';

function source(file: string, bpm?: number): AudioSource {
  return { file, duration: 180, source_url: `https://youtube.com/watch?v=${file}`, bpm };
}

function instrument(id: InstrumentId, name: string) {
  return { id, name, page_count: 0, measure_count: 0, pages: [] };
}

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'benzinho',
    title: 'Benzinho',
    composer: 'Jacob do Bandolim',
    audio: { reference: source('reference.opus'), playback: null },
    instruments: [instrument('c', 'Concert (Ut / C)')],
    contraponto: null,
    ...overrides,
  };
}

/**
 * jsdom ne fait aucune mise en page : toute géométrie vaut zéro, et les
 * gestes de pointage du dock (`ratioFromEvent`, `laneTime`) se rabattent
 * alors sur 0 sans rien déclencher. On donne donc une largeur à la piste
 * visée, en gardant `left: 0` pour que `clientX` se lise directement en
 * pourcentage.
 */
const TRACK_WIDTH = 200;
function measure(element: Element): void {
  element.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: TRACK_WIDTH, bottom: 22, width: TRACK_WIDTH, height: 22 }) as DOMRect;
}

function pointer(type: string, clientX: number, target?: EventTarget): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

function mount(overrides: Partial<Song> = {}) {
  const player = createFakePlayer();
  const transport = createTransport({ song: song(overrides), player });
  const { primary } = transport;
  return { transport, primary, player };
}

const playButton = (root: HTMLElement) =>
  root.querySelector('button[aria-label="Lecture ou pause"]') as HTMLButtonElement;
const seekBar = (root: HTMLElement) => root.querySelector('[role="slider"]') as HTMLElement;
const lane = (root: HTMLElement) => root.querySelector('.loop-lane') as HTMLElement;
const loopToggle = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Loop'))!;
const chipByLabel = (root: HTMLElement, prefix: string) =>
  [...root.querySelectorAll('button')].find((b) =>
    b.getAttribute('aria-label')?.startsWith(prefix),
  )!;

describe('createTransport — lecture', () => {
  it('désactive la lecture quand le morceau n\'a aucune source audio', () => {
    const { primary } = mount({ audio: { reference: null, playback: null } });
    expect(playButton(primary).disabled).toBe(true);
  });

  it('bascule la lecture du lecteur au clic', () => {
    const { primary, player } = mount();
    expect(playButton(primary).disabled).toBe(false);
    playButton(primary).click();
    expect(player.isPlaying()).toBe(true);
    playButton(primary).click();
    expect(player.isPlaying()).toBe(false);
  });

  it('reflète l\'état de lecture au battement suivant', () => {
    const { primary, player } = mount();
    player.__setPlaying(true);
    player.__tick();
    expect(playButton(primary).textContent).toBe('❚❚');
    player.__setPlaying(false);
    player.__tick();
    expect(playButton(primary).textContent).toBe('▶');
  });
});

describe('createTransport — défilement', () => {
  it('ne déplace le lecteur qu\'au relâchement, pas pendant le glissement', () => {
    const { primary, player } = mount();
    player.__tick(); // fixe `duration` : sans battement, la barre est inerte
    const bar = seekBar(primary);
    measure(primary.querySelector('.seek-track')!);

    bar.dispatchEvent(pointer('pointerdown', TRACK_WIDTH / 2));
    bar.dispatchEvent(pointer('pointermove', TRACK_WIDTH * 0.75));
    // Le lecteur n'a pas bougé : seul l'affichage suit le doigt.
    expect(player.getCurrentTime()).toBe(0);
    expect(bar.getAttribute('aria-valuenow')).toBe('135');

    bar.dispatchEvent(pointer('pointerup', TRACK_WIDTH * 0.75));
    expect(player.getCurrentTime()).toBe(135);
  });

  it('recule et avance de 5 s, bornés au morceau (#153)', () => {
    const { primary, player } = mount();
    player.__tick();
    const back = primary.querySelector<HTMLButtonElement>('button[aria-label="Reculer de 5 secondes"]')!;
    const forward = primary.querySelector<HTMLButtonElement>('button[aria-label="Avancer de 5 secondes"]')!;

    player.seekTo(42);
    back.click();
    expect(player.getCurrentTime()).toBe(37);
    forward.click();
    forward.click();
    expect(player.getCurrentTime()).toBe(47);

    player.seekTo(2);
    back.click();
    expect(player.getCurrentTime()).toBe(0);
  });

  it('reste inerte tant que la durée est inconnue', () => {
    const { primary, player } = mount();
    const bar = seekBar(primary);
    measure(primary.querySelector('.seek-track')!);
    bar.dispatchEvent(pointer('pointerdown', TRACK_WIDTH / 2));
    bar.dispatchEvent(pointer('pointerup', TRACK_WIDTH / 2));
    expect(player.getCurrentTime()).toBe(0);
  });
});

describe('createTransport — bascule de bande', () => {
  const twoSources = {
    audio: { reference: source('reference.opus'), playback: source('playback.opus') },
  };

  it('n\'expose la bascule que si les deux bandes existent', () => {
    const { primary } = mount();
    expect(chipByLabel(primary, 'Enregistrement original')).toBeUndefined();
    const two = mount(twoSources);
    expect(chipByLabel(two.primary, 'Enregistrement original')).toBeDefined();
  });

  it('passe à la bande suivante et conserve la lecture en cours', () => {
    const { primary, player } = mount(twoSources);
    const load = vi.spyOn(player, 'load');
    player.__setPlaying(true);

    chipByLabel(primary, 'Enregistrement original').click();

    expect(load).toHaveBeenCalledWith('playback.opus', true, 180);
    expect(chipByLabel(primary, 'Accompagnement seul')).toBeDefined();
  });

  it('ne relance pas la lecture si elle était à l\'arrêt', () => {
    const { primary, player } = mount(twoSources);
    const load = vi.spyOn(player, 'load');
    chipByLabel(primary, 'Enregistrement original').click();
    expect(load).toHaveBeenCalledWith('playback.opus', false, 180);
  });
});

describe('createTransport — frise de répétition', () => {
  it('est repliée au montage et se révèle au clic (issue #120)', () => {
    const { primary } = mount();
    expect(lane(primary).classList.contains('hidden')).toBe(true);
    expect(loopToggle(primary).getAttribute('aria-expanded')).toBe('false');

    loopToggle(primary).click();
    expect(lane(primary).classList.contains('hidden')).toBe(false);
    expect(loopToggle(primary).getAttribute('aria-expanded')).toBe('true');
  });

  it('ignore un simple clic : il poserait une boucle de durée nulle', () => {
    const { primary, player } = mount();
    player.__tick();
    const setLoop = vi.spyOn(player, 'setLoop');
    measure(primary.querySelector('.loop-lane > div')!);

    lane(primary).dispatchEvent(pointer('pointerdown', 100));
    lane(primary).dispatchEvent(pointer('pointerup', 100));

    expect(setLoop).not.toHaveBeenCalled();
  });

  it('pose la boucle et lance la lecture après un vrai tracé', () => {
    const { primary, player } = mount();
    player.__tick();
    measure(primary.querySelector('.loop-lane > div')!);

    lane(primary).dispatchEvent(pointer('pointerdown', 20));
    lane(primary).dispatchEvent(pointer('pointermove', 60));
    lane(primary).dispatchEvent(pointer('pointerup', 60));

    // 20/200 et 60/200 d'un morceau de 180 s : 18 s → 54 s.
    expect(player.getLoop()).toEqual({ a: 18, b: 54 });
    expect(player.isPlaying()).toBe(true);
  });

  it('abandonne le tracé sur `pointercancel`', () => {
    const { primary, player } = mount();
    player.__tick();
    const setLoop = vi.spyOn(player, 'setLoop');
    measure(primary.querySelector('.loop-lane > div')!);

    lane(primary).dispatchEvent(pointer('pointerdown', 20));
    lane(primary).dispatchEvent(pointer('pointermove', 60));
    lane(primary).dispatchEvent(pointer('pointercancel', 60));

    expect(setLoop).not.toHaveBeenCalled();
  });
});

describe('createTransport — sections et démontage', () => {
  it('ne propose la section « Répéter un passage » que s\'il y a du son', () => {
    expect(mount().transport.sections.map((s) => s.title)).toEqual(['Répéter un passage']);
    const muet = mount({ audio: { reference: null, playback: null } });
    expect(muet.transport.sections).toEqual([]);
  });

  it('se désabonne du lecteur au démontage', () => {
    const { transport, player } = mount();
    expect(player.__listenerCount).toBe(1);
    transport.destroy();
    expect(player.__listenerCount).toBe(0);
  });
});

describe('createTransport — tempo', () => {
  it('affiche la cible en BPM quand le tempo de la source est connu (#111)', () => {
    const { primary } = mount({
      audio: { reference: source('reference.opus', 110), playback: null },
    });
    expect(primary.textContent).toContain('110 BPM');
  });

  it('retombe sur la vitesse relative sans tempo détecté', () => {
    const { primary } = mount();
    const ralentir = chipByLabel(primary, 'Ralentir');
    ralentir.click();
    expect(primary.textContent).toContain('0,95×');
  });
});
