import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";

interface Team {
  id: number;
  name: string;
  salaryCap: number;
  availableCap: number;
  totalSalary: number;
  playerCount: number;
}

export default function Home() {
  const { data: teams, isLoading, error } = useQuery<Team[]>({ 
    queryKey: ['/api/teams'],
  });

  return (
    <div className="min-h-screen w-full p-8 bg-gray-50">
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="pt-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Hockey League Management System</h1>

          <div className="space-y-6">
            <p className="text-gray-600">
              Welcome to our comprehensive Hockey League Management System. This platform provides advanced tools for managing your hockey league.
            </p>

            <div>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Current League Status</h2>

              {isLoading && (
                <p className="text-gray-600">Loading team information...</p>
              )}

              {error && (
                <p className="text-red-600">Error loading team information. Please try again later.</p>
              )}

              {teams && teams.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {teams.map(team => (
                    <Card key={team.id} className="bg-white">
                      <CardContent className="pt-4">
                        <h3 className="text-lg font-semibold text-gray-900">{team.name}</h3>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          <li>Players: {team.playerCount}</li>
                          <li>Salary Cap: ${team.salaryCap?.toLocaleString()}</li>
                          <li>Available Cap: ${team.availableCap?.toLocaleString()}</li>
                          <li>Total Salary: ${team.totalSalary?.toLocaleString()}</li>
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : !isLoading && (
                <p className="text-gray-600">No teams found. Use Discord bot commands to create teams.</p>
              )}
            </div>

            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-2">Available Features:</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-600 ml-4">
                <li>Team Management and Creation</li>
                <li>Player Contracts and Negotiations</li>
                <li>Salary Cap Tracking</li>
                <li>Roster Management</li>
                <li>Player Trading System</li>
                <li>Waiver Wire Management</li>
              </ul>

              <p className="mt-4 text-gray-600">
                Use our Discord bot commands to interact with the system and manage your league efficiently.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}