import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';

export const DatabaseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('cleandatabase')
      .setDescription('WARNING: Removes all data from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        // Delete all data in order to maintain referential integrity
        await db.delete(waivers);
        await db.delete(contracts);
        await db.delete(players);
        await db.delete(teams);

        await interaction.editReply('Database has been cleaned. All teams, players, contracts, and waivers have been removed.');

      } catch (error) {
        console.error('Error cleaning database:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clean database: ${errorMessage}`);
      }
    },
  },
];
