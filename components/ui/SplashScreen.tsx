'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export default function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // Start fading out after 1.5 seconds
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 1500);

    // Completely remove from DOM after the transition (500ms) finishes
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
    }, 2000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${isFading ? 'opacity-0' : 'opacity-100'
        }`}
    >
      <div className="relative h-40 w-40 animate-pulse">
        <Image
          src="/icon-512x512.png"
          alt="MT5 Logo"
          fill
          sizes="160px"
          className="object-contain"
          priority
        />
      </div>
    </div>
  );
}
