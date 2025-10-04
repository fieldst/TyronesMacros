// services/userService.ts
import { supabase } from '../supabaseClient';
import { getCurrentUser } from '../auth';

export async function getDisplayName(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    // Try user metadata first (from signup)
    const metadata = user.user_metadata || {};
    const metaName = metadata.full_name || metadata.name || metadata.display_name;
    
    if (metaName && typeof metaName === 'string') {
      return metaName.trim().split(' ')[0]; // First name only
    }

    // Fallback to profiles table
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.display_name) {
      return profile.display_name.trim().split(' ')[0];
    }

    // Last fallback to email prefix
    if (user.email) {
      return user.email.split('@')[0];
    }

    return null;
  } catch (error) {
    console.error('Error getting display name:', error);
    return null;
  }
}

export async function getGreeting(): Promise<string> {
  const hour = new Date().getHours();
  if (hour < 11) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export async function getDailyPhrase(userId: string, date: string): Promise<string> {
  const cacheKey = `dailyPhrase:${userId}:${date}`;
  
  try {
    // Check cache first
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    // Generate new phrase via API
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: 'Generate a short, motivational daily phrase for a fitness app user. Keep it under 8 words, positive, and actionable.',
        prompt: `Generate a motivational phrase for ${date}`,
        model: 'gpt-4o-mini'
      })
    });

    if (!response.ok) {
      return 'Stay consistent with your goals today!';
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return 'Stay consistent with your goals today!';
    }

    const phrase = data.text?.trim() || 'Stay consistent with your goals today!';
    
    // Cache for the day
    localStorage.setItem(cacheKey, phrase);
    return phrase;
  } catch (error) {
    console.error('Error getting daily phrase:', error);
    return 'Stay consistent with your goals today!';
  }
}