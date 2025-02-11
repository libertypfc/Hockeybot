import { startBot, client } from './index';
import { log } from '../vite';

async function testBot() {
  try {
    log('Starting Discord bot test...', 'test');
    await startBot();

    // Basic bot functionality test
    log(`Bot status: ${client.isReady() ? 'Ready' : 'Not Ready'}`, 'test');
    log(`Connection state: ${(client as any).connectionState}`, 'test');
    log(`Bot is in ${client.guilds.cache.size} guilds`, 'test');

    // List all available commands
    const commands = await client.application?.commands.fetch();
    if (commands) {
      log(`Available commands (${commands.size}):`, 'test');
      commands.forEach(command => {
        log(`- ${command.name}`, 'test');
      });
    } else {
      log('No commands found or commands not yet registered', 'test');
    }

    // Test heartbeat
    const ping = client.ws.ping;
    log(`Current WebSocket ping: ${ping}ms`, 'test');

    // Test guild availability
    if (client.guilds.cache.size === 0) {
      log('Warning: Bot is not in any guilds. Please add the bot to a server.', 'test');
    } else {
      log('Guild information:', 'test');
      client.guilds.cache.forEach(guild => {
        log(`- ${guild.name} (${guild.id})`, 'test');
      });
    }

    log('Discord bot test completed successfully', 'test');
    return true;
  } catch (error) {
    console.error('Error testing Discord bot:', error);
    log(`Bot test failed: ${error}`, 'test');
    return false;
  }
}

// Run the test
testBot().then(success => {
  if (!success) {
    process.exit(1);
  }
});

export { testBot };