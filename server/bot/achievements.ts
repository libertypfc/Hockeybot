import { Client } from 'discord.js';
import { db } from '@db';
import { achievements, botUptimeAchievements } from '@db/schema';
import { eq } from 'drizzle-orm';

// Define initial achievements
const UPTIME_ACHIEVEMENTS = [
  {
    name: "First Steps",
    description: "Bot has been online for 24 hours",
    type: "uptime",
    requirement: 24,
    icon: "🌱",
    color: "#4ade80"
  },
  {
    name: "Weekly Warrior",
    description: "Bot has been online for 7 days straight",
    type: "uptime",
    requirement: 168, // 7 * 24
    icon: "⚔️",
    color: "#2563eb"
  },
  {
    name: "Monthly Master",
    description: "Bot has been online for 30 days",
    type: "uptime",
    requirement: 720, // 30 * 24
    icon: "👑",
    color: "#7c3aed"
  },
  {
    name: "Quarterly Champion",
    description: "Bot has been online for 90 days",
    type: "uptime",
    requirement: 2160, // 90 * 24
    icon: "🏆",
    color: "#c026d3"
  },
  {
    name: "Yearly Legend",
    description: "Bot has been online for 365 days",
    type: "uptime",
    requirement: 8760, // 365 * 24
    icon: "🌟",
    color: "#fbbf24"
  }
];

export async function initializeAchievements() {
  try {
    // Check if achievements already exist
    const existingAchievements = await db.query.achievements.findMany({
      where: eq(achievements.type, 'uptime')
    });

    if (existingAchievements.length === 0) {
      // Insert initial achievements
      await db.insert(achievements).values(UPTIME_ACHIEVEMENTS);
      console.log('Initialized uptime achievements');
    }
  } catch (error) {
    console.error('Error initializing achievements:', error);
  }
}

export async function checkUptimeAchievements(client: Client) {
  try {
    const uptimeHours = Math.floor(client.uptime! / (1000 * 60 * 60));
    
    // Get all uptime achievements
    const allAchievements = await db.query.achievements.findMany({
      where: eq(achievements.type, 'uptime'),
      orderBy: (achievements, { asc }) => [asc(achievements.requirement)]
    });

    // Get already earned achievements
    const earnedAchievements = await db.query.botUptimeAchievements.findMany();
    const earnedIds = new Set(earnedAchievements.map(ea => ea.achievementId));

    // Check for new achievements
    for (const achievement of allAchievements) {
      if (!earnedIds.has(achievement.id) && uptimeHours >= achievement.requirement) {
        // Award new achievement
        await db.insert(botUptimeAchievements).values({
          achievementId: achievement.id,
          uptimeHours: uptimeHours
        });

        // Announce the achievement
        const guilds = Array.from(client.guilds.cache.values());
        for (const guild of guilds) {
          const channel = guild.systemChannel;
          if (channel) {
            await channel.send({
              content: `🎉 **Achievement Unlocked!**\n${achievement.icon} **${achievement.name}**\n${achievement.description}\nBot has been online for ${uptimeHours} hours!`
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking uptime achievements:', error);
  }
}
