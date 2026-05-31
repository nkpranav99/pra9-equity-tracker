/**
 * Manual Kite Connect login flow.
 *
 * Provides the manual login URL. The user must navigate to the URL,
 * authenticate, and pass the resulting `request_token` back to the bot
 * to generate a session via `KiteClient.generateSession(request_token)`.
 */
class KiteAuth {
  /**
   * @param {import('./client.js').default} kiteClient - An initialised KiteClient instance.
   * @param {{ apiKey: string }} authConfig
   *   Credentials required for generating the login link.
   */
  constructor(kiteClient, authConfig) {
    this.kiteClient = kiteClient;
    this.config = {
      apiKey: authConfig?.apiKey || '',
    };
  }

  /**
   * Return the manual login URL.
   *
   * @returns {string} Full Kite Connect login URL.
   */
  getLoginUrl() {
    if (!this.config.apiKey) {
      throw new Error('Kite API key is missing. Check your environment variables.');
    }
    return `https://kite.zerodha.com/connect/login?v=3&api_key=${this.config.apiKey}`;
  }
}

export default KiteAuth;
