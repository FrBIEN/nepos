/** A single touch-sized close control, positioned outside scrolling toolbars. */
export function createDismissButton(action: () => void, label = 'Schließen'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'window-dismiss';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    button.addEventListener('click', action);
    return button;
}

/** Keep the button outside the scrollable dialog body. */
export function addDialogDismiss(dialog: HTMLDialogElement): void {
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.append(...Array.from(dialog.childNodes));
    dialog.append(body, createDismissButton(() => dialog.close()));
}
