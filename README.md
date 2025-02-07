# Hockey League Discord Bot

A robust Discord bot for hockey league management, designed to streamline multi-server interactions and provide reliable team data synchronization.

## Features

- Team management and synchronization across multiple Discord servers
- Dynamic channel and role generation for teams
- Real-time server configuration
- Comprehensive error handling
- Database-backed persistence
- TypeScript-powered reliability

## Tech Stack

- TypeScript
- Discord.js
- Express
- PostgreSQL with Drizzle ORM
- React Query for data fetching
- Shadcn UI components

## Setup

1. Clone the repository
```bash
git clone [your-repository-url]
cd hockey-league-bot
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
Create a `.env` file in the root directory with the following variables:
```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=your_postgres_database_url
```

4. Start the development server
```bash
npm run dev
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
