# TyronesMacros

A smart fitness & nutrition tracking PWA with AI coaching, built with React + Vite + Supabase.

## Local Development

### Prerequisites

- Node.js (LTS version)
- npm

### Setup

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env.local` file in the root of the project and add your API keys:

    ```
    VITE_SUPABASE_URL=your-supabase-url
    VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
    OPENAI_API_KEY=your-openai-api-key
    ```

4.  Start the development server:
    ```bash
    npm run dev
    ```

The application will be available at `http://localhost:5173`.

### Database Setup

1. Create a Supabase project
2. Run the migration in `supabase/migrations/create_v2_schema.sql`
3. Set up your environment variables

## Features

- **Smart Macro Tracking**: AI-powered food logging with macro estimation
- **Workout Planning**: AI-generated weekly workout plans
- **History & Analytics**: Charts and trends with Recharts
- **Saved Meals**: Quick-add favorite foods and meal templates
- **Real-time Updates**: Instant UI updates with event bus
- **PWA Support**: Install as native app on mobile devices

## API Endpoints

- `/api/health` - Health check with environment status
- `/api/estimate-macros` - AI food parsing and macro estimation
- `/api/meal-swap` - Healthier meal alternatives
- `/api/plan-week` - 7-day workout plan generation

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Health check
curl http://localhost:5173/api/health
```

## Architecture

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Supabase (Auth, Database, RLS)
- **AI**: OpenAI GPT-4o-mini via serverless functions
- **Charts**: Recharts for data visualization
- **State**: Event bus for real-time updates
- **PWA**: Service worker + manifest for native app experience

## Acceptance Tests

✅ `/api/health` returns environment status  
✅ Natural language food input works with AI parsing  
✅ Workout planning generates 7-day plans  
✅ History charts render with no errors  
✅ All features work with structured error handling  
✅ Single `npm run dev` command starts everything  
✅ No raw database drivers - only HTTPS via Supabase  

## Production Ready

- Zero raw API/network errors
- Graceful fallbacks when AI is unavailable
- Optimistic UI updates with event bus
- Mobile-first responsive design
- Dark/light theme support
- WebContainer compliant architecture