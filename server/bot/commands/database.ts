import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';

const REQUIRED_ROLE_NAME = "Database Manager";

// Combine all database commands into a single command with subcommands
export const DatabaseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('database')
      .setDescription('Database management commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgeall')
          .setDescription('WARNING: Removes all data from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgeplayers')
          .setDescription('WARNING: Removes all players from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgecontracts')
          .setDescription('WARNING: Removes all contracts from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgewaivers')
          .setDescription('WARNING: Removes all waivers from the database')
      ),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        await interaction.deferReply({ ephemeral: true });
        console.log('Database command initiated by:', interaction.user.tag);

        // Check if command is used in a guild
        if (!interaction.guild || !interaction.member) {
          console.log('Command used outside of guild context');
          return await interaction.editReply('This command can only be used in a server.');
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        console.log('Member fetched:', member.user.tag);

        // Log available roles
        const availableRoles = member.roles.cache.map(role => role.name);
        console.log('Available roles:', availableRoles.join(', '));

        const hasRequiredRole = member.roles.cache.some(role => role.name === REQUIRED_ROLE_NAME);
        console.log('Has required role:', hasRequiredRole);

        if (!hasRequiredRole) {
          const errorMessage = `You need the "${REQUIRED_ROLE_NAME}" role to use database management commands.\n\n` +
            `Please ask a server administrator to:\n` +
            `1. Create a role named exactly "${REQUIRED_ROLE_NAME}"\n` +
            `2. Assign this role to users who should have database management permissions`;

          console.log('Sending role requirement error to user:', interaction.user.tag);
          return await interaction.editReply(errorMessage);
        }

        const subcommand = interaction.options.getSubcommand();
        console.log('Executing subcommand:', subcommand);

        switch (subcommand) {
          case 'purgeall':
            // Delete in order to maintain referential integrity
            await db.delete(contracts);
            await db.delete(waivers);
            await db.delete(players);
            await db.delete(teams);
            await interaction.editReply('All data has been purged from the database.');
            break;

          case 'purgeplayers':
            await db.delete(players);
            await interaction.editReply('All players have been removed from the database.');
            break;

          case 'purgecontracts':
            await db.delete(contracts);
            await interaction.editReply('All contracts have been removed from the database.');
            break;

          case 'purgewaivers':
            await db.delete(waivers);
            await interaction.editReply('All waivers have been removed from the database.');
            break;

          default:
            await interaction.editReply('Invalid subcommand.');
        }
      } catch (error) {
        console.error('Error in database command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

        // Make sure we have a valid interaction to reply to
        if (interaction.deferred) {
          await interaction.editReply(`Failed to execute command: ${errorMessage}`);
        } else {
          try {
            await interaction.reply({ content: `Failed to execute command: ${errorMessage}`, ephemeral: true });
          } catch (replyError) {
            console.error('Failed to send error message:', replyError);
          }
        }
      }
    },
  },
];