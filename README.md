# TyronesMacros

A simple mobile app that tracks daily countdown macros (what’s left to hit targets) plus workouts.

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
3.  Create a `.env.local` file in the root of the project and add your Gemini API key. This file is ignored by version control for security.

    ```
    VITE_API_KEY=your_key_here
    ```

4.  Run the development server:
    ```bash
    npm run dev
    ```

The application will be available on your local network.

---

## Adding to Your Phone (PWA Installation)

You can add this web app to your phone's home screen so it looks and feels like a regular app.

### Instructions

1.  **Start the App:** Make sure the development server is running (`npm run dev`).
2.  **Find Your Network IP:** Your terminal will show an address like `http://192.168.1.10:5173`. This is the address you need. `localhost` will not work from your phone.
3.  **Open on Your Phone:** Open the browser on your phone (Safari for iOS, Chrome for Android) and go to the network address from the previous step.
    -   *Note: Your phone and your computer must be connected to the same Wi-Fi network.*

### On iOS (iPhone/iPad)

1.  Tap the **Share** button in Safari's bottom toolbar. It looks like a square with an arrow pointing up.
2.  Scroll down the share sheet and tap **"Add to Home Screen"**.
3.  Confirm the name and tap **"Add"**. The app icon will now be on your home screen.

### On Android

1.  Tap the **three-dot menu** icon in the top right corner of Chrome.
2.  Tap **"Install app"** or **"Add to Home screen"** from the menu.
3.  Follow the on-screen prompts to confirm. The app icon will be added to your home screen.


## OpenAI Responses API, Rate limiting, and Model Selector

- Server: `api/generate.ts` now uses OpenAI **Responses API** (`gpt-4o-mini` by default), supports `response_format` with JSON schema, and applies a simple in-memory **rate limit** (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`).
- Client: `services/openaiService.ts` provides replacements for the former Gemini helpers and auto-sends the **selected model** (saved in `localStorage` by `components/ModelSelector.tsx`).
- Env: set `OPENAI_API_KEY`, optionally override `OPENAI_MODEL` and `VITE_OPENAI_MODEL`.

## Implement Git

3. Stage all your files
git add .

4. Commit changes
git commit -m "Initial commit of Tyrone's Macros app"


(or update the message if this is not the first commit)

5. Push to GitHub
git branch -M main
git push -u origin main