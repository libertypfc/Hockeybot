import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';

// Combine all database commands into a single command with subcommands
export const DatabaseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('database')
      .setDescription('Database management commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('cleanteams')
          .setDescription('WARNING: Removes all teams from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cleanplayers')
          .setDescription('WARNING: Removes all players from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cleancontracts')
          .setDescription('WARNING: Removes all contracts from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cleanwaivers')
          .setDescription('WARNING: Removes all waivers from the database')
      ),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
          case 'cleanteams':
            await db.delete(teams);
            await interaction.editReply('All teams have been removed from the database.');
            break;

          case 'cleanplayers':
            await db.delete(players);
            await interaction.editReply('All players have been removed from the database.');
            break;

          case 'cleancontracts':
            await db.delete(contracts);
            await interaction.editReply('All contracts have been removed from the database.');
            break;

          case 'cleanwaivers':
            await db.delete(waivers);
            await interaction.editReply('All waivers have been removed from the database.');
            break;

          default:
            await interaction.editReply('Invalid subcommand.');
        }
      } catch (error) {
        console.error('Error in database command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to execute command: ${errorMessage}`);
      }
    },
  },
];