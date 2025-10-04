// lib/legacyGlue.ts
declare global {
  interface Window {
    addSavedMealToToday?: (mealId: string) => void;
    eventBus?: { emit?: (evt: string, payload?: any) => void };
  }
}

if (typeof window !== 'undefined' && typeof window.addSavedMealToToday !== 'function') {
  window.addSavedMealToToday = (mealId: string) => {
    try {
      window.eventBus?.emit?.('savedMeal:add', { mealId });
    } catch (e) {
      console.warn('addSavedMealToToday emit failed:', e);
    }
  };
}

export {};
