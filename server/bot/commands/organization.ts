import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { conferences, divisions } from '@db/schema';
import { eq } from 'drizzle-orm';

export const OrganizationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createconference')
      .setDescription('Create a new conference')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the conference')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('abbreviation')
          .setDescription('The abbreviation for the conference')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const abbreviation = interaction.options.getString('abbreviation', true);

        const conference = await db.insert(conferences)
          .values({
            name,
            abbreviation,
          })
          .returning();

        await interaction.editReply(`Conference "${name}" (${abbreviation}) has been created.`);
      } catch (error) {
        console.error('Error creating conference:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create conference: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('createdivision')
      .setDescription('Create a new division')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the division')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('abbreviation')
          .setDescription('The abbreviation for the division')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('conference')
          .setDescription('The conference this division belongs to')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const name = interaction.options.getString('name', true);
        const abbreviation = interaction.options.getString('abbreviation', true);
        const conferenceName = interaction.options.getString('conference', true);

        // Find the conference
        const conference = await db.query.conferences.findFirst({
          where: eq(conferences.name, conferenceName),
        });

        if (!conference) {
          return interaction.editReply(`Conference "${conferenceName}" not found.`);
        }

        const division = await db.insert(divisions)
          .values({
            name,
            abbreviation,
            conferenceId: conference.id,
          })
          .returning();

        await interaction.editReply(
          `Division "${name}" (${abbreviation}) has been created in the ${conferenceName} conference.`
        );
      } catch (error) {
        console.error('Error creating division:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create division: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('vieworganization')
      .setDescription('View the league organization structure'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const conferenceData = await db.query.conferences.findMany({
          with: {
            divisions: {
              with: {
                teams: true,
              },
            },
          },
        });

        if (conferenceData.length === 0) {
          return interaction.editReply('No conferences found.');
        }

        const embed = new EmbedBuilder()
          .setTitle('League Organization')
          .setColor('#0099ff');

        for (const conference of conferenceData) {
          let conferenceText = '';

          for (const division of conference.divisions) {
            conferenceText += `\n__${division.name} Division__\n`;

            if (division.teams.length === 0) {
              conferenceText += '• No teams assigned\n';
            } else {
              division.teams.forEach(team => {
                conferenceText += `• ${team.name}\n`;
              });
            }
          }

          if (conferenceText) {
            embed.addFields({
              name: `${conference.name} Conference`,
              value: conferenceText || 'No divisions',
            });
          }
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Error displaying organization:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to display organization: ${errorMessage}`);
      }
    },
  },
];