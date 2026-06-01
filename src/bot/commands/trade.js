import { InlineKeyboard } from 'grammy';
import logger from '../../utils/logger.js';
import { resolveSymbol } from '../../utils/symbol-resolver.js';
import { formatError } from '../formatters.js';

export async function buyCommand(ctx) {
  return initTrade(ctx, 'BUY');
}

export async function sellCommand(ctx) {
  return initTrade(ctx, 'SELL');
}

async function initTrade(ctx, action) {
  const text = ctx.message.text.trim();
  const parts = text.split(/\s+/);
  
  // /buy RELIANCE
  let symbolQuery = parts.length > 1 ? parts.slice(1).join(' ') : null;

  ctx.session.tradeState = {
    active: true,
    action,
    symbol: null,
    product: null,
    orderType: null,
    quantity: null,
    price: null,
    step: 'ASK_SYMBOL'
  };

  if (symbolQuery) {
    // Resolve symbol immediately
    try {
      const resolved = await resolveSymbol(symbolQuery);
      if (resolved) {
        ctx.session.tradeState.symbol = resolved;
        ctx.session.tradeState.step = 'ASK_PRODUCT';
        return askProduct(ctx);
      } else {
        await ctx.reply(`Could not resolve symbol for "${symbolQuery}". Please enter the exact NSE symbol:`);
        return;
      }
    } catch (err) {
      await ctx.reply(`Error resolving symbol: ${err.message}. Please enter the exact NSE symbol:`);
      return;
    }
  }

  await ctx.reply(`What stock do you want to ${action}?`);
}

