import { config } from 'dotenv';

// Load environment variables
config();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000, // Default to 5000 for deployment platforms
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  // Add more environment variables as needed
} as const;

// Validate required environment variables
export function validateConfig() {
  const required = ['DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate PORT is a valid number
  if (isNaN(CONFIG.PORT)) {
    throw new Error('PORT environment variable must be a valid number');
  }
}