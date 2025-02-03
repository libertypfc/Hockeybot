import { pgTable, text, serial, integer, boolean, timestamp, unique, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  discordCategoryId: text("discord_category_id").notNull(),
  salaryCap: integer("salary_cap").default(0),
  availableCap: integer("available_cap").default(0),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").unique().notNull(),
  username: text("username").notNull(),
  currentTeamId: integer("current_team_id").references(() => teams.id),
  status: text("status").default("free_agent"),
  salaryExempt: boolean("salary_exempt").default(false),
  position: text("position").default("forward"),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  salary: integer("salary").notNull(),
  lengthInDays: integer("length_in_days").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").default("pending"),
});

export const waivers = pgTable("waivers", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  fromTeamId: integer("from_team_id").references(() => teams.id).notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  status: text("status").default("active"),
});

export const waiverSettings = pgTable("waiver_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  notificationChannelId: text("notification_channel_id").notNull(),
  scoutRoleId: text("scout_role_id").notNull(),
  gmRoleId: text("gm_role_id").notNull(),
});

export const playerStats = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  gameId: integer("game_id").references(() => games.id).notNull(),
  goals: integer("goals").default(0),
  assists: integer("assists").default(0),
  plusMinus: integer("plus_minus").default(0),
  pim: integer("penalty_minutes").default(0),
  shots: integer("shots").default(0),
  timeOnIce: integer("time_on_ice").default(0),
  hits: integer("hits").default(0),
  faceoffsWon: integer("faceoffs_won").default(0),
  faceoffsTotal: integer("faceoffs_total").default(0),
  takeaways: integer("takeaways").default(0),
  interceptions: integer("interceptions").default(0),
  giveaways: integer("giveaways").default(0),
  blockedShots: integer("blocked_shots").default(0),
  passesCompleted: integer("passes_completed").default(0),
  passesAttempted: integer("passes_attempted").default(0),
});

export const goalieStats = pgTable("goalie_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  gameId: integer("game_id").references(() => games.id).notNull(),
  saves: integer("saves").default(0),
  goalsAgainst: integer("goals_against").default(0),
    timeOnIce: integer("time_on_ice").default(0),
  breakaways: integer("breakaways").default(0),
  breakawaySaves: integer("breakaway_saves").default(0),
  desperationSaves: integer("desperation_saves").default(0),
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  homeTeamId: integer("home_team_id").references(() => teams.id).notNull(),
  awayTeamId: integer("away_team_id").references(() => teams.id).notNull(),
  homeScore: integer("home_score").default(0),
  awayScore: integer("away_score").default(0),
  date: timestamp("date").notNull(),
  status: text("status").default("scheduled"),
});


export const teamsRelations = relations(teams, ({ many }) => ({
  players: many(players),
  contracts: many(contracts),
  homeGames: many(games, { relationName: "homeGames" }),
  awayGames: many(games, { relationName: "awayGames" }),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  currentTeam: one(teams, {
    fields: [players.currentTeamId],
    references: [teams.id],
  }),
    stats: many(playerStats),
    goalieStats: many(goalieStats),
}));


export const contractsRelations = relations(contracts, ({ one }) => ({
  player: one(players, {
    fields: [contracts.playerId],
    references: [players.id],
  }),
  team: one(teams, {
    fields: [contracts.teamId],
    references: [teams.id],
  }),
}));

export const playerStatsRelations = relations(playerStats, ({ one }) => ({
  player: one(players, {
    fields: [playerStats.playerId],
    references: [players.id],
  }),
  game: one(games, {
    fields: [playerStats.gameId],
    references: [games.id],
  }),
}));

export const goalieStatsRelations = relations(goalieStats, ({ one }) => ({
  player: one(players, {
    fields: [goalieStats.playerId],
    references: [players.id],
  }),
    game: one(games, {
    fields: [goalieStats.gameId],
    references: [games.id],
    }),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
    homeTeam: one(teams, {
        fields: [games.homeTeamId],
        references: [teams.id],
        relationName: "homeGames",
    }),
    awayTeam: one(teams, {
        fields: [games.awayTeamId],
        references: [teams.id],
        relationName: "awayGames",
    }),
    playerStats: many(playerStats),
    goalieStats: many(goalieStats),
}));


export const insertTeamSchema = createInsertSchema(teams);
export const selectTeamSchema = createSelectSchema(teams);

export const insertPlayerSchema = createInsertSchema(players);
export const selectPlayerSchema = createSelectSchema(players);

export const insertContractSchema = createInsertSchema(contracts);
export const selectContractSchema = createSelectSchema(contracts);

export const insertWaiverSchema = createInsertSchema(waivers);
export const selectWaiverSchema = createSelectSchema(waivers);

export const insertWaiverSettingsSchema = createInsertSchema(waiverSettings);
export const selectWaiverSettingsSchema = createSelectSchema(waiverSettings);

export const insertPlayerStatsSchema = createInsertSchema(playerStats);
export const selectPlayerStatsSchema = createSelectSchema(playerStats);

export const insertGoalieStatsSchema = createInsertSchema(goalieStats);
export const selectGoalieStatsSchema = createSelectSchema(goalieStats);

export const insertGameSchema = createInsertSchema(games);
export const selectGameSchema = createSelectSchema(games);

export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
export type WaiverSettings = typeof waiverSettings.$inferSelect;
export type PlayerStats = typeof playerStats.$inferSelect;
export type GoalieStats = typeof goalieStats.$inferSelect;
export type Game = typeof games.$inferSelect;