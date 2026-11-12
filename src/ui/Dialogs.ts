import { addDialogDismiss } from './DismissButton';
/** Accessible dialogs also work in embedded browsers without native prompt support. */
function ask(message: string, value?: string, signal?:AbortSignal): Promise<string | null> {
    if(signal?.aborted)return Promise.resolve(null);
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'filius-dialog';
        const form = document.createElement('form'); form.method = 'dialog';
        const label = document.createElement('label'); label.textContent = message;
        const input = document.createElement('input'); input.className = 'form-control'; input.value = value ?? '';
        input.setAttribute('aria-label', message);
        form.append(label); if (value !== undefined) { label.append(input); }
        const actions = document.createElement('div'); actions.className = 'dialog-actions';
        for (const [text, result] of [['Abbrechen','cancel'],['OK','ok']]) {
            const button = document.createElement('button'); button.className = 'btn'; button.textContent = text; button.value = result; button.type = result === 'ok' ? 'submit' : 'button'; if (result === 'cancel') button.addEventListener('click', () => dialog.close('cancel')); actions.append(button);
        }
        form.append(actions); dialog.append(form); addDialogDismiss(dialog); document.body.append(dialog);
        dialog.addEventListener('close', () => { const result = dialog.returnValue === 'ok' ? (value === undefined ? 'ok' : input.value) : null; dialog.remove(); resolve(result); }, {once:true});
        dialog.showModal();bindDialogLifetime(dialog,signal); if (value !== undefined) { input.focus(); input.select(); }
    });
}
export const askText = (message: string, value = '',signal?:AbortSignal): Promise<string | null> => ask(message, value,signal);
export const askConfirm = async (message: string,signal?:AbortSignal): Promise<boolean> => await ask(message,undefined,signal) === 'ok';

/** Escape and the overlay close button resolve to null. */
export function askChoice<T extends string>(message: string, choices: readonly {label: string; value: T}[],signal?:AbortSignal): Promise<T | null> {
    if(signal?.aborted)return Promise.resolve(null);
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'filius-dialog';
        dialog.setAttribute('aria-label', message);
        const heading = document.createElement('h2'); heading.textContent = message;
        const form = document.createElement('form'); form.method = 'dialog'; form.className = 'dialog-actions';
        for (const choice of choices) {
            const button = document.createElement('button'); button.className = 'btn';
            button.value = choice.value; button.textContent = choice.label; form.append(button);
        }
        dialog.append(heading, form); addDialogDismiss(dialog); document.body.append(dialog);
        dialog.addEventListener('close', () => {
            const result = choices.find(choice => choice.value === dialog.returnValue)?.value ?? null;
            dialog.remove(); resolve(result);
        }, {once: true});
        dialog.showModal();bindDialogLifetime(dialog,signal);
    });
}
export async function showNotice(message: string,signal?:AbortSignal): Promise<void> {
    await askChoice(message, [{label: 'OK', value: 'ok'}],signal);
}
export const askSaveChanges = (message: string,signal?:AbortSignal) => askChoice(message, [
    {label: 'Speichern', value: 'save'}, {label: 'Verwerfen', value: 'discard'}, {label: 'Abbrechen', value: 'cancel'}
] as const,signal);

/** Closing an owner cancels its dialog and releases the owner subscription. */
export function bindDialogLifetime(dialog:HTMLDialogElement,signal?:AbortSignal):void {
    if(!signal)return;
    const abort=()=>dialog.close();
    dialog.addEventListener('close',()=>signal.removeEventListener('abort',abort),{once:true});
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
}
