import { INPUT } from '../constants/input';

export class InputManager {
  private keys: Set<string> = new Set();
  private justPressedKeys: Set<string> = new Set();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private mouseButtons: Set<number> = new Set();
  public isLocked = false;
  public sensitivity = INPUT.SENSITIVITY;

  public onLockChange?: (locked: boolean) => void;

  constructor(private domElement: HTMLElement) {
    this.initKeyboard();
    this.initMouse();
  }

  private initKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Alt is free-look; don't let it focus the browser menu bar.
      if (this.isLocked && e.key === 'Alt') e.preventDefault();
      const code = e.code ? e.code.toLowerCase() : '';
      const key = e.key ? e.key.toLowerCase() : '';
      if (code && !this.keys.has(code)) {
        this.justPressedKeys.add(code);
      }
      if (key && !this.keys.has(key)) {
        this.justPressedKeys.add(key);
      }
      if (code) this.keys.add(code);
      if (key) this.keys.add(key);
    });

    window.addEventListener('keyup', (e) => {
      if (e.code) this.keys.delete(e.code.toLowerCase());
      if (e.key) this.keys.delete(e.key.toLowerCase());
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.justPressedKeys.clear();
      this.mouseButtons.clear();
    });
  }

  private initMouse(): void {
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
      if (this.onLockChange) {
        this.onLockChange(this.isLocked);
      }
      if (!this.isLocked) {
        this.keys.clear();

        this.justPressedKeys.clear();
        this.mouseButtons.clear();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      this.mouseButtons.add(e.button);
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isLocked) return;
      this.mouseButtons.delete(e.button);
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.isLocked) return;
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: true },
    );

    window.addEventListener('contextmenu', (e) => {
      if (this.isLocked) e.preventDefault();
    });
  }

  public requestLock(): void {
    this.domElement.requestPointerLock();
  }

  public unlock(): void {
    document.exitPointerLock();
  }

  public isKeyDown(codeOrKey: string): boolean {
    return this.keys.has(codeOrKey.toLowerCase());
  }

  public isKeyPressed(codeOrKey: string): boolean {
    const k = codeOrKey.toLowerCase();
    if (this.justPressedKeys.has(k)) {
      this.justPressedKeys.delete(k);
      return true;
    }
    return false;
  }

  public isAnyKeyDown(...keys: string[]): boolean {
    return keys.some((k) => this.keys.has(k.toLowerCase()));
  }

  public isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  public consumeWheelDelta(): number {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  public consumeMouseDelta(): { x: number; y: number } {
    const delta = {
      x: this.mouseDeltaX * this.sensitivity,
      y: this.mouseDeltaY * this.sensitivity,
    };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }
}
