import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import {
  TokenMonitor,
  tokenMonitorSchema,
  SpreadCondition,
  User,
  userSchema,
} from '@arbi/shared';

interface DatabaseSchema {
  users: User[];
  monitors: TokenMonitor[];
}

const defaultSchema: DatabaseSchema = {
  users: [],
  monitors: [],
};

export class JsonDatabase {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  private async ensureFile() {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(defaultSchema, null, 2), 'utf-8');
    }
  }

  private async read(): Promise<DatabaseSchema> {
    await this.ensureFile();
    const content = await fs.readFile(this.filePath, 'utf-8');
    const parsed = JSON.parse(content) as DatabaseSchema;
    return {
      users: parsed.users.map((u) => userSchema.parse(u)),
      monitors: parsed.monitors.map((m) => tokenMonitorSchema.parse(m)),
    };
  }

  private async write(data: DatabaseSchema) {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async createUser(email: string, passwordHash: string, telegramUserId?: string | null) {
    const db = await this.read();
    if (db.users.some((u) => u.email === email)) {
      throw new Error('User already exists');
    }
    const now = new Date().toISOString();
    const user: User = {
      id: nanoid(),
      email,
      passwordHash,
      telegramUserId: telegramUserId ?? null,
      notificationsEnabled: true,
      createdAt: now,
    };
    db.users.push(user);
    await this.write(db);
    return user;
  }

  async updateUser(user: User) {
    const db = await this.read();
    const idx = db.users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      throw new Error('User not found');
    }
    db.users[idx] = userSchema.parse(user);
    await this.write(db);
    return db.users[idx];
  }

  async findUserByEmail(email: string) {
    const db = await this.read();
    return db.users.find((u) => u.email === email) ?? null;
  }

  async findUserById(id: string) {
    const db = await this.read();
    return db.users.find((u) => u.id === id) ?? null;
  }

  async listMonitorsByUser(userId: string) {
    const db = await this.read();
    return db.monitors.filter((m) => m.userId === userId);
  }

  async findMonitorById(id: string) {
    const db = await this.read();
    return db.monitors.find((m) => m.id === id) ?? null;
  }

  async upsertMonitor(monitor: TokenMonitor) {
    const db = await this.read();
    const parsed = tokenMonitorSchema.parse(monitor);
    const idx = db.monitors.findIndex((m) => m.id === parsed.id);
    if (idx === -1) {
      db.monitors.push(parsed);
    } else {
      db.monitors[idx] = parsed;
    }
    await this.write(db);
    return parsed;
  }

  async createMonitor(params: {
    userId: string;
    contractAddress: string;
    mexcSymbol?: string;
    jupiterMintAddress?: string;
    displayName?: string;
    conditions?: SpreadCondition[];
  }) {
    const db = await this.read();
    const now = new Date().toISOString();
    const monitor: TokenMonitor = tokenMonitorSchema.parse({
      id: nanoid(),
      userId: params.userId,
      contractAddress: params.contractAddress,
      mexcSymbol: params.mexcSymbol,
      jupiterMintAddress: params.jupiterMintAddress,
      displayName: params.displayName,
      conditions: params.conditions ?? [],
      createdAt: now,
    });
    db.monitors.push(monitor);
    await this.write(db);
    return monitor;
  }

  async removeMonitor(id: string) {
    const db = await this.read();
    const next = db.monitors.filter((m) => m.id !== id);
    if (next.length === db.monitors.length) {
      return false;
    }
    db.monitors = next;
    await this.write(db);
    return true;
  }
}
