import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayerStatsForm } from "@/components/stats/player-stats-form";
import { GoalieStatsForm } from "@/components/stats/goalie-stats-form";
import { StatsHistory } from "@/components/stats/stats-history";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamStatsForm } from "@/components/stats/team-stats-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface Team {
  id: number;
  name: string;
}

interface Player {
  id: number;
  username: string;
  discordId: string;
}

interface Season {
  id: number;
  startDate: string;
  endDate: string;
  numberOfWeeks: number;
  status: 'pending' | 'active' | 'completed';
}

interface Game {
  id: number;
  gameDate: string;
  gameNumber: number;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

export default function StatsTracking() {
  const [activeTab, setActiveTab] = useState<"team" | "player" | "goalie">("team");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const { toast } = useToast();

  // Fetch current season
  const { data: currentSeason, isLoading: seasonLoading } = useQuery<Season>({
    queryKey: ['/api/season/current'],
  });

  // Get current week's schedule
  const startDate = startOfWeek(new Date());
  const endDate = endOfWeek(new Date());

  const { data: schedule, isLoading: scheduleLoading } = useQuery<Game[]>({
    queryKey: ['/api/schedule', { start: startDate.toISOString(), end: endDate.toISOString() }],
    enabled: !!currentSeason,
  });

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['/api/teams'],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: ['/api/teams/players', selectedTeam],
    enabled: !!selectedTeam,
  });

  return (
    <div className="min-h-screen w-full p-8 bg-gray-50">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Season Information */}
        <Card>
          <CardHeader>
            <CardTitle>Current Season</CardTitle>
            <CardDescription>
              {currentSeason 
                ? `Week ${Math.ceil((new Date().getTime() - new Date(currentSeason.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000))} of ${currentSeason.numberOfWeeks}`
                : 'No active season'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {seasonLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : currentSeason ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Start Date</p>
                    <p>{format(new Date(currentSeason.startDate), 'MMM d, yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">End Date</p>
                    <p>{format(new Date(currentSeason.endDate), 'MMM d, yyyy')}</p>
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-4">This Week's Schedule</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Game</TableHead>
                        <TableHead>Home Team</TableHead>
                        <TableHead>Away Team</TableHead>
                        <TableHead>Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheduleLoading ? (
                        <TableRow>
                          <TableCell colSpan={5}><Skeleton className="h-4 w-full" /></TableCell>
                        </TableRow>
                      ) : schedule?.length ? (
                        schedule.map((game) => (
                          <TableRow key={`${game.id}-${game.gameNumber}`}>
                            <TableCell>{format(new Date(game.gameDate), 'MMM d')}</TableCell>
                            <TableCell>{game.gameNumber}</TableCell>
                            <TableCell>{game.homeTeam}</TableCell>
                            <TableCell>{game.awayTeam}</TableCell>
                            <TableCell>
                              {game.homeScore !== null && game.awayScore !== null
                                ? `${game.homeScore} - ${game.awayScore}`
                                : 'TBD'}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center">
                            No games scheduled this week
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-500">
                  No active season. Use the Discord bot command <code>/startseason</code> to start a new season.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Management Card */}
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Stats Tracking</h1>

            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">Select Team</h2>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams?.map((team) => (
                    <SelectItem key={team.id} value={team.id.toString()}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "team" | "player" | "goalie")} className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-8">
                <TabsTrigger value="team">Team Stats</TabsTrigger>
                <TabsTrigger value="player">Player Stats</TabsTrigger>
                <TabsTrigger value="goalie">Goalie Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="team">
                {selectedTeam ? (
                  <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Team Statistics</h2>
                    <TeamStatsForm teamId={selectedTeam} />
                  </div>
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>

              <TabsContent value="player">
                {selectedTeam ? (
                  <PlayerStatsForm players={players} isLoading={playersLoading} />
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>

              <TabsContent value="goalie">
                {selectedTeam ? (
                  <GoalieStatsForm players={players} isLoading={playersLoading} />
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>
            </Tabs>

            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Stats History</h2>
              <StatsHistory type={activeTab} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}