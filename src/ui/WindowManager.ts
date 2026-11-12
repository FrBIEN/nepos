
/**
 * Shared manager for UI window stacking order (Z-Index).
 * Ensures that DesktopWindows, PacketLog, and other floating UI elements
 * can correctly stack on top of each other when focused.
 */
export class WindowManager {
    private static _currentZIndex = 1100; // Start high enough to be above standard UI (sidebar etc)

    /**
     * Returns the next available z-index and increments the counter.
     * Call this when a window is clicked/focused.
     */
    static bringToFront(element: HTMLElement): void {
        this._currentZIndex++;
        element.style.zIndex = String(this._currentZIndex);
    }
}
