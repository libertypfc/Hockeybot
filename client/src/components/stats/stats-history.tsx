import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface PlayerStats {
  id: number;
  playerId: number;
  playerName: string;
  gameDate: string;
  hits: number;
  fow: number;
  foTaken: number;
  takeaways: number;
  interceptions: number;
  giveaways: number;
  blockedShots: number;
  passesCompleted: number;
  passesAttempted: number;
  pim: number;
  shots: number;
}

interface GoalieStats {
  id: number;
  playerId: number;
  playerName: string;
  gameDate: string;
  saves: number;
  goalsAgainst: number;
  breakaways: number;
  breakawaySaves: number;
  desperationSaves: number;
  timeInNet: number;
}

interface StatsHistoryProps {
  type: "player" | "goalie";
}

export function StatsHistory({ type }: StatsHistoryProps) {
  const { data: stats, isLoading } = useQuery<PlayerStats[] | GoalieStats[]>({
    queryKey: [`/api/stats/${type}`],
  });

  if (isLoading) {
    return <div>Loading stats history...</div>;
  }

  if (!stats || stats.length === 0) {
    return <div>No stats recorded yet.</div>;
  }

  if (type === "player") {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Hits</TableHead>
            <TableHead>FO%</TableHead>
            <TableHead>TK</TableHead>
            <TableHead>INT</TableHead>
            <TableHead>GV</TableHead>
            <TableHead>BS</TableHead>
            <TableHead>PASS%</TableHead>
            <TableHead>PIM</TableHead>
            <TableHead>S</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(stats as PlayerStats[]).map((stat) => (
            <TableRow key={stat.id}>
              <TableCell>{format(new Date(stat.gameDate), "MMM d, yyyy")}</TableCell>
              <TableCell>{stat.playerName}</TableCell>
              <TableCell>{stat.hits}</TableCell>
              <TableCell>
                {stat.foTaken > 0
                  ? `${((stat.fow / stat.foTaken) * 100).toFixed(1)}%`
                  : "0%"}
              </TableCell>
              <TableCell>{stat.takeaways}</TableCell>
              <TableCell>{stat.interceptions}</TableCell>
              <TableCell>{stat.giveaways}</TableCell>
              <TableCell>{stat.blockedShots}</TableCell>
              <TableCell>
                {stat.passesAttempted > 0
                  ? `${(
                      (stat.passesCompleted / stat.passesAttempted) *
                      100
                    ).toFixed(1)}%`
                  : "0%"}
              </TableCell>
              <TableCell>{stat.pim}</TableCell>
              <TableCell>{stat.shots}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Goalie</TableHead>
          <TableHead>SV</TableHead>
          <TableHead>GA</TableHead>
          <TableHead>SV%</TableHead>
          <TableHead>BRKS</TableHead>
          <TableHead>BRKSV%</TableHead>
          <TableHead>DSV</TableHead>
          <TableHead>TOI</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(stats as GoalieStats[]).map((stat) => (
          <TableRow key={stat.id}>
            <TableCell>{format(new Date(stat.gameDate), "MMM d, yyyy")}</TableCell>
            <TableCell>{stat.playerName}</TableCell>
            <TableCell>{stat.saves}</TableCell>
            <TableCell>{stat.goalsAgainst}</TableCell>
            <TableCell>
              {stat.saves + stat.goalsAgainst > 0
                ? `${(
                    (stat.saves / (stat.saves + stat.goalsAgainst)) *
                    100
                  ).toFixed(1)}%`
                : "0%"}
            </TableCell>
            <TableCell>{stat.breakaways}</TableCell>
            <TableCell>
              {stat.breakaways > 0
                ? `${((stat.breakawaySaves / stat.breakaways) * 100).toFixed(1)}%`
                : "0%"}
            </TableCell>
            <TableCell>{stat.desperationSaves}</TableCell>
            <TableCell>
              {Math.floor(stat.timeInNet / 60)}:{(stat.timeInNet % 60)
                .toString()
                .padStart(2, "0")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
