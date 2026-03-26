/**
 * 30-minute inactivity timer.
 *
 * Resets on any user interaction (mouse, keyboard, touch, scroll).
 * Calls onTimeout() when the user has been idle for TIMEOUT_MS.
 * Calls onWarning() at WARN_BEFORE_MS before timeout (optional).
 *
 * Usage:
 *   const timer = createInactivityTimer({
 *     onTimeout: () => authStore.logout(),
 *     onWarning: () => showIdleWarningModal(),
 *   });
 *   timer.start();
 *   // later:
 *   timer.stop();
 */

const TIMEOUT_MS     = 30 * 60 * 1000; // 30 minutes
const WARN_BEFORE_MS =  2 * 60 * 1000; //  2 minutes before timeout

const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'keydown',
  'touchstart', 'scroll', 'wheel', 'click',
];

/**
 * @param {object}   opts
 * @param {function} opts.onTimeout   - Called when idle timeout fires
 * @param {function} [opts.onWarning] - Called 2 min before timeout
 * @param {number}   [opts.timeoutMs] - Override default 30 min
 * @param {number}   [opts.warnBeforeMs] - Override default 2 min warning
 */
export function createInactivityTimer({
  onTimeout,
  onWarning,
  timeoutMs    = TIMEOUT_MS,
  warnBeforeMs = WARN_BEFORE_MS,
}) {
  let timeoutId = null;
  let warnId    = null;
  let running   = false;

  function reset() {
    if (!running) return;
    clearTimeout(timeoutId);
    clearTimeout(warnId);

    if (onWarning) {
      warnId = setTimeout(onWarning, timeoutMs - warnBeforeMs);
    }
    timeoutId = setTimeout(() => {
      stop();
      onTimeout();
    }, timeoutMs);
  }

  function start() {
    if (running) return;
    running = true;
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
  }

  function stop() {
    running = false;
    clearTimeout(timeoutId);
    clearTimeout(warnId);
    ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
  }

  return { start, stop, reset };
}
