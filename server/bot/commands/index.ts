import { Client, Collection } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';

export function registerCommands(client: Client) {
  client.commands = new Collection();

  // Register all command modules
  [
    ...TeamCommands,
    ...ContractCommands, 
    ...WaiversCommands,
    ...TradeCommands,
  ].forEach(command => {
    client.commands.set(command.data.name, command);
  });
}