async function askProduct(ctx) {
  const { action, symbol } = ctx.session.tradeState;
  
  const keyboard = new InlineKeyboard()
    .text('CNC (Delivery)', 'trade_product_CNC')
    .text('MIS (Intraday)', 'trade_product_MIS');

  const msg = await ctx.reply(`Selected **${symbol}**.\nDo you want to ${action} for Delivery (CNC) or Intraday (MIS)?`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
  
  ctx.session.tradeState.lastMessageId = msg.message_id;
}

export async function handleProductSelection(ctx, product) {
  if (!ctx.session?.tradeState?.active) return;
  ctx.session.tradeState.product = product;
  ctx.session.tradeState.step = 'ASK_TYPE';

  const keyboard = new InlineKeyboard()
    .text('Market', 'trade_type_MARKET')
    .text('Limit', 'trade_type_LIMIT');

  await ctx.api.editMessageText(
    ctx.chat.id,
    ctx.callbackQuery.message.message_id,
    `Product: **${product}**\nDo you want to place a Market or Limit order?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  await ctx.answerCallbackQuery();
}

export async function handleTypeSelection(ctx, orderType) {
  if (!ctx.session?.tradeState?.active) return;
  ctx.session.tradeState.orderType = orderType;
  
  if (orderType === 'LIMIT') {
    ctx.session.tradeState.step = 'ASK_PRICE';
    await ctx.api.editMessageText(
      ctx.chat.id,
      ctx.callbackQuery.message.message_id,
      `Order Type: **LIMIT**\n\nPlease enter the limit price:`,
      { parse_mode: 'Markdown' }
    );
  } else {
    ctx.session.tradeState.price = 0; // Market order
    ctx.session.tradeState.step = 'ASK_QTY';
    await ctx.api.editMessageText(
      ctx.chat.id,
      ctx.callbackQuery.message.message_id,
      `Order Type: **MARKET**\n\nPlease enter the quantity:`,
      { parse_mode: 'Markdown' }
    );
  }
  await ctx.answerCallbackQuery();
}

export async function tradeConversationHandler(ctx) {
  const state = ctx.session.tradeState;
  const text = ctx.message.text.trim();

  // Allow user to cancel at any time
  if (text.toLowerCase() === 'cancel' || text === '/cancel') {
    ctx.session.tradeState = null;
    await ctx.reply('Trade cancelled.');
    return;
  }

  if (state.step === 'ASK_SYMBOL') {
    try {
      const resolved = await resolveSymbol(text);
      if (resolved) {
        state.symbol = resolved;
        state.step = 'ASK_PRODUCT';
        await askProduct(ctx);
      } else {
        await ctx.reply(`Could not resolve symbol. Try again, or type 'cancel'.`);
      }
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
    return;
  }

  if (state.step === 'ASK_PRICE') {
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) {
      await ctx.reply('Invalid price. Please enter a valid number, or type cancel:');
      return;
    }
    state.price = price;
    state.step = 'ASK_QTY';
    await ctx.reply('Price set. Please enter the quantity:');
    return;
  }

  if (state.step === 'ASK_QTY') {
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty <= 0) {
      await ctx.reply('Invalid quantity. Please enter a valid whole number:');
      return;
    }
    state.quantity = qty;
    state.step = 'CONFIRM';
    await generateConfirmation(ctx);
    return;
  }
}

async function generateConfirmation(ctx) {
  const state = ctx.session.tradeState;
  const { action, symbol, product, orderType, quantity, price } = state;
  const { kiteClient } = ctx.services;

  const waitMsg = await ctx.reply('Checking margins and live price...');

  try {
    // 1. Fetch live quote to calculate estimated margin
    const quoteKey = `NSE:${symbol}`;
    const quotes = await kiteClient.getQuote([quoteKey]);
    const quote = quotes[quoteKey];

    if (!quote) {
      throw new Error('Could not fetch live price from Kite.');
    }

    const ltp = quote.last_price;
    const estPrice = orderType === 'LIMIT' ? price : ltp;
    const totalEstValue = estPrice * quantity;

    // 2. Fetch available margins
    const margins = await kiteClient.kc.getMargins('equity');
    const available = margins?.available?.live_balance || margins?.equity?.available?.live_balance || 0;

    let marginWarning = '';
    // For MIS, typically require 20% margin. For CNC, 100% margin.
    // This is an approximation.
    const requiredMargin = product === 'MIS' ? totalEstValue * 0.2 : totalEstValue;

    if (action === 'BUY' && available < requiredMargin) {
      marginWarning = `\n⚠️ **WARNING**: You may not have enough margin. Required: ~₹${requiredMargin.toFixed(2)}, Available: ₹${available.toFixed(2)}`;
    }

    const priceText = orderType === 'LIMIT' ? `₹${price}` : `MARKET (LTP: ₹${ltp})`;
    const emoji = action === 'BUY' ? '🟢' : '🔴';

    const summary = `${emoji} **CONFIRM ORDER**\n\n` +
      `**Action:** ${action}\n` +
      `**Symbol:** ${symbol}\n` +
      `**Product:** ${product}\n` +
      `**Type:** ${orderType}\n` +
      `**Quantity:** ${quantity}\n` +
      `**Price:** ${priceText}\n` +
      `**Est. Value:** ₹${totalEstValue.toFixed(2)}\n` +
      marginWarning;

    const keyboard = new InlineKeyboard()
      .text('✅ Confirm Order', 'trade_execute')
      .text('❌ Cancel', 'trade_cancel');

    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      summary,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );

  } catch (err) {
    logger.error({ err }, 'Error preparing order confirmation');
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      formatError(`Failed to prepare order: ${err.message}`)
    );
    ctx.session.tradeState = null;
  }
}

export async function executeTrade(ctx) {
  const state = ctx.session?.tradeState;
  if (!state || state.step !== 'CONFIRM') {
    await ctx.answerCallbackQuery('Session expired or invalid.');
    return;
  }

  const { action, symbol, product, orderType, quantity, price } = state;
  const { kiteClient } = ctx.services;

  const orderParams = {
    exchange: 'NSE',
    tradingsymbol: symbol,
    transaction_type: action,
    quantity: quantity,
    product: product,
    order_type: orderType,
    validity: 'DAY'
  };

  if (orderType === 'LIMIT') {
    orderParams.price = price;
  }

  try {
    const result = await kiteClient.placeOrder(orderParams);
    await ctx.api.editMessageText(
      ctx.chat.id,
      ctx.callbackQuery.message.message_id,
      `✅ **Order Placed Successfully!**\n\n**Order ID:** \`${result.order_id}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      ctx.callbackQuery.message.message_id,
      formatError(`Order Failed: ${err.message}`)
    );
  } finally {
    ctx.session.tradeState = null;
    await ctx.answerCallbackQuery();
  }
}

export async function cancelTrade(ctx) {
  ctx.session.tradeState = null;
  await ctx.api.editMessageText(
    ctx.chat.id,
    ctx.callbackQuery.message.message_id,
    '❌ Trade cancelled.'
  );
  await ctx.answerCallbackQuery();
}
