import React from "react";

type EditableChipProps = {
  text: string;
  onRemove?: () => void;
  onClick?: () => void;
  selected?: boolean;
};

export default function EditableChip({ text, onRemove, onClick, selected }: EditableChipProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none
      ${selected ? "bg-purple-600 text-white border-purple-500" : "bg-neutral-900 text-neutral-100 border-neutral-700"}`}
    >
      <span>{text}</span>
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-neutral-300/80 hover:text-white">
          ×
        </button>
      )}
    </div>
  );
}
