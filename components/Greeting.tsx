// components/Greeting.tsx
import React, { useEffect, useState } from 'react';
import { getDisplayName, getGreeting, getDailyPhrase } from '../services/userService';
import { getCurrentUserId } from '../auth';
import { getCurrentChicagoDateKey } from '../lib/dateLocal';

export default function Greeting() {
  const [greeting, setGreeting] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [phrase, setPhrase] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadGreeting() {
      try {
        const [displayName, timeGreeting, userId] = await Promise.all([
          getDisplayName(),
          getGreeting(),
          getCurrentUserId()
        ]);

        if (!mounted) return;

        setName(displayName || 'there');
        setGreeting(timeGreeting);

        if (userId) {
          const dailyPhrase = await getDailyPhrase(userId, getCurrentChicagoDateKey());
          if (mounted) {
            setPhrase(dailyPhrase);
          }
        }
      } catch (error) {
        console.error('Error loading greeting:', error);
        if (mounted) {
          setName('there');
          setGreeting('day');
          setPhrase('Stay consistent with your goals!');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadGreeting();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-4 p-3 rounded-2xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-100 dark:border-purple-800">
        <div className="animate-pulse">
          <div className="h-4 bg-purple-200 dark:bg-purple-700 rounded w-48 mb-1"></div>
          <div className="h-3 bg-purple-100 dark:bg-purple-800 rounded w-32"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 rounded-2xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-100 dark:border-purple-800">
      <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
        Good {greeting}, {name}
      </p>
      <p className="text-xs text-purple-600 dark:text-purple-300 mt-1">
        {phrase}
      </p>
    </div>
  );
}