// components/FoodPreviewCard.tsx
import React, { useState } from 'react';
import { Plus, CreditCard as Edit3, Check, X } from 'lucide-react';
import type { EstimateResponse } from '../services/aiFoodService';

type Props = {
  estimate: EstimateResponse;
  onAdd: () => Promise<void>;
  onClear: () => void;
  loading?: boolean;
};

export default function FoodPreviewCard({ estimate, onAdd, onClear, loading = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [editedTotals, setEditedTotals] = useState(estimate.totals);

  function handleEdit() {
    setEditing(true);
    setEditedTotals(estimate.totals);
  }

  function handleSaveEdit() {
    // Update the estimate totals
    estimate.totals = editedTotals;
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditedTotals(estimate.totals);
    setEditing(false);
  }

  const confidenceColor = 
    estimate.confidence === 'high' ? 'text-green-600 dark:text-green-400' :
    estimate.confidence === 'medium' ? 'text-yellow-600 dark:text-yellow-400' :
    'text-red-600 dark:text-red-400';

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Food Preview</h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${confidenceColor}`}>
            {estimate.confidence} confidence
          </span>
          <button
            onClick={handleEdit}
            className="p-1 text-neutral-500 hover:text-blue-600 transition-colors"
            title="Customize macros"
          >
            <Edit3 size={14} />
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {estimate.items.map((item, index) => (
          <div key={index} className="flex items-center justify-between p-2 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
            <div>
              <div className="text-sm font-medium">{item.name}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{item.quantity}</div>
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              {item.calories} cal
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 pt-3">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-neutral-600 dark:text-neutral-400">Calories</label>
                <input
                  type="number"
                  value={editedTotals.calories}
                  onChange={(e) => setEditedTotals(prev => ({ ...prev, calories: Number(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-600 dark:text-neutral-400">Protein</label>
                <input
                  type="number"
                  value={editedTotals.protein}
                  onChange={(e) => setEditedTotals(prev => ({ ...prev, protein: Number(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-600 dark:text-neutral-400">Carbs</label>
                <input
                  type="number"
                  value={editedTotals.carbs}
                  onChange={(e) => setEditedTotals(prev => ({ ...prev, carbs: Number(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-600 dark:text-neutral-400">Fat</label>
                <input
                  type="number"
                  value={editedTotals.fat}
                  onChange={(e) => setEditedTotals(prev => ({ ...prev, fat: Number(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1"
              >
                <Check size={14} />
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-neutral-500 text-white rounded-lg hover:bg-neutral-600 transition-colors flex items-center gap-1"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              Total: {estimate.totals.calories} cal • {estimate.totals.protein}p • {estimate.totals.carbs}c • {estimate.totals.fat}f
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!editing && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={onAdd}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-neutral-400 transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {loading ? 'Adding...' : 'Add to Log'}
          </button>
          <button
            onClick={onClear}
            className="px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}