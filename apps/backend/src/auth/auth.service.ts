import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JsonDatabase } from '../storage/json-db.js';
import { generateTemporaryPassword, hiddenPasswordMessage, User } from '@arbi/shared';
import { TelegramNotifier } from '../telegram/telegram.service.js';

export interface AuthServiceOptions {
  jwtSecret: string;
  telegramNotifier: TelegramNotifier;
}

export class AuthService {
  constructor(private db: JsonDatabase, private options: AuthServiceOptions) {}

  private createToken(user: User) {
    return jwt.sign({ sub: user.id, email: user.email }, this.options.jwtSecret, {
      expiresIn: '7d',
    });
  }

  async register(email: string, password: string, telegramUserId?: string | null) {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.db.createUser(email, passwordHash, telegramUserId);
    const token = this.createToken(user);
    return { user, token };
  }

  async login(email: string, password: string) {
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new Error('Invalid credentials');
    }
    return { user, token: this.createToken(user) };
  }

  async resetPassword(email: string) {
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    user.passwordHash = passwordHash;
    await this.db.updateUser(user);
    if (user.telegramUserId) {
      await this.options.telegramNotifier.sendMessage(
        user.telegramUserId,
        `Ваш новый пароль: ${hiddenPasswordMessage(temporaryPassword)}`,
      );
    }
    return { user, temporaryPassword };
  }
}
