import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const OrganizationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createteam')
      .setDescription('Create a new team')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Create the team with default values
        const [team] = await db.insert(teams)
          .values({
            name,
            guild_id: guildId,
            salary_cap: 82500000, // Default salary cap
            available_cap: 82500000,
            cap_floor: 60375000, // 73.2% of cap
            discord_category_id: '', // Empty string as placeholder
            metadata: '{}',
          })
          .returning();

        const embed = new EmbedBuilder()
          .setTitle('Team Created')
          .setDescription(`Team "${name}" has been created successfully.`)
          .addFields(
            { name: 'Salary Cap', value: `$${team.salary_cap.toLocaleString()}`, inline: true },
            { name: 'Cap Floor', value: `$${team.cap_floor.toLocaleString()}`, inline: true }
          )
          .setColor('#00FF00')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error creating team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('vieworg')
      .setDescription('View the teams in the server'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const guildId = interaction.guildId;

        if (!guildId) {
          return interaction.editReply('This command must be run in a guild.');
        }

        // Get all teams for this guild
        const guildTeams = await db.select({
          name: teams.name,
          salaryCap: teams.salary_cap,
          capFloor: teams.cap_floor,
        })
        .from(teams)
        .where(eq(teams.guild_id, guildId));

        if (guildTeams.length === 0) {
          return interaction.editReply('No teams found in this server.');
        }

        const embed = new EmbedBuilder()
          .setTitle('Server Teams')
          .setColor('#0099ff')
          .setDescription('Here are all the teams in this server:');

        for (const team of guildTeams) {
          embed.addFields({
            name: team.name,
            value: `Salary Cap: $${team.salaryCap.toLocaleString()}\nCap Floor: $${team.capFloor.toLocaleString()}`,
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Error displaying teams:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to display teams: ${errorMessage}`);
      }
    },
  },
].filter(Boolean);