import logger from './logger.js';

/**
 * Global error handler. Logs the error and optionally sends
 * a Telegram alert to the owner.
 *
 * @param {Error} error
 * @param {string} context - Where the error occurred
 * @param {Function} [notifyFn] - Optional function to send Telegram alert
 */
export async function handleError(error, context, notifyFn) {
  logger.error({ err: error, context }, `Error in ${context}`);

  if (notifyFn) {
    try {
      const message =
        `⚠️ <b>Bot Error</b>\n\n` +
        `<b>Context:</b> <code>${escapeHtml(context)}</code>\n` +
        `<b>Error:</b> <code>${escapeHtml(error.message)}</code>\n` +
        `<b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
      await notifyFn(message);
    } catch (notifyError) {
      logger.error({ err: notifyError }, 'Failed to send error notification');
    }
  }
}

/**
 * Escape HTML special characters for Telegram messages.
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry(fn, { maxAttempts = 3, delayMs = 1000, backoff = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const wait = delayMs * Math.pow(backoff, attempt - 1);
        logger.warn(
          { attempt, maxAttempts, waitMs: wait, error: error.message },
          `Retry attempt ${attempt}/${maxAttempts}, waiting ${wait}ms`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}
