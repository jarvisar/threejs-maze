/** Runs in the page. Let the game's polling loop read both edges, even on a slow software renderer. */
export async function pressButton(button) {
    for (const down of [true, false]) {
        window.__pad.set(button, down);
        while (window.__backrooms.gamepad.held(button) !== down) {
            await new Promise(requestAnimationFrame);
        }
    }
}
