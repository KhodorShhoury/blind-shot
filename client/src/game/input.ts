import type { Renderer } from './renderer';
import type { GameSession } from './session';
import { audio } from './audio';

/**
 * Mouse + keyboard input. Touch aiming is handled by the Joystick component.
 * All listeners are removed in `destroy()`.
 */
export class InputManager {
  private lastPointer: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private moveTimer: ReturnType<typeof setInterval>;

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
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    // walking intents expire server-side unless refreshed; also keeps the mouse aim glued to a moving player
    this.moveTimer = setInterval(() => this.tickMove(), 50);
  }

  private static readonly DIRS: Record<string, [number, number]> = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };
  private sentMoving = false;
  private lastMoveSend = 0;

  private tickMove(): void {
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const d = InputManager.DIRS[k];
      if (d) { dx += d[0]; dy += d[1]; }
    }
    const aiming = this.session.view?.snap.phase === 'aiming' && !!this.session.me?.alive;
    const moving = aiming && (dx !== 0 || dy !== 0);
    if (moving) {
      const len = Math.hypot(dx, dy);
      const now = performance.now();
      if (now - this.lastMoveSend >= 90) {
        this.lastMoveSend = now;
        this.session.setMove(dx / len, dy / len);
      }
      if (this.lastPointer) this.aimFrom(this.lastPointer.x, this.lastPointer.y);
    } else if (this.sentMoving) {
      this.session.setMove(0, 0);
    }
    this.sentMoving = moving;
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private releaseAll = () => {
    this.keys.clear();
    this.session.setMove(0, 0);
    this.sentMoving = false;
  };

  private aimFrom(clientX: number, clientY: number): void {
    const me = this.session.me;
    if (!me || !me.alive || me.x === undefined || me.y === undefined || this.session.view?.snap.phase !== 'aiming') return;
    const p = this.renderer.toArena(clientX, clientY);
    const mine = this.renderer.getPos(me.id) ?? { x: me.x, y: me.y };
    const dx = p.x - mine.x;
    const dy = p.y - mine.y;
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
    if (InputManager.DIRS[e.code]) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      this.keys.add(e.code);
      return;
    }
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
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    clearInterval(this.moveTimer);
    this.session.setMove(0, 0);
  }
}
