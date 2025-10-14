import React from "react";

export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-neutral-800/70 rounded ${className}`} />;
}
