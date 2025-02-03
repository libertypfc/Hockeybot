import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Team {
  id: number;
  name: string;
  salaryCap: number;
  availableCap: number;
}

interface TeamStats {
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface Player {
  id: number;
  username: string;
  discordId: string;
}

interface PlayerStats {
  hits: number;
  fow: number;
  takeaways: number;
  giveaways: number;
  shots: number;
  pim: number;
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

export default function StatsPage() {
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['/api/teams'],
  });

  const { data: teamStats, isLoading: teamStatsLoading } = useQuery<TeamStats>({
    queryKey: ['/api/teams/stats', selectedTeam],
    enabled: !!selectedTeam,
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: ['/api/teams/players', selectedTeam],
    enabled: !!selectedTeam,
  });

  const { data: playerStats, isLoading: playerStatsLoading } = useQuery<PlayerStats>({
    queryKey: ['/api/players/stats', selectedPlayer],
    enabled: !!selectedPlayer,
  });

  // Get current week's schedule
  const startDate = startOfWeek(new Date());
  const endDate = endOfWeek(new Date());

  const { data: schedule, isLoading: scheduleLoading } = useQuery<Game[]>({
    queryKey: ['/api/schedule', { start: startDate.toISOString(), end: endDate.toISOString() }],
  });

  return (
    <div className="container mx-auto py-6 space-y-8">
      {/* Schedule Section */}
      <Card>
        <CardHeader>
          <CardTitle>This Week's Schedule</CardTitle>
          <CardDescription>
            {format(startDate, 'MMM d')} - {format(endDate, 'MMM d, yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              ) : schedule?.map((game) => (
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
              ))}
              {schedule?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No games scheduled this week
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Team Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Team Statistics</CardTitle>
          <CardDescription>View team and player statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedTeam} onValueChange={setSelectedTeam}>
            <SelectTrigger>
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
        </CardContent>
      </Card>

      {/* Team Stats */}
      {selectedTeam && (
        <Card>
          <CardHeader>
            <CardTitle>Team Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>W</TableHead>
                  <TableHead>L</TableHead>
                  <TableHead>OTL</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>GF</TableHead>
                  <TableHead>GA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamStatsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ) : teamStats && (
                  <TableRow>
                    <TableCell>{teamStats.wins}</TableCell>
                    <TableCell>{teamStats.losses}</TableCell>
                    <TableCell>{teamStats.otLosses}</TableCell>
                    <TableCell>{teamStats.points}</TableCell>
                    <TableCell>{teamStats.goalsFor}</TableCell>
                    <TableCell>{teamStats.goalsAgainst}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Player Selection */}
      {selectedTeam && (
        <Card>
          <CardHeader>
            <CardTitle>Player Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
              <SelectTrigger>
                <SelectValue placeholder="Select a player" />
              </SelectTrigger>
              <SelectContent>
                {players?.map((player) => (
                  <SelectItem key={player.id} value={player.id.toString()}>
                    {player.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Player Stats */}
      {selectedPlayer && (
        <Card>
          <CardHeader>
            <CardTitle>Player Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hits</TableHead>
                  <TableHead>FOW</TableHead>
                  <TableHead>Takeaways</TableHead>
                  <TableHead>Giveaways</TableHead>
                  <TableHead>Shots</TableHead>
                  <TableHead>PIM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {playerStatsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ) : playerStats && (
                  <TableRow>
                    <TableCell>{playerStats.hits}</TableCell>
                    <TableCell>{playerStats.fow}</TableCell>
                    <TableCell>{playerStats.takeaways}</TableCell>
                    <TableCell>{playerStats.giveaways}</TableCell>
                    <TableCell>{playerStats.shots}</TableCell>
                    <TableCell>{playerStats.pim}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}