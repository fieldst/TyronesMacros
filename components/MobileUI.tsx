import React, { useEffect } from 'react';

export function Chip({ children, active = false, className = '', onClick }:{ children: React.ReactNode; active?: boolean; className?: string; onClick?: () => void; }){
  return (
    <button type="button" onClick={onClick}
      className={[
        'px-2 py-1 rounded-full text-xs border',
        active ? 'bg-black text-white dark:bg-white dark:text-black'
               : 'border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200',
        className,
      ].join(' ')}>
      {children}
    </button>
  );
}

export function BottomSheet({ isOpen, title, onClose, children, height='70%' }:{ isOpen:boolean; title?:string; onClose:()=>void; children:React.ReactNode; height?:string; }){
  useEffect(()=>{
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  },[isOpen,onClose]);
  return (
    <div className={['fixed inset-0 z-[80]', isOpen?'pointer-events-auto':'pointer-events-none'].join(' ')} aria-hidden={!isOpen}>
      <div className={['absolute inset-0 bg-black/40 transition-opacity', isOpen?'opacity-100':'opacity-0'].join(' ')} onClick={onClose}/>
      <div className={[
        'absolute left-0 right-0 bottom-0',
        'rounded-t-2xl border border-neutral-200 dark:border-neutral-800',
        'bg-white dark:bg-neutral-950 shadow-2xl',
        'transition-transform duration-300',
        isOpen?'translate-y-0':'translate-y-full',
      ].join(' ')} style={{height}} role="dialog" aria-modal>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="h-1.5 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto absolute left-1/2 -translate-x-1/2 -top-2" />
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-xs px-2 py-1 border rounded-lg border-neutral-200 dark:border-neutral-800">Close</button>
        </div>
        <div className="px-4 pb-4 overflow-y-auto h-[calc(100%-44px)]">{children}</div>
      </div>
    </div>
  );
}

export function SummaryTray({ remainingKcal, remainingProtein, remainingCarbs, remainingFat, onAdd }:{ remainingKcal:number; remainingProtein:number; remainingCarbs:number; remainingFat:number; onAdd?:()=>void; }){
  return (
    <div className="sticky bottom-[68px] md:bottom-0 z-40">
      <div className="mx-auto max-w-screen-sm px-3">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-950/90 backdrop-blur p-2 shadow-lg">
          <div className="grid grid-cols-4 gap-1">
            <Stat label="Remain" value={`${Math.max(0, Math.round(remainingKcal))} kcal`} />
            <Stat label="Protein" value={`${Math.max(0, Math.round(remainingProtein))} g`} />
            <Stat label="Carbs" value={`${Math.max(0, Math.round(remainingCarbs))} g`} />
            <Stat label="Fat" value={`${Math.max(0, Math.round(remainingFat))} g`} />
          </div>
          <div className="flex justify-end mt-2">
            <button onClick={onAdd} className="h-9 px-3 rounded-xl text-sm bg-black text-white dark:bg-white dark:text-black">+ Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Stat({label, value}:{label:string; value:string}){
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-sm font-semibold truncate" title={value}>{value}</div>
    </div>
  );
}

export type MealLike = { id:string; title:string; desc?:string; calories:number; protein?:number; carbs?:number; fat?:number; };

export function MealCard({ meal, onSuggest, onRemove, onOpen }:{ meal:MealLike; onSuggest?:(m:MealLike)=>void; onRemove?:(id:string)=>void; onOpen?:(m:MealLike)=>void; }){
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" title={meal.title}>{meal.title}</div>
          {meal.desc ? <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5">{meal.desc}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1">
            <MiniChip label="Cal" value={meal.calories} />
            {typeof meal.protein==='number' && <MiniChip label="P" value={meal.protein} />}
            {typeof meal.carbs==='number' && <MiniChip label="C" value={meal.carbs} />}
            {typeof meal.fat==='number' && <MiniChip label="F" value={meal.fat} />}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <button className="h-8 px-2 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={()=>onSuggest?.(meal)}>Suggest</button>
          <button className="h-8 px-2 text-xs rounded-lg bg-red-600 text-white dark:bg-red-500" onClick={()=>onRemove?.(meal.id)}>Remove</button>
        </div>
      </div>
    </div>
  );
}
function MiniChip({label, value}:{label:string; value:number|string}){
  return <div className="px-2 py-1 text-[11px] rounded-full border border-neutral-200 dark:border-neutral-800">{label}: {value}</div>;
}

export type WorkoutLike = { id:string; title:string; calories:number };

export function WorkoutCard({ item, onEdit, onSuggest, onRemove }:{ item:WorkoutLike; onEdit?:(w:WorkoutLike)=>void; onSuggest?:(w:WorkoutLike)=>void; onRemove?:(id:string)=>void; }){
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate" title={item.title}>{item.title}</div>
          <div className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5">Burn: <span className="font-medium">{item.calories}</span> kcal</div>
        </div>
        <div className="shrink-0 flex gap-1">
          <button className="h-8 px-2 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={()=>onEdit?.(item)}>Edit</button>
          <button className="h-8 px-2 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800" onClick={()=>onSuggest?.(item)}>Suggest</button>
          <button className="h-8 px-2 text-xs rounded-lg bg-red-600 text-white dark:bg-red-500" onClick={()=>onRemove?.(item.id)}>Remove</button>
        </div>
      </div>
    </div>
  );
}
