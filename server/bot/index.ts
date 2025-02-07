import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams, guildSettings } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { registerCommands } from './commands/index';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, {
      data: SlashCommandBuilder,
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>
    }>;
  }
}

export class DiscordBot extends Client {
  private static instance: DiscordBot | null = null;
  private isConnecting: boolean = false;
  private reconnectAttempt: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 5000;

  constructor() {
    if (DiscordBot.instance) {
      return DiscordBot.instance;
    }

    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.commands = new Collection();
    this.setupEventHandlers();
    DiscordBot.instance = this;
  }

  private log(message: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info'): void {
    console.log(`[${new Date().toISOString()}] [BOT ${level.toUpperCase()}] ${message}`);
  }

  private setupEventHandlers(): void {
    this.once(Events.ClientReady, this.handleReady.bind(this));
    this.on(Events.Error, this.handleError.bind(this));
    this.on('disconnect', this.handleDisconnect.bind(this));
  }

  async start(): Promise<boolean> {
    if (this.isConnecting) {
      this.log('Already attempting to connect...', 'warn');
      return false;
    }

    this.isConnecting = true;

    try {
      const token = process.env.DISCORD_TOKEN;
      if (!token) {
        throw new Error('DISCORD_TOKEN environment variable is not set');
      }

      await this.login(token);
      this.log('Login successful', 'info');

      this.isConnecting = false;
      this.reconnectAttempt = 0;
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Connection failed: ${errorMessage}`, 'error');

      if (this.reconnectAttempt < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempt++;
        this.isConnecting = false;
        const backoffTime = Math.min(2000 * this.reconnectAttempt, this.RECONNECT_DELAY);
        this.log(`Waiting ${backoffTime}ms before retry...`, 'info');
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        return this.start();
      }

      this.isConnecting = false;
      throw new Error(`Failed to connect after ${this.reconnectAttempt} attempts: ${errorMessage}`);
    }
  }

  private handleError(error: Error): void {
    this.log(`Error encountered: ${error.message}`, 'error');
    console.error(error);
  }

  private handleDisconnect(): void {
    this.log('Disconnected from Discord', 'warn');
    this.cleanup();
  }

  private async cleanup(): Promise<void> {
    try {
      this.log('Starting cleanup process...', 'debug');
      this.removeAllListeners();
      if (this.ws) {
        this.ws.removeAllListeners();
      }
      this.guilds.cache.clear();
      this.channels.cache.clear();
      this.users.cache.clear();
      this.log('Cleanup completed', 'debug');
    } catch (error) {
      this.log(`Error during cleanup: ${error}`, 'error');
    }
  }

  private async handleReady() {
    this.log('Bot is ready and connected to Discord', 'info');
    try {
      // Force guild fetch after ready
      try {
        const guilds = await this.guilds.fetch();
        this.log(`Fetched ${guilds.size} guilds on ready`, 'info');
      } catch (error) {
        this.log(`Warning: Guild fetch failed: ${error}`, 'warn');
      }

      await registerCommands(this);
      this.log('Commands registered successfully', 'info');
    } catch (error) {
      this.log(`Command registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }
}

export const client = new DiscordBot();

export async function startBot(): Promise<DiscordBot> {
  try {
    await client.start();
    return client;
  } catch (error) {
    console.error('Bot startup failed:', error);
    throw error;
  }
}