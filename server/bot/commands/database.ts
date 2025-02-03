import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';

export const DatabaseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('cleanteams')
      .setDescription('WARNING: Removes all teams from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        await db.delete(teams);
        await interaction.editReply('All teams have been removed from the database.');
      } catch (error) {
        console.error('Error cleaning teams:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clean teams: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('cleanplayers')
      .setDescription('WARNING: Removes all players from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        await db.delete(players);
        await interaction.editReply('All players have been removed from the database.');
      } catch (error) {
        console.error('Error cleaning players:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clean players: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('cleancontracts')
      .setDescription('WARNING: Removes all contracts from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        await db.delete(contracts);
        await interaction.editReply('All contracts have been removed from the database.');
      } catch (error) {
        console.error('Error cleaning contracts:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clean contracts: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('cleanwaivers')
      .setDescription('WARNING: Removes all waivers from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        await db.delete(waivers);
        await interaction.editReply('All waivers have been removed from the database.');
      } catch (error) {
        console.error('Error cleaning waivers:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clean waivers: ${errorMessage}`);
      }
    },
  },
];