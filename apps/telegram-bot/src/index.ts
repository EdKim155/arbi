import fetch from 'node-fetch';
import { Telegraf } from 'telegraf';

const token = process.env.BOT_TOKEN;
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(token);
const userTokens = new Map<number, string>();

const helpMessage = `🤖 Доступные команды:
/start — приветственное сообщение
/help — показать помощь
/id — ваш Telegram ID
/link <JWT> — привязать аккаунт (используйте токен авторизации из веб-приложения)
/notify <on|off> — включить или выключить уведомления`;

const callBackend = async (path: string, authToken: string, body: unknown) => {
  const response = await fetch(`${backendUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend request failed: ${response.status} ${text}`);
  }
  return response.json();
};

bot.start((ctx) => {
  ctx.reply(
    `Добро пожаловать, ${ctx.from.first_name ?? 'трейдер'}!\n` +
      'Отправьте /help, чтобы увидеть доступные команды.\n' +
      `Ваш Telegram ID: ${ctx.from.id}`,
  );
});

bot.help((ctx) => ctx.reply(helpMessage));

bot.command('id', (ctx) => {
  ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
});

bot.command('link', async (ctx) => {
  const [, ...rest] = ctx.message.text.split(' ');
  const jwt = rest[0];
  if (!jwt) {
    await ctx.reply('Передайте JWT токен авторизации: /link <JWT>');
    return;
  }
  try {
    await callBackend('/auth/link-telegram', jwt, { telegramUserId: String(ctx.from.id) });
    userTokens.set(ctx.from.id, jwt);
    await ctx.reply('Аккаунт успешно привязан. Уведомления будут приходить сюда.');
  } catch (err: any) {
    console.error('Link failed', err);
    await ctx.reply('Не удалось привязать аккаунт. Убедитесь, что токен действителен.');
  }
});

bot.command('notify', async (ctx) => {
  const [, ...rest] = ctx.message.text.split(' ');
  const state = rest[0]?.toLowerCase();
  if (!state || (state !== 'on' && state !== 'off')) {
    await ctx.reply('Используйте: /notify <on|off>');
    return;
  }
  const jwt = userTokens.get(ctx.from.id);
  if (!jwt) {
    await ctx.reply('Сначала привяжите аккаунт командой /link <JWT>.');
    return;
  }
  try {
    await callBackend('/auth/notifications', jwt, { enabled: state === 'on' });
    await ctx.reply(state === 'on' ? 'Уведомления включены.' : 'Уведомления выключены.');
  } catch (err: any) {
    console.error('Notify update failed', err);
    await ctx.reply('Не удалось обновить настройки. Попробуйте позже.');
  }
});

bot.launch().then(() => {
  console.log('Telegram bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
