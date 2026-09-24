import { session } from '../state/session';

// iOS has no Vibration API, and flipping an <input type="checkbox" switch> through its
// label is the only thing WebKit answers with a real haptic.
let hapLabel: HTMLLabelElement | null = null;
const iosTap = () => {
  if (!hapLabel) {
    hapLabel = Object.assign(document.createElement('label'), { htmlFor: 'ios-haptic' });
    hapLabel.style.cssText = 'position:fixed;width:1px;height:1px;clip-path:inset(50%);pointer-events:none';
    hapLabel.innerHTML = '<input type="checkbox" switch id="ios-haptic" tabindex="-1" aria-hidden="true">';
    document.body.append(hapLabel);
  }
  hapLabel.click();
};

export const buzz = (ms = 8) => {
  if (!session.haptics) return;
  if (navigator.vibrate) navigator.vibrate(ms);
  else iosTap();
};
