import { startBot } from './discord';
import { log } from '../vite';

async function testBot() {
  try {
    log('Starting Discord bot test...', 'test');
    const client = await startBot();
    
    // Basic bot functionality test
    log(`Bot is logged in as ${client.user?.tag}`, 'test');
    log(`Bot is in ${client.guilds.cache.size} guilds`, 'test');
    
    // List all available commands
    const commands = client.application?.commands.cache;
    if (commands) {
      log(`Available commands: ${commands.map(cmd => cmd.name).join(', ')}`, 'test');
    }
    
    log('Discord bot test completed successfully', 'test');
  } catch (error) {
    console.error('Error testing Discord bot:', error);
    process.exit(1);
  }
}

testBot();
