import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-4xl mx-4">
        <CardContent className="pt-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Hockey League Management System</h1>

          <div className="space-y-4">
            <p className="text-gray-600">
              Welcome to our comprehensive Hockey League Management System. This platform provides advanced tools for managing your hockey league, including:
            </p>

            <ul className="list-disc list-inside space-y-2 text-gray-600 ml-4">
              <li>Team Management and Creation</li>
              <li>Player Contracts and Negotiations</li>
              <li>Salary Cap Tracking</li>
              <li>Roster Management</li>
              <li>Player Trading System</li>
              <li>Waiver Wire Management</li>
            </ul>

            <p className="text-gray-600">
              Use our Discord bot commands to interact with the system and manage your league efficiently.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}