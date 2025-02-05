import { startBot } from './discord';
import { log } from '../vite';

async function testBot() {
  try {
    log('Starting Discord bot test...', 'test');
    const client = await startBot();

    if (!client) {
      throw new Error('Failed to initialize Discord client');
    }

    // Basic bot functionality test
    log(`Bot is logged in as ${client.user?.tag}`, 'test');
    log(`Bot is in ${client.guilds.cache.size} guilds`, 'test');

    // List all available commands
    const commands = await client.application?.commands.fetch();
    if (commands) {
      log(`Available commands (${commands.size}): ${[...commands.values()].map(cmd => cmd.name).join(', ')}`, 'test');
    } else {
      log('No commands found or commands not yet registered', 'test');
    }

    // Test heartbeat
    const ping = client.ws.ping;
    log(`Current WebSocket ping: ${ping}ms`, 'test');

    log('Discord bot test completed successfully', 'test');
    return true;
  } catch (error) {
    console.error('Error testing Discord bot:', error);
    log(`Bot test failed: ${error}`, 'test');
    return false;
  }
}

testBot().then(success => {
  if (!success) {
    process.exit(1);
  }
});