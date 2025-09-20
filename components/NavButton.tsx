import React from 'react';
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; icon?: React.ReactNode; active?: boolean; className?: string; };
export default function NavButton({ label, icon, active, className, children, ...rest }: Props) {
  const text = label ?? (typeof children === 'string' ? (children as string) : '');
  return (
    <button type="button" {...rest} className={[
      'px-3 py-2 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-black text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300', className || '',
    ].join(' ')}>
      {icon ? <span className="inline-block mr-2">{icon}</span> : null}
      {text}
    </button>
  );
}
