import express from 'express';
import logger from '../utils/logger.js';
import config from '../config.js';

/**
 * Start a simple web server to catch the Kite Connect redirect URL.
 * 
 * @param {import('../kite/client.js').default} kiteClient
 * @param {Function} notifyOwner - Function to send Telegram messages to the owner
 */
export function startWebhookServer(kiteClient, notifyOwner) {
  const app = express();
  const PORT = process.env.PORT || 8080;

  app.get('/kite-auth', async (req, res) => {
    const requestToken = req.query.request_token;
    const status = req.query.status;

    if (!requestToken || status !== 'success') {
      logger.warn('Received invalid Kite webhook hit without request_token');
      return res.status(400).send('<h1>Authentication Failed</h1><p>Missing request_token or status is not success.</p>');
    }

    logger.info('Received Kite request_token via webhook, attempting session generation...');

    try {
      await kiteClient.generateSession(requestToken);
      logger.info('Webhook authentication successful!');
      
      // Notify the user via Telegram
      await notifyOwner('✅ <b>Authentication Successful!</b>\n\nI caught the token automatically and am now connected to Kite Connect for the day. You can close your browser tab.');
      
      // Respond to the browser
      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f0fdf4; color: #166534; text-align: center;">
            <div>
              <h1 style="font-size: 3rem; margin-bottom: 0;">✅ Success!</h1>
              <p style="font-size: 1.2rem;">Kite Authentication complete. The bot is ready.</p>
              <p style="color: #4b5563;">You can close this tab and return to Telegram.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      logger.error({ err }, 'Webhook session generation failed');
      await notifyOwner(`❌ <b>Authentication Failed</b>\n\n<code>${err.message}</code>\n\nThe token might be invalid or expired. Try running /login again.`);
      res.status(500).send(`<h1>Authentication Error</h1><p>${err.message}</p>`);
    }
  });

  app.listen(PORT, () => {
    logger.info(`🌐 Webhook server listening on port ${PORT}`);
  });
}
