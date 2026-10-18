import type { Renderer } from './renderer';
import type { GameSession } from './session';
import { audio } from './audio';

/**
 * Mouse + keyboard input. Touch aiming is handled by the Joystick component.
 * All listeners are removed in `destroy()`.
 */
export class InputManager {
  private lastPointer: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private session: GameSession,
  ) {
    window.addEventListener('pointermove', this.onMove, { passive: true });
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('resize', this.reapply);
  }

  private aimFrom(clientX: number, clientY: number): void {
    const me = this.session.me;
    if (!me || !me.alive || this.session.view?.snap.phase !== 'aiming') return;
    const p = this.renderer.toArena(clientX, clientY);
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    if (dx * dx + dy * dy < 14 * 14) return; // too close to the centre: angle is unstable
    this.session.setAim(Math.atan2(dy, dx));
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.aimFrom(e.clientX, e.clientY);
  };

  /** After a resize/orientation change the same pointer position maps to a new arena point. */
  private reapply = () => {
    if (this.lastPointer) this.aimFrom(this.lastPointer.x, this.lastPointer.y);
  };

  private onDown = (e: PointerEvent) => {
    audio.unlock();
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    this.aimFrom(e.clientX, e.clientY);
    this.toggle();
  };

  private toggle(): void {
    const me = this.session.me;
    if (!me?.alive || this.session.view?.snap.phase !== 'aiming') return;
    this.session.toggleLock();
    audio.lock(this.session.locked);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      this.toggle();
    }
  };

  private noMenu = (e: Event) => e.preventDefault();

  destroy(): void {
    window.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('contextmenu', this.noMenu);
    window.removeEventListener('resize', this.reapply);
  }
}
