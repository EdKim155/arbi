import fetch from 'node-fetch';

export class TelegramNotifier {
  constructor(private botToken?: string) {}

  async sendMessage(chatId: string, text: string) {
    if (!this.botToken) {
      console.info('[telegram] message skipped', { chatId, text });
      return;
    }
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to send Telegram message: ${response.status} ${body}`);
    }
  }
}
