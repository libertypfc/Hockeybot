import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-4xl mx-4">
        <CardContent className="pt-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Hockey League Management</h1>
          <p className="text-gray-600">
            Welcome to the Hockey League Management System. This dashboard provides access to league statistics, team information, and player management tools.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
