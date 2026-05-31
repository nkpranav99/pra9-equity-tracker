import config from '../config.js';

/**
 * Check if Indian stock market is currently open.
 * Market hours: 9:15 AM - 3:30 PM IST, Monday-Friday.
 */
export function isMarketOpen() {
  const now = getNowIST();
  const day = now.getDay(); // 0=Sun, 6=Sat

  // Weekends
  if (day === 0 || day === 6) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMins = hours * 60 + minutes;

  const openMins =
    config.market.openHour * 60 + config.market.openMinute;
  const closeMins =
    config.market.closeHour * 60 + config.market.closeMinute;

  return currentMins >= openMins && currentMins <= closeMins;
}

/**
 * Check if today is a trading day (weekday, excluding holidays).
 * TODO: Add NSE holiday calendar for complete coverage.
 */
export function isTradingDay() {
  const now = getNowIST();
  const day = now.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Get current time in IST.
 */
export function getNowIST() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: config.market.timezone })
  );
}

/**
 * Get time until market opens (in ms). Returns 0 if market is open.
 */
export function msUntilMarketOpen() {
  if (isMarketOpen()) return 0;

  const now = getNowIST();
  const openToday = new Date(now);
  openToday.setHours(config.market.openHour, config.market.openMinute, 0, 0);

  if (now < openToday) {
    return openToday - now;
  }

  // Market closed for today — next open is tomorrow (or Monday)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Skip to Monday if tomorrow is weekend
  while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  tomorrow.setHours(config.market.openHour, config.market.openMinute, 0, 0);
  return tomorrow - now;
}

/**
 * Format a number as Indian currency (₹).
 */
export function formatINR(amount) {
  if (amount == null || isNaN(amount)) return '₹0.00';
  const absAmount = Math.abs(amount);
  const formatted = absAmount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}₹${formatted}`;
}

/**
 * Format percentage change with emoji.
 */
export function formatChange(change, changePercent) {
  const emoji = change >= 0 ? '🟢' : '🔴';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change?.toFixed(2)} (${sign}${changePercent?.toFixed(2)}%) ${emoji}`;
}

/**
 * Format a large number in short form (e.g., 12.3M, 1.5Cr).
 */
export function formatVolume(vol) {
  if (vol == null) return 'N/A';
  if (vol >= 1e7) return `${(vol / 1e7).toFixed(2)}Cr`;
  if (vol >= 1e5) return `${(vol / 1e5).toFixed(2)}L`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toString();
}
