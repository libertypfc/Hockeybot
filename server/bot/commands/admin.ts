import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { guildSettings, teams } from '@db/schema';
import { eq, lt, gt } from 'drizzle-orm';

export const AdminCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('setwelcomechannel')
      .setDescription('Set the channel for welcome messages')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to send welcome messages in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions('0'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildText) {
          return interaction.editReply('Please select a text channel for welcome messages.');
        }

        await db.insert(guildSettings)
          .values({
            guildId: interaction.guildId!,
            welcomeChannelId: channel.id,
          })
          .onConflictDoUpdate({
            target: guildSettings.guildId,
            set: { welcomeChannelId: channel.id },
          });

        await interaction.editReply(`Welcome messages will now be sent to ${channel}`);
      } catch (error) {
        console.error('Error setting welcome channel:', error);
        await interaction.editReply('Failed to set welcome channel');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setcapnotificationchannel')
      .setDescription('Set the channel for salary cap notifications')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to send cap notifications in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions('0'),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildText) {
          return interaction.editReply('Please select a text channel for cap notifications.');
        }

        await db.insert(guildSettings)
          .values({
            guildId: interaction.guildId!,
            capNotificationChannelId: channel.id,
          })
          .onConflictDoUpdate({
            target: guildSettings.guildId,
            set: { capNotificationChannelId: channel.id },
          });

        await interaction.editReply(`Salary cap notifications will now be sent to ${channel}`);
      } catch (error) {
        console.error('Error setting cap notification channel:', error);
        await interaction.editReply('Failed to set cap notification channel');
      }
    },
  },
];

export async function checkCapCompliance(client: any) {
  try {
    const allTeams = await db.query.teams.findMany({
      with: {
        players: true,
      },
    });

    const settings = await db.query.guildSettings.findFirst();
    if (!settings?.capNotificationChannelId) return;

    const notificationChannel = await client.channels.fetch(settings.capNotificationChannelId);
    if (!notificationChannel) return;

    for (const team of allTeams) {
      const activeContracts = await db.select({
        playerId: contracts.playerId,
        salary: contracts.salary,
      })
      .from(contracts)
      .where(eq(contracts.teamId, team.id));

      // Calculate total salary excluding exempt players
      const totalSalary = activeContracts.reduce((sum, contract) => {
        const player = team.players.find(p => p.id === contract.playerId);
        return sum + (player?.salaryExempt ? 0 : contract.salary);
      }, 0);

      if (totalSalary < team.capFloor) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Salary Cap Floor Alert')
          .setDescription(`${team.name} is below the salary cap floor!`)
          .addFields(
            { name: 'Current Total Salary', value: `$${totalSalary.toLocaleString()}` },
            { name: 'Cap Floor', value: `$${team.capFloor.toLocaleString()}` },
            { name: 'Amount Below Floor', value: `$${(team.capFloor - totalSalary).toLocaleString()}` }
          )
          .setColor('#FF9900')
          .setTimestamp();

        await notificationChannel.send({ embeds: [embed] });
      } else if (totalSalary > team.salaryCap) {
        const embed = new EmbedBuilder()
          .setTitle('🚨 Salary Cap Exceeded')
          .setDescription(`${team.name} is over the salary cap!`)
          .addFields(
            { name: 'Current Total Salary', value: `$${totalSalary.toLocaleString()}` },
            { name: 'Salary Cap', value: `$${team.salaryCap.toLocaleString()}` },
            { name: 'Amount Over Cap', value: `$${(totalSalary - team.salaryCap).toLocaleString()}` }
          )
          .setColor('#FF0000')
          .setTimestamp();

        await notificationChannel.send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('Error checking cap compliance:', error);
  }
}